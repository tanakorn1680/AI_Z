import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError } from '@/lib/utils/api'
import { isValidUUID, clamp } from '@/lib/utils/sanitize'

/** ข้อความล่าสุดของแชท (เรียงเก่า → ใหม่) — แผนงานที่รอยืนยันมากับข้อความของหัวหน้าทีม */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const limit = clamp(Number(new URL(req.url).searchParams.get('limit') ?? 50), 1, 200)
  const base = 'id, role, content, task_id, created_at'
  const query = (cols: string) =>
    auth.supabase.from('messages').select(cols).eq('project_id', id).order('created_at', { ascending: false }).limit(limit)

  let res = await query(`${base}, plan, plan_status`)
  if (res.error) res = await query(base) // ยังไม่ได้รัน migration 0004
  if (res.error) return apiError('INTERNAL_ERROR', res.error.message)

  return apiOk({ messages: [...((res.data ?? []) as unknown[])].reverse() })
}
