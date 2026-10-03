'use client'

import { useEffect, useState } from 'react'

interface AgentUsage {
  key: string
  name: string
  provider: string
  model: string
  requests: number
  tokens_in: number
  tokens_out: number
  tokens: number
}

interface UsageData {
  total: { requests: number; tokens_in: number; tokens_out: number; tokens: number }
  by_agent: AgentUsage[]
  recent: Array<{ provider: string; model: string; tokens_in: number; tokens_out: number; created_at: string }>
  truncated: boolean
}

const fmt = (n: number) => n.toLocaleString('th-TH')

export default function UsagePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      const res = await fetch(`/api/projects/${projectId}/usage`)
      if (!alive) return
      if (!res.ok) {
        setError('โหลดข้อมูลการใช้งานไม่สำเร็จ')
        return
      }
      setError('')
      setData((await res.json()) as UsageData)
    }
    void load()
    const t = setInterval(() => void load(), 10000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [projectId])

  if (error && !data) return <p className="text-sm text-red-400">{error}</p>
  if (!data) return <p className="text-sm text-neutral-500">กำลังโหลด...</p>

  const max = Math.max(1, ...data.by_agent.map((a) => a.tokens))

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-sm text-neutral-400">โทเคนที่ใช้รวมทุก AI</p>
        <p className="text-3xl font-semibold tabular-nums">{fmt(data.total.tokens)}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-neutral-400">
          <div>
            <p>เข้า (input)</p>
            <p className="text-sm text-neutral-200 tabular-nums">{fmt(data.total.tokens_in)}</p>
          </div>
          <div>
            <p>ออก (output)</p>
            <p className="text-sm text-neutral-200 tabular-nums">{fmt(data.total.tokens_out)}</p>
          </div>
          <div>
            <p>เรียก AI</p>
            <p className="text-sm text-neutral-200 tabular-nums">{fmt(data.total.requests)} ครั้ง</p>
          </div>
        </div>
        {data.truncated && (
          <p className="mt-2 text-xs text-amber-400">ข้อมูลเยอะมาก — นับเฉพาะ 20,000 รายการล่าสุด</p>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-300">แยกตาม AI</h2>
        <div className="space-y-2">
          {data.by_agent.map((a) => (
            <div key={a.key} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{a.name}</span>
                <span className="shrink-0 font-semibold tabular-nums">{fmt(a.tokens)}</span>
              </div>
              <p className="truncate text-xs text-neutral-500">
                {a.provider}/{a.model}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(a.tokens / max) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-neutral-500 tabular-nums">
                เข้า {fmt(a.tokens_in)} · ออก {fmt(a.tokens_out)} · {fmt(a.requests)} ครั้ง
              </p>
            </div>
          ))}
          {data.by_agent.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มีการใช้งาน</p>}
        </div>
      </section>

      {data.recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-neutral-300">การเรียกล่าสุด</h2>
          <div className="space-y-1">
            {data.recent.map((u, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-md bg-neutral-900 px-3 py-2 text-xs">
                <span className="min-w-0 truncate">
                  {u.provider}/{u.model}
                </span>
                <span className="shrink-0 text-neutral-400 tabular-nums">
                  {fmt(u.tokens_in + u.tokens_out)} โทเคน
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
