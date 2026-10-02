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

  interface TaskListRow {
    id: string; title: string; status: string; priority: number; depends_on: string[]
    assigned_agent: string | null; error: string | null; created_at: string; completed_at: string | null
  }
  const { data, error } = await auth.supabase
    .from<TaskListRow>('tasks')
    .select('id, title, status, priority, depends_on, assigned_agent, error, created_at, completed_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ tasks: data })
}
