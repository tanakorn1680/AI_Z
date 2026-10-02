import { requireUser } from '@/lib/supabase/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/utils/api'
import { isValidEnum } from '@/lib/utils/sanitize'
import { PROVIDER_IDS } from '@/lib/ai/providers'
import { listModels, ListModelsError } from '@/lib/ai/list-models'

/**
 * GET /api/models?provider=google[&base_url=https://...]
 * ใช้ key ที่ผู้ใช้บันทึกไว้ใน Vault เรียก provider ฝั่ง server — key ไม่เคยถูกส่งกลับไปที่ browser
 */
export async function GET(req: Request) {
  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') ?? ''
  if (!isValidEnum(provider, PROVIDER_IDS)) return apiError('BAD_REQUEST', 'provider ไม่ถูกต้อง')

  const admin = createAdminClient()
  const { data: apiKey } = await admin.rpc<string>('get_api_key', {
    p_user_id: auth.user.id, // ใช้ id ของผู้เรียกที่ยืนยันตัวตนแล้วเท่านั้น
    p_provider: provider,
  })
  if (!apiKey) return apiError('BAD_REQUEST', 'ยังไม่ได้เพิ่ม API key ของ provider นี้')

  try {
    const models = await listModels(provider, apiKey, url.searchParams.get('base_url'))
    return apiOk({ models })
  } catch (e) {
    if (e instanceof ListModelsError) {
      return apiError(e.kind === 'upstream' ? 'INTERNAL_ERROR' : 'BAD_REQUEST', e.message)
    }
    return apiError('INTERNAL_ERROR', 'ดึงรายชื่อรุ่นไม่สำเร็จ')
  }
}
