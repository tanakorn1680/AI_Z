import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase ส่ง ?code=... มาที่นี่หลังผู้ใช้ยืนยันอีเมลหรือ OAuth callback
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}/projects`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
