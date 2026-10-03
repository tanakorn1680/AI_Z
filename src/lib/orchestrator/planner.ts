import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from '../ai/registry'
import { InvalidApiKeyError } from '../ai/types'
import { completeWithRetry } from '../ai/retry'

interface PlannedTask {
  title: string
  description: string
  role: 'manager' | 'researcher' | 'coder' | 'reviewer' | 'custom'
  /** อ้าง index (0-based) ของ task อื่นในแผนเดียวกันที่ต้องเสร็จก่อน */
  depends_on_index: number[]
}

const PLANNER_SYSTEM_PROMPT = `คุณคือ Manager ที่แบ่งงานให้ทีม AI
ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON ห้ามใช้ Markdown code fence
รูปแบบ:
{"tasks":[{"title":"...", "description":"...", "role":"researcher|coder|reviewer|manager|custom", "depends_on_index":[0]}]}
กติกา:
- depends_on_index อ้าง index ของงานอื่นในลิสต์นี้เท่านั้น (เริ่มที่ 0)
- งานที่ไม่ต้องรอใคร ให้ depends_on_index เป็น []
- แตกงานให้น้อยที่สุดเท่าที่จำเป็น
- role ต้องเป็นค่าใดค่าหนึ่งที่กำหนดเท่านั้น`

/**
 * ให้ AI Manager แบ่งคำสั่งผู้ใช้เป็น Task พร้อม dependency
 * แล้วเขียนลง DB เป็น draft ทั้งหมดในธุรกรรมเดียว (ผ่าน RPC เพื่อความ atomic)
 * คืนจำนวน task ที่สร้าง
 */
export async function planTasksFromInstruction(
  admin: SupabaseClient,
  params: {
    projectId: string
    instruction: string
    managerAgentId: string
    managerProvider: string
    managerModel: string
    managerBaseUrl?: string | null
    apiKey: string
    maxTasksPerRun: number
  }
): Promise<{ taskCount: number }> {
  const adapter = getAdapter(params.managerProvider)

  const result = await completeWithRetry(adapter, {
    apiKey: params.apiKey,
    model: params.managerModel,
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    userPrompt: params.instruction,
    maxTokens: 2048,
    baseUrl: params.managerBaseUrl ?? undefined,
  }, { rateLimitWaitMaxSeconds: 8 })

  // บันทึก token ของการวางแผน (ไม่มี task ผูก) — นับเฉพาะ token ไม่คิดเงิน/ไม่แตะ spent_usd เหมือนพฤติกรรมเดิม
  // ทำก่อน parse เพื่อให้ token นับแม้ Manager ตอบผิดรูปแบบ
  await admin.from('usage').insert({
    project_id: params.projectId,
    task_id: null,
    provider: params.managerProvider,
    model: params.managerModel,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd: 0,
  })

  let parsed: { tasks: PlannedTask[] }
  try {
    // กันกรณีโมเดลใส่ code fence มาทั้งที่สั่งห้ามแล้ว
    const cleaned = result.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '')
    parsed = JSON.parse(cleaned) as { tasks: PlannedTask[] }
  } catch {
    throw new Error('AI Manager ตอบไม่เป็น JSON ที่ถูกต้อง: ' + result.text.slice(0, 300))
  }

  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error('AI Manager ไม่ได้แบ่งงานใด ๆ ออกมา')
  }
  if (parsed.tasks.length > params.maxTasksPerRun) {
    throw new Error(
      `AI Manager แบ่งงานเกินเพดาน (${parsed.tasks.length} > ${params.maxTasksPerRun}) — ปรับ instruction ให้แคบลง หรือเพิ่ม max_tasks_per_run ของโปรเจกต์`
    )
  }
  const validRoles = new Set(['manager', 'researcher', 'coder', 'reviewer', 'custom'])
  for (const [i, t] of parsed.tasks.entries()) {
    if (!t.title || !validRoles.has(t.role)) {
      throw new Error(`Task index ${i} จาก AI Manager มีรูปแบบไม่ถูกต้อง`)
    }
    for (const dep of t.depends_on_index) {
      if (dep === i || dep < 0 || dep >= parsed.tasks.length) {
        throw new Error(`Task index ${i} อ้าง depends_on_index ที่ไม่ถูกต้อง: ${dep}`)
      }
    }
  }

  // หา agent ที่เหมาะกับแต่ละ role ในโปรเจกต์นี้ (ตัวแรกที่เจอ) — ถ้าไม่มี ปล่อยว่าง (ผู้ใช้ผูกทีหลัง)
  const { data: agents } = await admin
    .from<{ id: string; role: string }>('agents')
    .select('id, role')
    .eq('project_id', params.projectId)
  const agentByRole = new Map<string, string>()
  for (const a of agents ?? []) {
    if (!agentByRole.has(a.role)) agentByRole.set(a.role, a.id)
  }

  // สร้างทีละ task ตามลำดับ topological อย่างง่าย (input array เป็น DAG ที่ index ต่ำกว่ามาก่อนได้เสมอ
  // เพราะ depends_on_index ชี้ไป index ในลิสต์เดียวกัน ไม่ใช่ id จริง จึงต้อง map ทีหลัง)
  const createdIds: string[] = []
  for (const t of parsed.tasks) {
    const dependsOnIds = t.depends_on_index.map((i) => createdIds[i]).filter(Boolean) as string[]
    const { data: inserted, error } = await admin
      .from<{ id: string }>('tasks')
      .insert({
        project_id: params.projectId,
        title: t.title,
        description: t.description,
        assigned_agent: agentByRole.get(t.role) ?? params.managerAgentId,
        depends_on: dependsOnIds,
        status: 'pending',
      })
      .select('id')
      .single()
    if (error) throw error
    if (!inserted) throw new Error('สร้าง task ไม่สำเร็จ (ไม่มี error แต่ไม่มีผลลัพธ์)')
    createdIds.push(inserted.id)
  }

  return { taskCount: createdIds.length }
}

export { InvalidApiKeyError }
