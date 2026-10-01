'use client'

import { useState, ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function NewProjectForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(body.error ?? 'สร้างไม่สำเร็จ')
      return
    }
    setName('')
    router.push(`/projects/${body.project.id}`)
  }

  return (
    <form onSubmit={handleCreate} className="flex gap-2">
      <input
        value={name}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        placeholder="ชื่อ Project ใหม่"
        className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-indigo-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
      >
        สร้าง
      </button>
      {error && <p className="self-center text-sm text-red-400">{error}</p>}
    </form>
  )
}
