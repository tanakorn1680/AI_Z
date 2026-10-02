import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError } from '@/lib/utils/api'
import { isValidUUID } from '@/lib/utils/sanitize'
import { enqueueTask } from '@/lib/orchestrator/queue'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params
  if (!isValidUUID(taskId)) return apiError('BAD_REQUEST', 'task id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  // trigger tasks_status_guard อนุญาตแค่ failed/cancelled → pending และรีเซ็ต attempts ให้เอง
  // RLS กรองอยู่แล้วว่าต้องเป็นเจ้าของ project ของ task นี้
  const { data, error } = await auth.supabase
    .from<{ id: string; project_id: string }>('tasks')
    .update({ status: 'pending' })
    .eq('id', taskId)
    .select('id, project_id')
    .single()
  if (error || !data) return apiError('FORBIDDEN', 'retry ไม่ได้: ' + (error?.message ?? 'ไม่พบ task'))

  await enqueueTask({ taskId: data.id, projectId: data.project_id })

  return apiOk({ ok: true })
}
