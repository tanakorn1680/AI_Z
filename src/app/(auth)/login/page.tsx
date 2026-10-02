'use client'

import { useState, ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/projects')
    router.refresh()
  }

  return (
    <div>
      <h1 className="mb-1 text-center text-2xl font-semibold text-white">Multi-Agent Workspace</h1>
      <p className="mb-6 text-center text-sm text-neutral-400">เข้าสู่ระบบเพื่อจัดการทีม AI ของคุณ</p>

      <form onSubmit={handleLogin} className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
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
          <label className="mb-1 block text-sm text-neutral-300">รหัสผ่าน</label>
          <input
            type="password"
            required
            autoComplete="current-password"
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
          {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>

        <p className="text-center text-sm text-neutral-400">
          ยังไม่มีบัญชี? <Link href="/signup" className="text-indigo-400 hover:underline">สมัครสมาชิก</Link>
        </p>
      </form>
    </div>
  )
}
