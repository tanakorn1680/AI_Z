import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeFilePath, MAX_FILE_CHARS } from './path'

export type SaveFileResult =
  | { ok: true; fileId: string; versionId: string; created: boolean }
  | { ok: false; error: string }

/**
 * บันทึกไฟล์เป็นเวอร์ชันใหม่ (สร้างไฟล์ถ้า path ยังไม่มี)
 * ใช้ได้ทั้งกับ client ของผู้ใช้ (ผ่าน RLS) และ admin client ของ Worker
 * — ผู้เรียกต้องตรวจสิทธิ์ project มาก่อนเสมอ ถ้าใช้ admin client
 */
export async function saveFileVersion(
  client: SupabaseClient,
  p: { projectId: string; path: string; content: string; agentId?: string | null }
): Promise<SaveFileResult> {
  const check = normalizeFilePath(p.path)
  if (!check.ok) return { ok: false, error: check.error }
  if (typeof p.content !== 'string') return { ok: false, error: 'เนื้อหาไฟล์ต้องเป็นข้อความ' }
  if (p.content.length > MAX_FILE_CHARS) {
    return { ok: false, error: `ไฟล์ใหญ่เกิน ${MAX_FILE_CHARS} ตัวอักษร` }
  }

  const findExisting = async (): Promise<string | null> => {
    const { data } = await client
      .from('files')
      .select('id')
      .eq('project_id', p.projectId)
      .eq('path', check.path)
      .is('deleted_at', null)
      .maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  }

  let fileId = await findExisting()
  let created = false

  if (!fileId) {
    const { data, error } = await client
      .from('files')
      .insert({ project_id: p.projectId, path: check.path })
      .select('id')
      .single()
    if (error) {
      // งานขนานสองงานสร้าง path เดียวกันพร้อมกัน → unique index ชน ให้ใช้ไฟล์ที่อีกฝั่งสร้างไว้
      if (error.code === '23505') fileId = await findExisting()
      if (!fileId) return { ok: false, error: error.message }
    } else {
      fileId = (data as { id: string }).id
      created = true
    }
  }

  const { data: version, error: versionError } = await client
    .from('file_versions')
    .insert({ file_id: fileId, content: p.content, created_by: p.agentId ?? null })
    .select('id')
    .single()
  if (versionError) return { ok: false, error: versionError.message }
  const versionId = (version as { id: string }).id

  const { error: updateError } = await client
    .from('files')
    .update({ current_version_id: versionId })
    .eq('id', fileId)
  if (updateError) return { ok: false, error: updateError.message }

  return { ok: true, fileId, versionId, created }
}
