import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError } from '@/lib/utils/api'
import { isValidUUID } from '@/lib/utils/sanitize'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id, agentId } = await params
  if (!isValidUUID(id) || !isValidUUID(agentId)) return apiError('BAD_REQUEST', 'id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  // RLS: ลบได้เฉพาะ agent ใน project ของตัวเอง — task ที่ผูกอยู่จะถูก set null (ดู schema)
  const { error } = await auth.supabase
    .from('agents')
    .delete()
    .eq('id', agentId)
    .eq('project_id', id)
  if (error) return apiError('FORBIDDEN', 'ลบไม่ได้: ' + error.message)

  return apiOk({ ok: true })
}
