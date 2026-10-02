import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// path "/" ไม่เคยมีไฟล์มาก่อน (login/signup อยู่ใต้ (auth), projects อยู่ใต้ (app) —
// วงเล็บเป็น route group ไม่นับเป็นส่วนของ URL) ทำให้เปิด domain เปล่า ๆ เจอ 404
// หน้านี้แค่เช็คว่าล็อกอินหรือยังแล้วเด้งไปหน้าที่ถูกต้อง
export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  redirect(user ? '/projects' : '/login')
}
