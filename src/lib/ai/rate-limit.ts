import { RateLimitError } from './types'

/**
 * สร้าง RateLimitError จาก response 429 โดยเก็บข้อความจริงของ provider (บอกว่าโควตาต่อนาที/ต่อวัน/รุ่นไหน)
 * และเวลาที่ให้รอ จาก header Retry-After หรือ RetryInfo.retryDelay ของ Gemini (เช่น "34s")
 */
export async function toRateLimitError(res: Response, label: string): Promise<RateLimitError> {
  let retryAfter: number | undefined
  const header = res.headers.get('retry-after')?.trim()
  if (header && /^\d+(\.\d+)?$/.test(header)) retryAfter = Math.ceil(Number(header))

  let detail = ''
  try {
    const text = await res.text()
    try {
      const body = JSON.parse(text) as { error?: { message?: string; details?: Array<{ retryDelay?: string }> } }
      detail = body.error?.message ?? text
      for (const d of body.error?.details ?? []) {
        const m = d.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/)
        if (m && retryAfter === undefined) retryAfter = Math.ceil(Number(m[1]))
      }
    } catch {
      detail = text
    }
  } catch {
    // อ่าน body ไม่ได้ — ใช้ข้อความกลาง ๆ
  }

  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 300)
  return new RateLimitError(`${label}: โควตา/rate limit เต็ม${detail ? ` — ${detail}` : ''}`, retryAfter)
}
