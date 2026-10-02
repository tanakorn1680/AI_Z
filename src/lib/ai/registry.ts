import type { ProviderAdapter } from './types'
import { anthropicAdapter } from './anthropic'
import { openaiAdapter } from './openai'
import { geminiAdapter } from './gemini'

// จุดเดียวที่ Orchestrator รู้จัก — เพิ่ม provider ใหม่ = เพิ่ม 1 บรรทัดที่นี่
const registry: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: geminiAdapter,
}

export function getAdapter(provider: string): ProviderAdapter {
  const adapter = registry[provider]
  if (!adapter) throw new Error(`ไม่รู้จัก provider: ${provider}`)
  return adapter
}
