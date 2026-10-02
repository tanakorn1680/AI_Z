import { requireUser } from '@/lib/supabase/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError, parseBody, requireFields } from '@/lib/utils/api'
import { isValidEnum } from '@/lib/utils/sanitize'
import { PROVIDER_IDS } from '@/lib/ai/providers'

/**
 * BYOK: key จริงไม่เคยผ่าน route นี้กลับออกไป — เขียนเข้า Vault แล้วคืนแค่ last4
 * ใช้ admin client เพราะ store_api_key/delete_api_key เป็น RPC ที่ให้สิทธิ์ service_role เท่านั้น
 * (ดู 0001_core_schema.sql: revoke ... from authenticated) — แต่ยืนยันตัวตนด้วย user client ก่อนเสมอ
 */
export async function GET() {
  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const { data, error } = await auth.supabase
    .from<{ id: string; provider: string; last4: string; created_at: string }>('api_credentials_safe')
    .select('id, provider, last4, created_at')
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ credentials: data })
}

export async function POST(req: Request) {
  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ provider: string; api_key: string }>(req)
  if (err) return err
  const missing = requireFields(body, ['provider', 'api_key'])
  if (missing) return missing
  if (!isValidEnum(body.provider, PROVIDER_IDS)) return apiError('BAD_REQUEST', 'provider ไม่ถูกต้อง')
  body.api_key = body.api_key.trim()
  if (body.api_key.length < 8 || body.api_key.length > 500) {
    return apiError('BAD_REQUEST', 'API key ความยาวไม่สมเหตุสมผล')
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('store_api_key', {
    p_user_id: auth.user.id,
    p_provider: body.provider,
    p_key: body.api_key,
  })
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ ok: true }, 201)
}

export async function DELETE(req: Request) {
  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') ?? ''
  if (!isValidEnum(provider, PROVIDER_IDS)) return apiError('BAD_REQUEST', 'provider ไม่ถูกต้อง')

  const admin = createAdminClient()
  const { error } = await admin.rpc('delete_api_key', { p_user_id: auth.user.id, p_provider: provider })
  if (error) return apiError('INTERNAL_ERROR', error.message)

  return apiOk({ ok: true })
}
