import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError } from '@/lib/utils/api'
import { isValidUUID, clamp } from '@/lib/utils/sanitize'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const url = new URL(req.url)
  const limit = clamp(Number(url.searchParams.get('limit') ?? 50), 1, 200)

  interface MessageRow { id: string; role: string; content: string; task_id: string | null; created_at: string }
  const { data, error } = await auth.supabase
    .from<MessageRow>('messages')
    .select('id, role, content, task_id, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ messages: (data ?? []).reverse() })
}
