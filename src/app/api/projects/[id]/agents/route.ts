import { requireUser } from '@/lib/supabase/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError, parseBody, requireFields } from '@/lib/utils/api'
import { sanitizeShort, isValidEnum, isValidUUID } from '@/lib/utils/sanitize'
import { PROVIDER_IDS, getProviderMeta, validateBaseUrl } from '@/lib/ai/providers'

const MIGRATION_HINT = 'ฐานข้อมูลยังไม่รองรับระบบ Agent ใหม่ — เปิด Supabase > SQL Editor แล้วรันไฟล์ supabase/migrations/0004_simple_agents.sql หนึ่งครั้ง'

/** ชื่อเริ่มต้นของ agent จากชื่อโมเดล (ตัดส่วนหน้า provider/ และ :free ออก) ไม่ซ้ำกับชื่อที่มีอยู่ */
export function defaultAgentName(model: string, existing: string[]): string {
  const base = (model.split('/').pop() ?? model).replace(/:[a-z0-9_-]+$/i, '').slice(0, 90) || 'AI'
  const taken = new Set(existing.map((n) => n.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now() % 10000}`
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  // RLS กรองให้เองว่าเป็นเจ้าของ project หรือไม่ — ถ้าไม่ใช่เจ้าของจะได้ [] ไม่ใช่ error
  const base = 'id, name, provider, model, role, allowed_tools, max_tokens, base_url'
  let res = await auth.supabase.from('agents').select(`${base}, duty, key_last4`).eq('project_id', id).order('created_at', { ascending: true })
  if (res.error) {
    // ยังไม่ได้รัน migration 0004 — แสดง agent เดิมได้ตามปกติ
    res = await auth.supabase.from('agents').select(base).eq('project_id', id).order('created_at', { ascending: true })
  }
  if (res.error) return apiError('INTERNAL_ERROR', res.error.message)

  // agent ที่สร้างก่อนระบบใหม่ใช้ key ร่วมตาม provider — บอกให้หน้าจอรู้ว่ายังมี key ใช้อยู่
  const { data: shared } = await auth.supabase.from('api_credentials_safe').select('provider')
  const sharedProviders = new Set(((shared ?? []) as Array<{ provider: string }>).map((c) => c.provider))

  const agents = ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map((a) => ({
    ...a,
    duty: (a.duty as string | undefined) ?? '',
    key_last4: (a.key_last4 as string | null | undefined) ?? null,
    key_source: a.key_last4 ? 'agent' : sharedProviders.has(a.provider as string) ? 'shared' : 'none',
  }))
  return apiOk({ agents })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{
    api_key: string; provider: string; model: string
    base_url?: string; name?: string; duty?: string
    can_write_files?: boolean
    /** ราคาต่อ 1 ล้าน token (USD) — ไม่บังคับ ใช้คำนวณค่าใช้จ่าย/คุมงบ */
    price_in?: number; price_out?: number
  }>(req)
  if (err) return err
  const missing = requireFields(body, ['api_key', 'provider', 'model'])
  if (missing) return missing
  if (!isValidEnum(body.provider, PROVIDER_IDS)) return apiError('BAD_REQUEST', 'ผู้ให้บริการไม่ถูกต้อง')

  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  if (apiKey.length < 8 || apiKey.length > 500) return apiError('BAD_REQUEST', 'API key ความยาวไม่สมเหตุสมผล')
  const model = sanitizeShort(body.model, 100)
  if (!model) return apiError('BAD_REQUEST', 'ต้องเลือกโมเดล')

  let baseUrl: string | null = null
  if (getProviderMeta(body.provider)?.customBaseUrl) {
    const check = validateBaseUrl(body.base_url)
    if (!check.ok) return apiError('BAD_REQUEST', check.error)
    baseUrl = check.url
  }

  const hasPrice = (body.price_in !== undefined && body.price_in !== null) || (body.price_out !== undefined && body.price_out !== null)
  let priceIn = 0
  let priceOut = 0
  if (hasPrice) {
    priceIn = Number(body.price_in)
    priceOut = Number(body.price_out)
    if (![priceIn, priceOut].every((p) => Number.isFinite(p) && p >= 0 && p <= 100000)) {
      return apiError('BAD_REQUEST', 'ราคาต้องเป็นตัวเลข 0–100000 (USD ต่อ 1 ล้าน token) และต้องกรอกทั้งขาเข้าและขาออก')
    }
  }

  // agent ตัวแรกของทีมเป็นหัวหน้าทีม (คุยกับผู้ใช้ + แบ่งงาน) ตัวต่อ ๆ ไปเป็นสมาชิก
  const { data: existing, error: listError } = await auth.supabase.from('agents').select('name').eq('project_id', id)
  if (listError) return apiError('INTERNAL_ERROR', listError.message)
  const names = ((existing ?? []) as Array<{ name: string }>).map((a) => a.name)

  const requestedName = sanitizeShort(body.name, 100)
  const name = requestedName || defaultAgentName(model, names)

  const { data: created, error } = await auth.supabase
    .from('agents')
    .insert({
      project_id: id,
      name,
      provider: body.provider,
      model,
      role: names.length === 0 ? 'manager' : 'custom',
      duty: sanitizeShort(body.duty, 300),
      system_prompt: '',
      base_url: baseUrl,
      allowed_tools: body.can_write_files === false ? ['read_file'] : ['read_file', 'write_file'],
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return apiError('BAD_REQUEST', `มี AI ชื่อ "${name}" ในทีมนี้แล้ว ตั้งชื่ออื่น`)
    if (/duty/i.test(error.message)) return apiError('INTERNAL_ERROR', MIGRATION_HINT)
    return apiError('FORBIDDEN', error.message)
  }
  const agentId = (created as { id: string }).id

  // เก็บ key ของ agent ตัวนี้เข้า Vault — ถ้าเก็บไม่ได้ ไม่ทิ้ง agent ที่ไม่มี key ค้างไว้
  const admin = createAdminClient()
  const { error: keyError } = await admin.rpc('set_agent_key', { p_agent_id: agentId, p_key: apiKey })
  if (keyError) {
    await auth.supabase.from('agents').delete().eq('id', agentId)
    const missingFn = /set_agent_key|function|schema cache/i.test(keyError.message)
    return apiError('INTERNAL_ERROR', missingFn ? MIGRATION_HINT : `เก็บ API key ไม่สำเร็จ: ${keyError.message}`)
  }

  // ราคา: เพิ่มเฉพาะรุ่นที่ยังไม่มีราคา ไม่เขียนทับ (ตารางนี้ใช้ร่วมกันทุก project)
  let priceSaved = false
  if (hasPrice) {
    const { error: priceError } = await admin
      .from('model_prices')
      .upsert(
        { provider: body.provider, model, in_per_mtok: priceIn, out_per_mtok: priceOut },
        { onConflict: 'provider,model', ignoreDuplicates: true }
      )
    priceSaved = !priceError
  }

  return apiOk({ agent: { id: agentId, name, role: names.length === 0 ? 'manager' : 'custom' }, price_saved: priceSaved }, 201)
}
