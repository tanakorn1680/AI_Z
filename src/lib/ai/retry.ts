import {
  type ProviderAdapter,
  type CompletionRequest,
  type CompletionResult,
  ProviderError,
} from './types'

// ข้อผิดพลาดฝั่งผู้ให้บริการที่มักหายเองในไม่กี่วินาที (เช่น Gemini 503 "high demand", Anthropic 529 overloaded)
const TRANSIENT_STATUS = new Set([500, 502, 503, 504, 529])

/**
 * เรียก adapter.complete พร้อม retry สั้น ๆ เมื่อเจอ error ชั่วคราวของ provider
 * ไม่ retry: key ผิด (InvalidApiKeyError), rate limit (RateLimitError ต้องรอนานกว่านี้ — Worker มี retry ผ่านคิวอยู่แล้ว),
 * และ error 4xx อื่น ๆ ที่ลองซ้ำก็ไม่หาย
 */
export async function completeWithRetry(
  adapter: ProviderAdapter,
  req: CompletionRequest,
  delaysMs: readonly number[] = [1500, 4000]
): Promise<CompletionResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await adapter.complete(req)
    } catch (err) {
      const status = err instanceof ProviderError ? err.status : undefined
      const transient = status !== undefined && TRANSIENT_STATUS.has(status)
      if (!transient) throw err
      if (attempt >= delaysMs.length) {
        throw new ProviderError(
          `AI provider ไม่ว่างชั่วคราว (HTTP ${status}) ลองใหม่อีกครั้งในอีกสักครู่\n${(err as Error).message}`,
          status
        )
      }
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}
