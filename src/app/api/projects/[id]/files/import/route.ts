import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError, parseBody } from '@/lib/utils/api'
import { isValidUUID } from '@/lib/utils/sanitize'
import { IMPORT_BATCH_MAX_FILES, IMPORT_BATCH_MAX_CHARS } from '@/lib/files/path'
import { importFiles, type ImportItem } from '@/lib/files/import'

export const maxDuration = 60

/**
 * นำเข้าไฟล์เป็นชุด (เบราว์เซอร์แตก zip เองแล้วส่งมาทีละชุด)
 * body: { files: [{ path, content }, ...] }  →  { results: [{ path, status, error? }, ...] }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ files?: unknown }>(req)
  if (err) return err

  const raw = body.files
  if (!Array.isArray(raw) || raw.length === 0) {
    return apiError('BAD_REQUEST', 'ต้องส่ง files เป็นรายการไฟล์อย่างน้อย 1 ไฟล์')
  }
  if (raw.length > IMPORT_BATCH_MAX_FILES) {
    return apiError('BAD_REQUEST', `ส่งได้ครั้งละไม่เกิน ${IMPORT_BATCH_MAX_FILES} ไฟล์`)
  }

  const items: ImportItem[] = []
  let totalChars = 0
  for (const entry of raw) {
    const e = (entry ?? {}) as { path?: unknown; content?: unknown }
    if (typeof e.path !== 'string' || typeof e.content !== 'string') {
      return apiError('BAD_REQUEST', 'แต่ละไฟล์ต้องมี path และ content เป็นข้อความ')
    }
    totalChars += e.content.length
    items.push({ path: e.path, content: e.content })
  }
  if (totalChars > IMPORT_BATCH_MAX_CHARS) {
    return apiError('BAD_REQUEST', `เนื้อหารวมต่อชุดเกิน ${IMPORT_BATCH_MAX_CHARS} ตัวอักษร`)
  }

  // ใช้ client ของผู้ใช้ — RLS ปฏิเสธเองถ้า project ไม่ใช่ของผู้ใช้ (ผลจะเป็น failed รายไฟล์)
  const results = await importFiles(auth.supabase, id, items)
  return apiOk({ results })
}
