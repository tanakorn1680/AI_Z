import {
  type ProviderAdapter,
  type CompletionRequest,
  type CompletionResult,
  ProviderError,
  RateLimitError,
} from './types'

// ข้อผิดพลาดฝั่งผู้ให้บริการที่มักหายเองในไม่กี่วินาที (เช่น Gemini 503 "high demand", Anthropic 529 overloaded)
const TRANSIENT_STATUS = new Set([500, 502, 503, 504, 529])

export interface RetryOptions {
  /** หน่วงก่อนลองใหม่แต่ละรอบเมื่อเจอ error ชั่วคราว (มิลลิวินาที) */
  transientDelaysMs?: readonly number[]
  /**
   * ถ้า provider บอกให้รอไม่เกินกี่วินาทีเมื่อชน rate limit ให้รอแล้วลองใหม่ 1 ครั้งในคำขอเดียวกัน
   * ใช้กับขั้นวางแผน (อยู่ในคำขอ HTTP ของผู้ใช้) — Worker ไม่ใช้ เพราะ Worker หน่วงผ่านคิวแทน
   */
  rateLimitWaitMaxSeconds?: number
}

/**
 * เรียก adapter.complete พร้อม retry สั้น ๆ เมื่อเจอ error ชั่วคราวของ provider
 * ไม่ retry: key ผิด (InvalidApiKeyError) และ error 4xx อื่น ๆ ที่ลองซ้ำก็ไม่หาย
 */
export async function completeWithRetry(
  adapter: ProviderAdapter,
  req: CompletionRequest,
  opts: RetryOptions = {}
): Promise<CompletionResult> {
  const delays = opts.transientDelaysMs ?? [1500, 4000]
  const rlMax = opts.rateLimitWaitMaxSeconds ?? 0
  let rateLimitRetried = false

  for (let attempt = 0; ; attempt++) {
    try {
      return await adapter.complete(req)
    } catch (err) {
      if (
        err instanceof RateLimitError &&
        !rateLimitRetried &&
        err.retryAfterSeconds !== undefined &&
        err.retryAfterSeconds <= rlMax
      ) {
        rateLimitRetried = true
        await new Promise((resolve) => setTimeout(resolve, err.retryAfterSeconds! * 1000 + 500))
        attempt-- // การรอ rate limit ไม่กินโควตารอบของ error ชั่วคราว
        continue
      }

      const status = err instanceof ProviderError ? err.status : undefined
      const transient = status !== undefined && TRANSIENT_STATUS.has(status)
      if (!transient) throw err
      if (attempt >= delays.length) {
        throw new ProviderError(
          `AI provider ไม่ว่างชั่วคราว (HTTP ${status}) ลองใหม่อีกครั้งในอีกสักครู่\n${(err as Error).message}`,
          status
        )
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
    }
  }
}
