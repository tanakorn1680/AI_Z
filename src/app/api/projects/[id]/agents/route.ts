import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError, parseBody, requireFields } from '@/lib/utils/api'
import { sanitizeText, sanitizeShort, isValidEnum, isValidUUID } from '@/lib/utils/sanitize'

const PROVIDERS = ['anthropic', 'openai', 'google'] as const
const ROLES = ['manager', 'researcher', 'coder', 'reviewer', 'custom'] as const

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  // RLS กรองให้เองว่าเป็นเจ้าของ project หรือไม่ — ถ้าไม่ใช่เจ้าของจะได้ [] ไม่ใช่ error
  interface AgentListRow {
    id: string; name: string; provider: string; model: string; role: string
    system_prompt: string; allowed_tools: string[]; max_tokens: number | null
  }
  const { data, error } = await auth.supabase
    .from<AgentListRow>('agents')
    .select('id, name, provider, model, role, system_prompt, allowed_tools, max_tokens')
    .eq('project_id', id)
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ agents: data })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{
    name: string; provider: string; model: string; role: string
    system_prompt?: string; max_tokens?: number
  }>(req)
  if (err) return err
  const missing = requireFields(body, ['name', 'provider', 'model', 'role'])
  if (missing) return missing
  if (!isValidEnum(body.provider, PROVIDERS)) return apiError('BAD_REQUEST', 'provider ไม่ถูกต้อง')
  if (!isValidEnum(body.role, ROLES)) return apiError('BAD_REQUEST', 'role ไม่ถูกต้อง')

  const { data, error } = await auth.supabase
    .from<{ id: string }>('agents')
    .insert({
      project_id: id,
      name: sanitizeShort(body.name),
      provider: body.provider,
      model: sanitizeShort(body.model, 100),
      role: body.role,
      system_prompt: body.system_prompt ? sanitizeText(body.system_prompt) : '',
      max_tokens: body.max_tokens ?? null,
    })
    .select('id')
    .single()
  // RLS/trigger จะปฏิเสธถ้า project ไม่ใช่ของผู้ใช้ — สะท้อนเป็น error ตรงนี้
  if (error) return apiError('FORBIDDEN', error.message)

  return apiOk({ agent: data }, 201)
}
