import {
  type ProviderAdapter,
  type CompletionRequest,
  type CompletionResult,
  InvalidApiKeyError,
  RateLimitError,
  ProviderError,
} from './types'

// รูปแบบ response ของ models.generateContent เท่าที่เราต้องใช้จริง
// (ยืนยันจากเอกสาร ai.google.dev — Gemini แยก systemInstruction ออกจาก contents)
interface GeminiGenerateContentResponse {
  candidates: Array<{ content: { parts: Array<{ text?: string }> } }>
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number }
}

export const geminiAdapter: ProviderAdapter = {
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': req.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens },
      }),
    })

    if (res.status === 401 || res.status === 403) {
      throw new InvalidApiKeyError('Gemini: API key ไม่ถูกต้องหรือไม่มีสิทธิ์')
    }
    if (res.status === 429) throw new RateLimitError('Gemini: rate limit')
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(`Gemini error ${res.status}: ${body.slice(0, 500)}`)
    }

    const data = (await res.json()) as GeminiGenerateContentResponse
    const text = data.candidates[0]?.content.parts.map((p) => p.text ?? '').join('') ?? ''

    return {
      text,
      tokensIn: data.usageMetadata.promptTokenCount,
      tokensOut: data.usageMetadata.candidatesTokenCount,
    }
  },
}
