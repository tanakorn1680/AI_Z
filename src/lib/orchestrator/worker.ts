import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from '../ai/registry'
import { completeWithRetry } from '../ai/retry'
import { InvalidApiKeyError } from '../ai/types'
import { buildTaskContext } from './context-builder'
import { calculateCost } from './pricing'
import { enqueueTask } from './queue'

interface TaskRow {
  id: string
  project_id: string
  title: string
  description: string
  depends_on: string[]
  assigned_agent: string | null
}

/**
 * ประมวลผล Task เดียวให้จบ: claim → เรียก AI → บันทึกผล → enqueue task ถัดไปที่พร้อม
 * เขียนเป็นฟังก์ชันแยกจาก route handler เพื่อให้เทสต์ได้และเรียกซ้ำจากที่อื่นได้ถ้าจำเป็น
 *
 * ทุกอย่างที่ "ตัดสินใจร่วมกับ Worker ตัวอื่น" (claim, complete, fail) ทำผ่าน RPC
 * แบบ atomic ในฝั่ง Postgres — ที่นี่แค่เรียกเรียงลำดับ ไม่ทำ business logic เอง
 */
export async function processTask(admin: SupabaseClient, taskId: string): Promise<void> {
  const { data: claimed, error: claimError } = await admin.rpc('claim_task', { p_task_id: taskId })
  if (claimError) throw claimError
  const task = (claimed as TaskRow[] | null)?.[0]
  if (!task) return // มีคน claim ไปแล้ว หรือยังไม่พร้อม (dependency/concurrency/budget) — จบเงียบ ๆ

  try {
    if (!task.assigned_agent) {
      throw new Error('Task นี้ไม่มี agent ผูกอยู่ — ผู้ใช้ต้องเลือก agent ก่อน')
    }

    interface AgentRow { provider: string; model: string; system_prompt: string; max_tokens: number | null; base_url: string | null }
    const { data: agent, error: agentError } = await admin
      .from<AgentRow>('agents')
      .select('provider, model, system_prompt, max_tokens, base_url')
      .eq('id', task.assigned_agent)
      .single()
    if (agentError || !agent) throw new Error('หา agent ที่ผูกกับ task นี้ไม่เจอ')

    interface ProjectRow { owner_id: string; max_tokens_per_task: number }
    const { data: project, error: projectError } = await admin
      .from<ProjectRow>('projects')
      .select('owner_id, max_tokens_per_task')
      .eq('id', task.project_id)
      .single()
    if (projectError || !project) throw new Error('หา project ของ task นี้ไม่เจอ')

    const { data: apiKey, error: keyError } = await admin.rpc<string>('get_api_key', {
      p_user_id: project.owner_id,
      p_provider: agent.provider,
    })
    if (keyError || !apiKey) {
      throw new InvalidApiKeyError(`ผู้ใช้ยังไม่ได้เพิ่ม API key ของ ${agent.provider}`)
    }

    const contextPrompt = await buildTaskContext(admin, task)
    const adapter = getAdapter(agent.provider)

    const result = await completeWithRetry(adapter, {
      apiKey,
      model: agent.model,
      systemPrompt: agent.system_prompt,
      userPrompt: contextPrompt,
      maxTokens: agent.max_tokens ?? project?.max_tokens_per_task ?? 4096,
      baseUrl: agent.base_url ?? undefined,
    })

    // summary สั้น ๆ สำหรับส่งต่อ Task ถัดไป (ประหยัด token ตามหลัก Context Management)
    // MVP: ตัดความยาวแบบตรงไปตรงมา — ยังไม่เรียก AI ซ้ำเพื่อสรุป (เพิ่มทีหลังถ้าจำเป็นจริง)
    const summary = result.text.length > 800 ? result.text.slice(0, 800) + '…' : result.text

    const cost = await calculateCost(admin, agent.provider, agent.model, result.tokensIn, result.tokensOut)

    const { error: completeError } = await admin.rpc('complete_task', {
      p_task_id: task.id,
      p_output: result.text,
      p_summary: summary,
      p_tokens_in: result.tokensIn,
      p_tokens_out: result.tokensOut,
      p_provider: agent.provider,
      p_model: agent.model,
      p_cost_usd: cost,
    })
    if (completeError) throw completeError

    // แสดงผลลัพธ์ของ task ในแชท (เดิมเก็บแค่ใน task_results ทำให้ผู้ใช้ไม่เห็นคำตอบ)
    // insert ไม่ throw — ถ้าพลาดก็แค่ไม่แสดงในแชท ไม่ทำให้ task ที่เสร็จแล้วกลายเป็น failed
    await admin.from('messages').insert({
      project_id: task.project_id,
      role: 'assistant',
      content: `${task.title}\n\n${result.text}`,
      task_id: task.id,
    })

    await enqueueReadyTasks(admin, task.project_id)
  } catch (err) {
    await handleTaskFailure(admin, task, err)
  }
}

async function handleTaskFailure(admin: SupabaseClient, task: TaskRow, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[worker] task ${task.id} ล้มเหลว:`, message)

  // key ผิด: retry ไม่มีทางสำเร็จ ปิดเป็น failed ทันทีโดยไม่กินโควตา attempts เพิ่ม
  if (err instanceof InvalidApiKeyError) {
    await admin
      .from<TaskRow>('tasks')
      .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('status', 'running')
    await admin.rpc('cancel_blocked_tasks', { p_project_id: task.project_id })
    return
  }

  const { data: outcome } = await admin.rpc<'retry' | 'failed' | 'ignored'>('fail_task', { p_task_id: task.id, p_error: message })

  if (outcome === 'retry') {
    // rate limit: หน่วงก่อน enqueue ใหม่เล็กน้อยผ่าน delaySeconds ของ Vercel Queue
    await enqueueTask({ taskId: task.id, projectId: task.project_id })
  } else if (outcome === 'failed') {
    await admin.rpc('cancel_blocked_tasks', { p_project_id: task.project_id })
  }
}

/** หา task ที่ dependency ครบแล้วของ project นี้ แล้วส่งเข้าคิวทุกตัว (parallel ตามข้อ 7 ของสเปค) */
export async function enqueueReadyTasks(admin: SupabaseClient, projectId: string): Promise<void> {
  const { data: ready } = await admin.rpc<TaskRow[]>('ready_tasks', { p_project_id: projectId })
  for (const t of (ready as TaskRow[] | null) ?? []) {
    await enqueueTask({ taskId: t.id, projectId })
  }
}
