/**
 * Provider Adapter — สัญญากลางที่ Orchestrator เรียก
 * Orchestrator ไม่รู้จัก field เฉพาะของ Anthropic/OpenAI/Gemini เลย
 * เพิ่ม Provider ใหม่ = เขียนไฟล์ implement interface นี้ 1 ไฟล์ ไม่ต้องแก้ที่อื่น
 */

export interface CompletionRequest {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  /** ใช้เฉพาะ provider แบบ custom (OpenAI-compatible) */
  baseUrl?: string
}

export interface CompletionResult {
  text: string
  tokensIn: number
  tokensOut: number
}

/** โยนเมื่อ key ผิด/หมดอายุ — Worker ไม่ควร retry (attempts จะไม่มีวันสำเร็จ) */
export class InvalidApiKeyError extends Error {}

/** โยนเมื่อโดน rate limit — Worker ควร retry ตามรอบปกติ (ผ่าน fail_task) */
export class RateLimitError extends Error {}

/** โยนเมื่อ provider error อื่น ๆ ที่ไม่ใช่ 2 เคสข้างบน */
export class ProviderError extends Error {}

export interface ProviderAdapter {
  complete(req: CompletionRequest): Promise<CompletionResult>
}
