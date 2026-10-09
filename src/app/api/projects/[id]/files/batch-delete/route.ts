import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError, parseBody } from '@/lib/utils/api'
import { isValidUUID } from '@/lib/utils/sanitize'

const MAX_BATCH = 200

/**
 * ลบไฟล์หลายไฟล์พร้อมกัน (soft delete เหมือน DELETE ทีละไฟล์)
 * body: { file_ids: string[] }
 *
 * ใช้ client ของผู้ใช้ (ไม่ใช่ admin) — RLS กรองเองว่าแก้ได้เฉพาะไฟล์ของ project ตัวเอง
 * ถ้าส่ง id ที่ไม่ใช่ของ project นี้มาปนอยู่ แถวนั้นจะไม่ถูกแก้แต่ไม่ error (ตาม UPDATE ปกติ
 * ของ Postgres ที่ WHERE ไม่ match ก็แค่ไม่กระทบแถวนั้น) จึงต้องนับแถวที่ update จริงแล้วเทียบ
 * กับจำนวนที่ขอมา เพื่อแจ้งผู้ใช้ถ้ามีบางไฟล์ลบไม่สำเร็จ
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ file_ids: unknown }>(req)
  if (err) return err

  if (!Array.isArray(body.file_ids) || body.file_ids.length === 0) {
    return apiError('BAD_REQUEST', 'file_ids ต้องเป็น array และมีอย่างน้อย 1 รายการ')
  }
  if (body.file_ids.length > MAX_BATCH) {
    return apiError('BAD_REQUEST', `ลบได้ครั้งละไม่เกิน ${MAX_BATCH} ไฟล์`)
  }

  const fileIds = [...new Set(body.file_ids)].filter(isValidUUID)
  if (fileIds.length === 0) {
    return apiError('BAD_REQUEST', 'ไม่มี file_ids ที่เป็น UUID ที่ถูกต้องเลย')
  }

  const { data, error } = await auth.supabase
    .from('files')
    .update({ deleted_at: new Date().toISOString() })
    .eq('project_id', id)
    .is('deleted_at', null)
    .in('id', fileIds)
    .select('id')
  if (error) return apiError('FORBIDDEN', 'ลบไม่ได้: ' + error.message)

  const deletedIds = (data ?? []).map((r) => (r as { id: string }).id)
  const notDeleted = fileIds.filter((fid) => !deletedIds.includes(fid))

  return apiOk({
    deleted_count: deletedIds.length,
    deleted_ids: deletedIds,
    // ไฟล์ที่ขอลบแต่ไม่โดน (ไม่ใช่ของ project นี้ / ถูกลบไปแล้ว / id ไม่มีจริง)
    skipped_ids: notDeleted,
  })
}
