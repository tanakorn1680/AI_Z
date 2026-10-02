import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError } from '@/lib/utils/api'
import { isValidUUID } from '@/lib/utils/sanitize'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const { data: project, error: projectError } = await auth.supabase
    .from<{ budget_usd: number | null; spent_usd: number }>('projects')
    .select('budget_usd, spent_usd')
    .eq('id', id)
    .single()
  if (projectError || !project) return apiError('NOT_FOUND', 'ไม่พบ project')

  interface UsageRow {
    provider: string; model: string; tokens_in: number; tokens_out: number
    cost_usd: number; created_at: string
  }
  const { data: usage, error } = await auth.supabase
    .from<UsageRow>('usage')
    .select('provider, model, tokens_in, tokens_out, cost_usd, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ budget_usd: project.budget_usd, spent_usd: project.spent_usd, usage })
}
