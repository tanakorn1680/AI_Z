import { requireUser } from '@/lib/supabase/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError, parseBody, requireFields } from '@/lib/utils/api'
import { sanitizeText, sanitizeShort, isValidEnum, isValidUUID } from '@/lib/utils/sanitize'
import { PROVIDER_IDS, getProviderMeta, validateBaseUrl } from '@/lib/ai/providers'

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
    base_url: string | null
  }
  const { data, error } = await auth.supabase
    .from<AgentListRow>('agents')
    .select('id, name, provider, model, role, system_prompt, allowed_tools, max_tokens, base_url')
    .eq('project_id', id)
    .order('created_at', { ascending: true })
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
    base_url?: string
    /** อนุญาตให้ agent สร้าง/แก้ไฟล์ (ค่าเริ่มต้น: อนุญาต) */
    can_write_files?: boolean
    /** ราคาต่อ 1 ล้าน token (USD) — ไม่บังคับ ใช้คำนวณค่าใช้จ่าย/คุมงบ */
    price_in?: number; price_out?: number
  }>(req)
  if (err) return err
  const missing = requireFields(body, ['name', 'provider', 'model', 'role'])
  if (missing) return missing
  if (!isValidEnum(body.provider, PROVIDER_IDS)) return apiError('BAD_REQUEST', 'provider ไม่ถูกต้อง')
  if (!isValidEnum(body.role, ROLES)) return apiError('BAD_REQUEST', 'role ไม่ถูกต้อง')

  const name = sanitizeShort(body.name, 100)
  const model = sanitizeShort(body.model, 100)
  if (!name || !model) return apiError('BAD_REQUEST', 'ชื่อและ model ต้องไม่ว่าง')

  // custom provider ต้องมี base URL ที่ผ่านการตรวจ; provider อื่นใช้ URL ของระบบเอง
  let baseUrl: string | null = null
  if (getProviderMeta(body.provider)?.customBaseUrl) {
    const check = validateBaseUrl(body.base_url)
    if (!check.ok) return apiError('BAD_REQUEST', check.error)
    baseUrl = check.url
  }

  let maxTokens: number | null = null
  if (body.max_tokens !== undefined && body.max_tokens !== null) {
    const n = Number(body.max_tokens)
    if (!Number.isInteger(n) || n < 1 || n > 200000) {
      return apiError('BAD_REQUEST', 'max_tokens ต้องเป็นจำนวนเต็ม 1–200000')
    }
    maxTokens = n
  }

  const hasPrice = body.price_in !== undefined && body.price_in !== null
    || body.price_out !== undefined && body.price_out !== null
  let priceIn = 0
  let priceOut = 0
  if (hasPrice) {
    priceIn = Number(body.price_in)
    priceOut = Number(body.price_out)
    const ok = [priceIn, priceOut].every((p) => Number.isFinite(p) && p >= 0 && p <= 100000)
    if (!ok) return apiError('BAD_REQUEST', 'ราคาต้องเป็นตัวเลข 0–100000 (USD ต่อ 1 ล้าน token) และต้องกรอกทั้งขาเข้าและขาออก')
  }

  const { data, error } = await auth.supabase
    .from<{ id: string }>('agents')
    .insert({
      project_id: id,
      name,
      provider: body.provider,
      model,
      role: body.role,
      system_prompt: body.system_prompt ? sanitizeText(body.system_prompt) : '',
      max_tokens: maxTokens,
      base_url: baseUrl,
      allowed_tools: body.can_write_files === false ? ['read_file'] : ['read_file', 'write_file'],
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return apiError('BAD_REQUEST', `มี agent ชื่อ "${name}" ใน project นี้แล้ว`)
    // RLS/trigger จะปฏิเสธถ้า project ไม่ใช่ของผู้ใช้ — สะท้อนเป็น error ตรงนี้
    return apiError('FORBIDDEN', error.message)
  }

  // ราคา: เพิ่มเฉพาะรุ่นที่ยังไม่มีราคา ไม่เขียนทับ (ตารางนี้ใช้ร่วมกันทุก project)
  // ทำหลัง insert agent สำเร็จเท่านั้น = ยืนยันแล้วว่าผู้เรียกเป็นเจ้าของ project
  let priceSaved = false
  if (hasPrice) {
    const admin = createAdminClient()
    const { error: priceError } = await admin
      .from('model_prices')
      .upsert(
        { provider: body.provider, model, in_per_mtok: priceIn, out_per_mtok: priceOut },
        { onConflict: 'provider,model', ignoreDuplicates: true }
      )
    priceSaved = !priceError
  }

  return apiOk({ agent: data, price_saved: priceSaved }, 201)
}
