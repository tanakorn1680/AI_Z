import { listModels, ListModelsError, type ListModelsResult } from './list-models'
import { getProviderMeta } from './providers'

/**
 * เดาว่า API key เป็นของผู้ให้บริการเจ้าไหน จากหน้าตาของ key (prefix)
 * เจ้าที่ key ไม่มี prefix เฉพาะ (Mistral, Together, Z.ai, custom) คืน [] — ให้ผู้ใช้เลือกเอง
 * หมายเหตุ: ใช้แค่ "เรียงลำดับตัวเลือกที่จะลอง" ไม่ได้ตัดสินจาก prefix อย่างเดียว — ต้องเรียก API ของเจ้านั้นสำเร็จจริงถึงจะยืนยัน
 */
export function candidateProviders(apiKey: string): string[] {
  const k = apiKey.trim()
  if (k.startsWith('sk-ant-')) return ['anthropic']
  if (k.startsWith('sk-or-')) return ['openrouter']
  if (k.startsWith('gsk_')) return ['groq']
  if (k.startsWith('AIza')) return ['google']
  if (k.startsWith('xai-')) return ['xai']
  if (k.startsWith('sk-')) {
    // sk- เฉย ๆ ใช้ร่วมกันทั้ง OpenAI และ DeepSeek — key ของ DeepSeek หน้าตาเป็น sk- + hex 32 ตัว ลองตัวที่น่าจะใช่ก่อน
    return /^sk-[0-9a-f]{32}$/i.test(k) ? ['deepseek', 'openai'] : ['openai', 'deepseek']
  }
  return []
}

export type ProbeResult =
  | { ok: true; provider: string; label: string; models: ListModelsResult['models']; source: ListModelsResult['source'] }
  | {
      ok: false
      reason: 'unknown_provider' | 'invalid_key' | 'bad_request' | 'upstream'
      message: string
    }

type ListFn = (provider: string, apiKey: string, baseUrl?: string | null) => Promise<ListModelsResult>

/**
 * ตรวจ key + ดึงรายชื่อโมเดลในครั้งเดียว
 * - ระบุ provider มา = ลองเฉพาะเจ้านั้น (ใช้ตอนผู้ใช้เลือกเอง หรือ custom base URL)
 * - ไม่ระบุ = เดาจาก prefix แล้วลองทีละเจ้าตามลำดับ เจ้าแรกที่ตอบรับ key ได้คือเจ้าที่ใช่
 */
export async function probeKey(
  apiKey: string,
  opts: { provider?: string; baseUrl?: string | null; list?: ListFn } = {}
): Promise<ProbeResult> {
  const list = opts.list ?? listModels
  const key = apiKey.trim()
  if (key.length < 8) return { ok: false, reason: 'bad_request', message: 'API key สั้นเกินไป' }

  const candidates = opts.provider ? [opts.provider] : candidateProviders(key)
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'unknown_provider',
      message: 'ดูไม่ออกว่า key นี้เป็นของผู้ให้บริการเจ้าไหน — เลือกผู้ให้บริการเองได้เลย',
    }
  }

  let upstreamMessage: string | null = null
  const rejectedBy: string[] = []
  for (const provider of candidates) {
    const meta = getProviderMeta(provider)
    if (!meta) return { ok: false, reason: 'bad_request', message: 'ผู้ให้บริการไม่ถูกต้อง' }
    try {
      const r = await list(provider, key, opts.baseUrl)
      return { ok: true, provider, label: meta.label, models: r.models, source: r.source }
    } catch (e) {
      if (e instanceof ListModelsError) {
        if (e.kind === 'invalid_key') {
          rejectedBy.push(meta.label)
          continue
        }
        if (e.kind === 'bad_request') return { ok: false, reason: 'bad_request', message: e.message }
        upstreamMessage = e.message // ติดต่อไม่ได้/provider ล่ม — อย่าสรุปว่า key ผิด
        continue
      }
      upstreamMessage = 'ตรวจ key ไม่สำเร็จ'
    }
  }

  if (upstreamMessage) return { ok: false, reason: 'upstream', message: upstreamMessage }
  return {
    ok: false,
    reason: 'invalid_key',
    message: `key นี้ใช้กับ ${rejectedBy.join(' / ')} ไม่ได้ (ไม่ถูกต้อง หมดอายุ หรือไม่มีสิทธิ์)`,
  }
}
