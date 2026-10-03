import { RateLimitError, InsufficientCreditError } from './types'

/**
 * สร้าง RateLimitError จาก response 429 โดยเก็บข้อความจริงของ provider (บอกว่าโควตาต่อนาที/ต่อวัน/รุ่นไหน)
 * และเวลาที่ให้รอ จาก header Retry-After หรือ RetryInfo.retryDelay ของ Gemini (เช่น "34s")
 */
export async function toRateLimitError(
  res: Response,
  label: string
): Promise<RateLimitError | InsufficientCreditError> {
  let retryAfter: number | undefined
  const header = res.headers.get('retry-after')?.trim()
  if (header && /^\d+(\.\d+)?$/.test(header)) retryAfter = Math.ceil(Number(header))

  let detail = ''
  let code = ''
  try {
    const text = await res.text()
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string; code?: string | number; details?: Array<{ retryDelay?: string }> }
      }
      detail = body.error?.message ?? text
      code = String(body.error?.code ?? '')
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

  // ยอดเงิน/เครดิตหมด ≠ rate limit: Z.ai ตอบ 429 + "Insufficient balance or no resource package",
  // OpenAI ตอบ 429 + code insufficient_quota — รอแล้วไม่หาย ต้องเติมเงินหรือเปลี่ยน provider
  // (ไม่จับคำว่า billing เฉย ๆ เพราะ Gemini ใช้ข้อความ quota/billing กับโควตาต่อนาทีของ free tier ด้วย)
  if (
    code === 'insufficient_quota' ||
    /insufficient[_ ]?(balance|funds|credit)|no resource package|please recharge|out of credits/i.test(detail)
  ) {
    return new InsufficientCreditError(
      `${label}: เครดิต/ยอดเงินในบัญชีหมด — เติมเครดิตที่คอนโซลของ provider หรือเปลี่ยน agent นี้ไปใช้ provider อื่น${detail ? `\n${detail}` : ''}`
    )
  }

  return new RateLimitError(`${label}: โควตา/rate limit เต็ม${detail ? ` — ${detail}` : ''}`, retryAfter)
}
