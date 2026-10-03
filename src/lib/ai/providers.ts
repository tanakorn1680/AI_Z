/**
 * รายชื่อ provider ที่ระบบรองรับ — จุดเดียวที่ทั้ง UI, API route และ registry อ่านร่วมกัน
 * ไม่มี 'server-only' เพราะ UI (client) ใช้แสดง dropdown ด้วย
 *
 * เพิ่ม provider แบบ OpenAI-compatible ใหม่ = เพิ่ม 1 แถวในลิสต์นี้
 * + เพิ่มค่าใน enum provider_name ของ DB (alter type ... add value) แค่นั้น
 */

export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'openai_compatible'

export interface ProviderMeta {
  id: string
  label: string
  kind: ProviderKind
  /** base URL ของ endpoint แบบ OpenAI-compatible (ไม่รวม /chat/completions) */
  baseUrl?: string
  /** true = ผู้ใช้ต้องกรอก base URL เองต่อ agent */
  customBaseUrl?: boolean
  keyPlaceholder: string
  /** รุ่นที่ "คิด" ก่อนตอบนับ token คิดรวมใน max_tokens — เผื่อเพดานเพิ่มเท่านี้ไม่ให้คำตอบจริงถูกตัด */
  outputHeadroom?: number
  /** รายชื่อรุ่นสำรอง ใช้เมื่อ provider ไม่มี endpoint รายชื่อรุ่นให้เรียก */
  fallbackModels?: readonly string[]
}

export const PROVIDER_LIST: readonly ProviderMeta[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', keyPlaceholder: 'sk-ant-...' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', keyPlaceholder: 'sk-...' },
  { id: 'google', label: 'Google (Gemini)', kind: 'google', keyPlaceholder: 'AIza...' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1', keyPlaceholder: 'sk-or-...' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai_compatible', baseUrl: 'https://api.deepseek.com', keyPlaceholder: 'sk-...' },
  { id: 'groq', label: 'Groq', kind: 'openai_compatible', baseUrl: 'https://api.groq.com/openai/v1', keyPlaceholder: 'gsk_...', outputHeadroom: 8192 }, // gpt-oss คิดก่อนตอบ นับ token คิดรวมในเพดาน
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai_compatible', baseUrl: 'https://api.x.ai/v1', keyPlaceholder: 'xai-...' },
  { id: 'mistral', label: 'Mistral', kind: 'openai_compatible', baseUrl: 'https://api.mistral.ai/v1', keyPlaceholder: 'API key' },
  { id: 'together', label: 'Together AI', kind: 'openai_compatible', baseUrl: 'https://api.together.xyz/v1', keyPlaceholder: 'API key' },
  {
    id: 'zai',
    label: 'Z.ai (GLM)',
    kind: 'openai_compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    keyPlaceholder: 'API key จากคอนโซล z.ai',
    outputHeadroom: 8192,
    fallbackModels: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash'],
  },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai_compatible', customBaseUrl: true, keyPlaceholder: 'API key ของ endpoint นั้น' },
]

export const PROVIDER_IDS: readonly string[] = PROVIDER_LIST.map((p) => p.id)

export function getProviderMeta(id: string): ProviderMeta | undefined {
  return PROVIDER_LIST.find((p) => p.id === id)
}

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; error: string }

/**
 * ตรวจ base URL ที่ผู้ใช้กรอก — Server จะเรียก URL นี้พร้อมแนบ API key
 * จึงรับเฉพาะ https และกัน host ภายใน (localhost / IP ส่วนตัว) เพื่อลดความเสี่ยง SSRF
 * หมายเหตุ: ตรวจจากชื่อ host เท่านั้น ไม่ได้ resolve DNS
 */
export function validateBaseUrl(raw: unknown): BaseUrlCheck {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'ต้องใส่ base URL' }
  const input = raw.trim()
  if (input.length > 300) return { ok: false, error: 'base URL ยาวเกินไป' }

  let u: URL
  try {
    u = new URL(input)
  } catch {
    return { ok: false, error: 'base URL ไม่ถูกต้อง (ตัวอย่าง: https://api.example.com/v1)' }
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'base URL ต้องขึ้นต้นด้วย https://' }
  if (u.username || u.password) return { ok: false, error: 'base URL ห้ามมี user:password' }
  if (u.search || u.hash) return { ok: false, error: 'base URL ห้ามมี ? หรือ #' }

  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('[') // IPv6 literal
  ) {
    return { ok: false, error: 'ไม่อนุญาต host ภายใน' }
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    const isPrivate =
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    if (isPrivate) return { ok: false, error: 'ไม่อนุญาต IP ภายใน' }
  }

  return { ok: true, url: u.origin + u.pathname.replace(/\/+$/, '') }
}
