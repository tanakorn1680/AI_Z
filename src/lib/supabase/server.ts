import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Client สำหรับ request ของผู้ใช้ — ใช้ anon key + cookie session
 * ทุก query ผ่าน RLS จึงเห็นเฉพาะข้อมูลของผู้ใช้คนนั้น
 * นี่คือ client เริ่มต้นสำหรับ API route และ Server Component ทุกตัว
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // เรียกจาก Server Component: เขียน cookie ไม่ได้ ปล่อยให้ middleware รีเฟรชแทน
          }
        },
      },
    }
  )
}
