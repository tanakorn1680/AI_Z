import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError } from '@/lib/utils/api'
import { isValidUUID } from '@/lib/utils/sanitize'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params
  if (!isValidUUID(taskId)) return apiError('BAD_REQUEST', 'task id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const { error } = await auth.supabase
    .from<{ id: string; project_id: string }>('tasks')
    .update({ status: 'cancelled' })
    .eq('id', taskId)
    .select('id, project_id')
    .single()
  if (error) return apiError('FORBIDDEN', 'ยกเลิกไม่ได้: ' + error.message)

  return apiOk({ ok: true })
}
