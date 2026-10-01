'use client'

import { useState, ChangeEvent } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
        <p className="text-white">ส่งอีเมลยืนยันไปที่ {email} แล้ว</p>
        <p className="mt-2 text-sm text-neutral-400">กดลิงก์ในอีเมลเพื่อเริ่มใช้งาน</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-1 text-center text-2xl font-semibold text-white">สร้างบัญชีใหม่</h1>
      <p className="mb-6 text-center text-sm text-neutral-400">เริ่มสร้าง Workspace AI ของคุณเอง</p>

      <form onSubmit={handleSignup} className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">อีเมล</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-300">รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-indigo-600 py-2 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? 'กำลังสมัคร...' : 'สมัครสมาชิก'}
        </button>

        <p className="text-center text-sm text-neutral-400">
          มีบัญชีอยู่แล้ว? <Link href="/login" className="text-indigo-400 hover:underline">เข้าสู่ระบบ</Link>
        </p>
      </form>
    </div>
  )
}
