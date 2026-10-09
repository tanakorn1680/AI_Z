import { requireUser } from '@/lib/supabase/auth'
import { apiOk, apiError, parseBody } from '@/lib/utils/api'
import { isValidEnum } from '@/lib/utils/sanitize'
import { PROVIDER_IDS, getProviderMeta, validateBaseUrl } from '@/lib/ai/providers'
import { probeKey } from '@/lib/ai/detect-provider'

/**
 * POST /api/agents/probe  { api_key, provider?, base_url? }
 * ตรวจว่า key ใช้ได้ + รู้ว่าเป็นของเจ้าไหน + ดึงรายชื่อโมเดลที่ key นี้ใช้ได้ — ในครั้งเดียว
 * key ไม่ถูกบันทึกที่นี่ (บันทึกตอนกดเพิ่ม Agent เท่านั้น) และไม่ถูกส่งกลับ
 * ผลที่เป็นเรื่องปกติ (key ผิด / เดาเจ้าไม่ได้) ตอบ 200 พร้อม ok:false เพื่อให้หน้าจอแสดงข้อความได้ตรง ๆ
 */
export async function POST(req: Request) {
  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ api_key?: unknown; provider?: unknown; base_url?: unknown }>(req)
  if (err) return err

  const key = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  if (key.length < 8 || key.length > 500) return apiError('BAD_REQUEST', 'API key ความยาวไม่สมเหตุสมผล')

  let provider: string | undefined
  if (body.provider !== undefined && body.provider !== null && body.provider !== '') {
    if (!isValidEnum(body.provider, PROVIDER_IDS)) return apiError('BAD_REQUEST', 'ผู้ให้บริการไม่ถูกต้อง')
    provider = body.provider
  }

  let baseUrl: string | null = null
  if (provider && getProviderMeta(provider)?.customBaseUrl) {
    const check = validateBaseUrl(body.base_url)
    if (!check.ok) return apiError('BAD_REQUEST', check.error)
    baseUrl = check.url
  }

  const r = await probeKey(key, { provider, baseUrl })
  if (!r.ok) return apiOk({ ok: false, reason: r.reason, message: r.message })
  return apiOk({ ok: true, provider: r.provider, label: r.label, models: r.models, source: r.source })
}
