import { createClient } from './server'

/**
 * ยืนยันตัวตนผู้เรียก API route
 * ใช้ getUser() (ตรวจกับ Supabase Auth server) ไม่ใช่ getSession() ที่เชื่อ cookie ตรง ๆ
 * คืน supabase client ที่ผูกกับผู้ใช้นี้ (ผ่าน RLS) เพื่อใช้ต่อในคำขอเดียวกัน
 */
export async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return { supabase, user }
}
