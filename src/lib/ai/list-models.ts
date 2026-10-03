import { getProviderMeta, validateBaseUrl } from './providers'

export interface ModelOption {
  id: string
  label: string
  /** OpenRouter: รุ่นที่ลงท้าย :free */
  free?: boolean
}

export class ListModelsError extends Error {
  constructor(message: string, public kind: 'invalid_key' | 'bad_request' | 'upstream') {
    super(message)
  }
}

// รุ่นที่ไม่ใช่แชท/ข้อความ — ซ่อนจากรายการเพื่อไม่ให้เลือกผิด
const NON_CHAT = /(embed|tts|image|imagen|veo|lyria|transcribe|whisper|dall-e|moderation|robotics|computer-use|deep-research|antigravity|aqa|realtime|audio|orpheus|guard)/i

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response
  try {
    // ไม่ตาม redirect: กัน key ถูกส่งต่อไปโฮสต์อื่น
    res = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new ListModelsError('เชื่อมต่อ provider ไม่สำเร็จ (timeout หรือเครือข่ายมีปัญหา)', 'upstream')
  }
  if (res.status === 401 || res.status === 403) {
    throw new ListModelsError('API key ไม่ถูกต้องหรือไม่มีสิทธิ์', 'invalid_key')
  }
  if (!res.ok) throw new ListModelsError(`provider ตอบ error ${res.status}`, 'upstream')
  return res.json()
}

async function listGoogle(apiKey: string): Promise<ModelOption[]> {
  interface Page {
    models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>
    nextPageToken?: string
  }
  const out: ModelOption[] = []
  let pageToken: string | undefined
  for (let i = 0; i < 5; i++) {
    const u = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    u.searchParams.set('pageSize', '1000')
    if (pageToken) u.searchParams.set('pageToken', pageToken)
    const data = (await getJson(u.toString(), { 'x-goog-api-key': apiKey })) as Page
    for (const m of data.models ?? []) {
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue
      const id = m.name.replace(/^models\//, '') // ช่อง Model ต้องไม่มี models/
      if (NON_CHAT.test(id)) continue
      out.push({ id, label: m.displayName ?? id })
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return out
}

async function listAnthropic(apiKey: string): Promise<ModelOption[]> {
  const data = (await getJson('https://api.anthropic.com/v1/models?limit=1000', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  })) as { data?: Array<{ id: string; display_name?: string }> }
  return (data.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }))
}

async function listOpenAICompatible(
  base: string,
  apiKey: string,
  onlyChatLike: boolean
): Promise<ModelOption[]> {
  const data = (await getJson(`${base}/models`, { authorization: `Bearer ${apiKey}` })) as {
    data?: Array<{ id: string; name?: string }>
  }
  const out: ModelOption[] = []
  for (const m of data.data ?? []) {
    if (NON_CHAT.test(m.id)) continue
    if (onlyChatLike && !/^(gpt|o\d|chatgpt)/i.test(m.id)) continue
    out.push({ id: m.id, label: m.name ?? m.id, free: m.id.endsWith(':free') })
  }
  return out
}

export interface ListModelsResult {
  models: ModelOption[]
  /** live = ดึงจาก provider จริง, static = รายการสำรองของระบบ (provider ไม่มี endpoint รายชื่อรุ่น) */
  source: 'live' | 'static'
}

/** ดึงรายชื่อรุ่นที่ key นี้เรียกได้จริง จาก provider โดยตรง */
export async function listModels(
  provider: string,
  apiKey: string,
  customBaseUrl?: string | null
): Promise<ListModelsResult> {
  const meta = getProviderMeta(provider)
  if (!meta) throw new ListModelsError('provider ไม่ถูกต้อง', 'bad_request')

  let models: ModelOption[]
  if (meta.kind === 'google') models = await listGoogle(apiKey)
  else if (meta.kind === 'anthropic') models = await listAnthropic(apiKey)
  else if (meta.kind === 'openai') models = await listOpenAICompatible('https://api.openai.com/v1', apiKey, true)
  else {
    const check = validateBaseUrl(meta.baseUrl ?? customBaseUrl)
    if (!check.ok) throw new ListModelsError(`base URL ใช้ไม่ได้: ${check.error}`, 'bad_request')
    try {
      models = await listOpenAICompatible(check.url, apiKey, false)
    } catch (e) {
      // key ผิดต้องบอกผู้ใช้ตรง ๆ แต่ถ้า provider แค่ไม่มี endpoint รายชื่อรุ่น (เช่น Z.ai) ใช้รายการสำรอง
      if (e instanceof ListModelsError && e.kind !== 'invalid_key' && meta.fallbackModels) {
        return { models: meta.fallbackModels.map((id) => ({ id, label: id })), source: 'static' }
      }
      throw e
    }
  }

  // รุ่นฟรีขึ้นก่อน, ถัดมา flash (เร็ว/ถูก), แล้วเรียงตามชื่อ
  const rank = (m: ModelOption) => (m.free ? 0 : /(^|[-/:._])(flash|mini|haiku|lite)([-/:._]|$)/i.test(m.id) ? 1 : 2)
  // Google: เรียงใหม่ → เก่า (ชื่อกลาง *-latest ก่อน แล้วเลขเวอร์ชันมาก → น้อย) รุ่นเก่ามักถูกปิดรับผู้ใช้ใหม่
  const byName =
    meta.kind === 'google'
      ? (a: ModelOption, b: ModelOption) => b.id.localeCompare(a.id, undefined, { numeric: true })
      : (a: ModelOption, b: ModelOption) => a.id.localeCompare(b.id)
  return { models: models.sort((a, b) => rank(a) - rank(b) || byName(a, b)), source: 'live' }
}
