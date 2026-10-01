import {
  type ProviderAdapter,
  type CompletionRequest,
  type CompletionResult,
  InvalidApiKeyError,
  RateLimitError,
  ProviderError,
} from './types'

// รูปแบบ response ของ POST /v1/messages เท่าที่เราต้องใช้จริง
// (ยืนยันจากเอกสาร TypeScript SDK ของ Anthropic — ไม่ใช้ SDK เพื่อลด dependency ใน MVP)
interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>
  usage: { input_tokens: number; output_tokens: number }
}

export const anthropicAdapter: ProviderAdapter = {
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userPrompt }],
      }),
    })

    if (res.status === 401) throw new InvalidApiKeyError('Anthropic: API key ไม่ถูกต้อง')
    if (res.status === 429) throw new RateLimitError('Anthropic: rate limit')
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(`Anthropic error ${res.status}: ${body.slice(0, 500)}`)
    }

    const data = (await res.json()) as AnthropicMessageResponse
    const text = data.content.find((b) => b.type === 'text')?.text ?? ''

    return {
      text,
      tokensIn: data.usage.input_tokens,
      tokensOut: data.usage.output_tokens,
    }
  },
}
