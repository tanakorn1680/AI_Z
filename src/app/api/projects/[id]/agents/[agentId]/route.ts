import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError, parseBody } from '@/lib/utils/api'
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

/** เปิด/ปิดสิทธิ์สร้างและแก้ไฟล์ของ agent: body { can_write_files: boolean } */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id, agentId } = await params
  if (!isValidUUID(id) || !isValidUUID(agentId)) return apiError('BAD_REQUEST', 'id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ can_write_files: boolean }>(req)
  if (err) return err
  if (typeof body.can_write_files !== 'boolean') {
    return apiError('BAD_REQUEST', 'can_write_files ต้องเป็น true หรือ false')
  }

  const { error } = await auth.supabase
    .from('agents')
    .update({ allowed_tools: body.can_write_files ? ['read_file', 'write_file'] : ['read_file'] })
    .eq('id', agentId)
    .eq('project_id', id)
  if (error) return apiError('FORBIDDEN', 'แก้ไม่ได้: ' + error.message)

  return apiOk({ ok: true })
}
