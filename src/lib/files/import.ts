import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeFilePath, MAX_FILE_CHARS } from './path'
import { saveFileVersion } from './save'

export interface ImportItem {
  path: string
  content: string
}

export type ImportStatus = 'created' | 'updated' | 'unchanged' | 'failed'

export interface ImportResult {
  path: string
  status: ImportStatus
  error?: string
}

/** บันทึกพร้อมกันกี่ไฟล์ต่อหนึ่ง request (ไฟล์คนละ path ไม่ชนกัน) */
const CONCURRENCY = 5

/**
 * นำเข้าไฟล์หลายไฟล์เข้า project — ใช้ client ของผู้ใช้ (ผ่าน RLS)
 * - path ใหม่            → สร้างไฟล์ (created)
 * - path เดิม เนื้อหาต่าง → บันทึกเป็นเวอร์ชันใหม่ (updated)
 * - path เดิม เนื้อหาเหมือนเดิม → ข้าม ไม่สร้างเวอร์ชันซ้ำ (unchanged) ทำให้อัปโหลด zip ซ้ำได้โดยประวัติไม่รก
 * ไฟล์ที่ผิดพลาดจะไม่ทำให้ไฟล์อื่นล้ม — รายงานเป็น failed แยกรายไฟล์
 */
export async function importFiles(
  client: SupabaseClient,
  projectId: string,
  items: ImportItem[]
): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  const byPath = new Map<string, string>() // path ซ้ำในชุดเดียวกัน → ใช้อันหลังสุด

  for (const it of items) {
    const check = normalizeFilePath(it.path)
    if (!check.ok) {
      results.push({ path: String(it.path), status: 'failed', error: check.error })
      continue
    }
    if (typeof it.content !== 'string') {
      results.push({ path: check.path, status: 'failed', error: 'เนื้อหาไฟล์ต้องเป็นข้อความ' })
      continue
    }
    if (it.content.length > MAX_FILE_CHARS) {
      results.push({ path: check.path, status: 'failed', error: `ไฟล์ใหญ่เกิน ${MAX_FILE_CHARS} ตัวอักษร` })
      continue
    }
    // Postgres เก็บอักขระ NUL ในคอลัมน์ text ไม่ได้ — มักเป็นไฟล์ไบนารี
    if (it.content.includes('\u0000')) {
      results.push({ path: check.path, status: 'failed', error: 'ดูเป็นไฟล์ไบนารี (มีอักขระ NUL)' })
      continue
    }
    byPath.set(check.path, it.content)
  }

  const queue = [...byPath.entries()]
  let next = 0
  const worker = async () => {
    for (;;) {
      const entry = queue[next++]
      if (!entry) return
      results.push(await importOne(client, projectId, entry[0], entry[1]))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

  return results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

async function importOne(
  client: SupabaseClient,
  projectId: string,
  path: string,
  content: string
): Promise<ImportResult> {
  try {
    const { data: existing } = await client
      .from('files')
      .select('id, current_version_id')
      .eq('project_id', projectId)
      .eq('path', path)
      .is('deleted_at', null)
      .maybeSingle()
    const row = existing as { id: string; current_version_id: string | null } | null

    if (row?.current_version_id) {
      const { data: version } = await client
        .from('file_versions')
        .select('content')
        .eq('id', row.current_version_id)
        .maybeSingle()
      if ((version as { content: string } | null)?.content === content) {
        return { path, status: 'unchanged' }
      }
    }

    const saved = await saveFileVersion(client, { projectId, path, content })
    if (!saved.ok) return { path, status: 'failed', error: saved.error }
    return { path, status: saved.created ? 'created' : 'updated' }
  } catch (e) {
    return { path, status: 'failed', error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' }
  }
}
