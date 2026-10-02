import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * คำนวณค่าใช้จ่ายจากตาราง model_prices (ผู้ดูแลกรอกเอง — ดู README)
 * ถ้าไม่มีราคาของรุ่นนั้น คืน 0 และแจ้งเตือนใน log แทนที่จะเดาตัวเลข
 * (เดาราคาแล้วผิดจะทำให้ budget control ทั้งระบบไม่น่าเชื่อถือ)
 */
export async function calculateCost(
  admin: SupabaseClient,
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number
): Promise<number> {
  const { data } = await admin
    .from<{ in_per_mtok: number; out_per_mtok: number }>('model_prices')
    .select('in_per_mtok, out_per_mtok')
    .eq('provider', provider)
    .eq('model', model)
    .maybeSingle()

  if (!data) {
    console.warn(`[pricing] ไม่มีราคาสำหรับ ${provider}/${model} ใน model_prices — คิดเป็น $0`)
    return 0
  }

  return (tokensIn / 1_000_000) * data.in_per_mtok + (tokensOut / 1_000_000) * data.out_per_mtok
}
