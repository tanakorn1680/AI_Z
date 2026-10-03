import type { ProviderAdapter } from './types'
import { anthropicAdapter } from './anthropic'
import { openaiAdapter } from './openai'
import { geminiAdapter } from './gemini'
import { openaiCompatibleAdapter } from './openai-compatible'
import { PROVIDER_LIST } from './providers'

// จุดเดียวที่ Orchestrator รู้จัก
// provider แบบ OpenAI-compatible ถูกสร้างอัตโนมัติจาก PROVIDER_LIST (providers.ts)
// เพิ่มค่ายใหม่ที่ใช้ API แบบ OpenAI = เพิ่ม 1 แถวใน PROVIDER_LIST + 1 ค่าใน enum DB
const registry: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: geminiAdapter,
}
for (const p of PROVIDER_LIST) {
  if (p.kind === 'openai_compatible') registry[p.id] = openaiCompatibleAdapter({ presetBase: p.baseUrl, outputHeadroom: p.outputHeadroom })
}

export function getAdapter(provider: string): ProviderAdapter {
  const adapter = registry[provider]
  if (!adapter) throw new Error(`ไม่รู้จัก provider: ${provider}`)
  return adapter
}
