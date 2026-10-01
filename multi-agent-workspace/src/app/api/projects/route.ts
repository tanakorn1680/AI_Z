import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError, parseBody, requireFields } from '@/lib/utils/api'
import { sanitizeText } from '@/lib/utils/sanitize'

export async function GET() {
  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  interface ProjectListRow { id: string; name: string; budget_usd: number | null; spent_usd: number; created_at: string }
  const { data, error } = await auth.supabase
    .from<ProjectListRow>('projects')
    .select('id, name, budget_usd, spent_usd, created_at')
    .order('created_at', { ascending: false })
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ projects: data })
}

export async function POST(req: Request) {
  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ name: string; instructions?: string; budget_usd?: number }>(req)
  if (err) return err
  const missing = requireFields(body, ['name'])
  if (missing) return missing

  const { data, error } = await auth.supabase
    .from<{ id: string; name: string }>('projects')
    .insert({
      owner_id: auth.user.id,
      name: sanitizeText(body.name),
      instructions: body.instructions ? sanitizeText(body.instructions) : '',
      budget_usd: body.budget_usd ?? null,
    })
    .select('id, name')
    .single()
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ project: data }, 201)
}
