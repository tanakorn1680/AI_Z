import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * หา API key ที่ agent ตัวนี้ต้องใช้ (เรียกฝั่งเซิร์ฟเวอร์ด้วย admin client เท่านั้น)
 * 1) key ของ agent เอง (ระบบใหม่: 1 key ต่อ 1 agent)
 * 2) ถ้าไม่มี ใช้ key ร่วมตาม provider ของเจ้าของ project (agent ที่สร้างไว้ก่อนระบบใหม่)
 */
export async function resolveAgentKey(
  admin: SupabaseClient,
  agent: { id: string; provider: string },
  ownerId: string
): Promise<string | null> {
  const own = await admin.rpc('get_agent_key', { p_agent_id: agent.id })
  if (typeof own.data === 'string' && own.data.length > 0) return own.data

  // rpc ไม่มี (ยังไม่ได้รัน migration 0004) หรือ agent ไม่มี key ของตัวเอง → ลองแบบเดิม
  const legacy = await admin.rpc('get_api_key', { p_user_id: ownerId, p_provider: agent.provider })
  return typeof legacy.data === 'string' && legacy.data.length > 0 ? legacy.data : null
}
