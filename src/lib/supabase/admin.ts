import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client — ข้าม RLS ทั้งหมด
 *
 * กฎการใช้ (แยกไฟล์ออกมาเพื่อให้สังเกตเห็นทุกครั้งที่ import):
 *   1. ใช้เฉพาะใน Worker และงานระบบ (เขียน task_results / usage / อ่าน Vault)
 *   2. ห้ามใช้ตัดสินว่า "ผู้ใช้คนนี้เป็นใคร" — ให้ยืนยันตัวตนด้วย createClient() จาก server.ts
 *   3. ทุก query ต้องกรองด้วย project_id / user_id ที่ผ่านการตรวจสิทธิ์แล้วเสมอ
 *      เพราะ RLS จะไม่ช่วยอะไรที่นี่
 *
 * 'server-only' ทำให้ build ล้มทันทีถ้าไฟล์นี้ถูก import จากโค้ดฝั่ง browser
 * ไม่ผูกกับ cookie ใด ๆ (โค้ดเก่าผูกไว้ ซึ่งทำให้สับสนว่าใครเป็นผู้เรียก)
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
