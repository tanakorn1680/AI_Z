import { requireUser } from '@/lib/supabase/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError, parseBody, requireFields } from '@/lib/utils/api'
import { sanitizeText, isValidUUID } from '@/lib/utils/sanitize'
import { planTasksFromInstruction } from '@/lib/orchestrator/planner'
import { enqueueReadyTasks } from '@/lib/orchestrator/worker'
import { InvalidApiKeyError } from '@/lib/ai/types'

/**
 * สั่งงานใหม่: บันทึกข้อความผู้ใช้ → ให้ AI Manager แตกเป็น Task → enqueue ตัวที่พร้อมรันทันที
 * ใช้ admin client เฉพาะจุดที่ต้องอ่าน API key ผ่าน Vault และเขียน task จำนวนมาก
 * แต่ "ยืนยันตัวตน + สิทธิ์เป็นเจ้าของ project" ทำด้วย user client (RLS) ก่อนเสมอ
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!isValidUUID(projectId)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ instruction: string }>(req)
  if (err) return err
  const missing = requireFields(body, ['instruction'])
  if (missing) return missing
  const instruction = sanitizeText(body.instruction, 20_000)

  // ยืนยันว่าเป็นเจ้าของผ่าน RLS (user client) — ถ้าไม่ใช่เจ้าของ select จะได้ null
  interface ProjectRow { id: string; max_tasks_per_run: number; budget_usd: number | null; spent_usd: number }
  const { data: project, error: projectError } = await auth.supabase
    .from<ProjectRow>('projects')
    .select('id, max_tasks_per_run, budget_usd, spent_usd')
    .eq('id', projectId)
    .single()
  if (projectError || !project) return apiError('NOT_FOUND', 'ไม่พบ project หรือไม่มีสิทธิ์เข้าถึง')

  if (project.budget_usd !== null && project.spent_usd >= project.budget_usd) {
    return apiError('BUDGET_EXCEEDED', 'โปรเจกต์นี้ใช้งบหมดแล้ว เพิ่ม budget ก่อนสั่งงานใหม่')
  }

  interface ManagerAgentRow { id: string; provider: string; model: string; base_url: string | null }
  const { data: managerAgent, error: agentError } = await auth.supabase
    .from<ManagerAgentRow>('agents')
    .select('id, provider, model, base_url')
    .eq('project_id', projectId)
    .eq('role', 'manager')
    .limit(1)
    .maybeSingle()
  if (agentError) return apiError('INTERNAL_ERROR', agentError.message)
  if (!managerAgent) {
    return apiError('BAD_REQUEST', 'โปรเจกต์นี้ยังไม่มี Agent บทบาท manager — เพิ่มก่อนสั่งงาน')
  }

  await auth.supabase.from('messages').insert({ project_id: projectId, role: 'user', content: instruction })

  const admin = createAdminClient()
  const { data: apiKey } = await admin.rpc<string>('get_api_key', {
    p_user_id: auth.user.id,
    p_provider: managerAgent.provider,
  })
  if (!apiKey) {
    return apiError('BAD_REQUEST', `ยังไม่ได้เพิ่ม API key ของ ${managerAgent.provider} — เพิ่มในหน้า Settings ก่อน`)
  }

  try {
    const { taskCount } = await planTasksFromInstruction(admin, {
      projectId,
      instruction,
      managerAgentId: managerAgent.id,
      managerProvider: managerAgent.provider,
      managerModel: managerAgent.model,
      managerBaseUrl: managerAgent.base_url,
      apiKey,
      maxTasksPerRun: project.max_tasks_per_run,
    })

    await enqueueReadyTasks(admin, projectId)

    await admin.from('messages').insert({
      project_id: projectId,
      role: 'assistant',
      content: `วางแผนงานแล้ว ${taskCount} งาน กำลังเริ่มทำงานที่พร้อม`,
    })

    return apiOk({ taskCount })
  } catch (e) {
    const message = e instanceof InvalidApiKeyError ? e.message : (e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    await admin.from('messages').insert({
      project_id: projectId,
      role: 'assistant',
      content: `วางแผนงานไม่สำเร็จ: ${message}`,
    })
    return apiError('INTERNAL_ERROR', message)
  }
}
