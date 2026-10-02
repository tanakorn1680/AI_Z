'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PROVIDER_LIST, getProviderMeta } from '@/lib/ai/providers'

export interface Agent {
  id: string
  name: string
  provider: string
  model: string
  role: string
  base_url?: string | null
}

interface Credential {
  id: string
  provider: string
  last4: string
}

const ROLES = ['manager', 'researcher', 'coder', 'reviewer', 'custom'] as const

const inputCls =
  'w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-indigo-500'
const labelCls = 'mb-1 block text-xs text-neutral-400'
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50'

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
    </svg>
  )
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}

export default function AgentsPanel({
  projectId,
  agents,
  onChanged,
}: {
  projectId: string
  agents: Agent[]
  onChanged: () => void
}) {
  const [credentials, setCredentials] = useState<Credential[]>([])

  const loadCredentials = useCallback(async () => {
    const res = await fetch('/api/credentials')
    if (res.ok) setCredentials(((await res.json()) as { credentials: Credential[] }).credentials ?? [])
  }, [])

  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  const keyedProviders = new Set(credentials.map((c) => c.provider))
  const hasManager = agents.some((a) => a.role === 'manager')

  return (
    <div className="space-y-8">
      {!hasManager && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
          ต้องมี Agent role &quot;manager&quot; อย่างน้อย 1 ตัวก่อนจึงจะสั่งงานทีมได้
        </div>
      )}

      <AgentList
        projectId={projectId}
        agents={agents}
        keyedProviders={keyedProviders}
        onChanged={onChanged}
      />
      <AddAgentForm
        projectId={projectId}
        keyedProviders={keyedProviders}
        onChanged={onChanged}
      />
      <KeysSection credentials={credentials} onChanged={loadCredentials} />
    </div>
  )
}

function AgentList({
  projectId,
  agents,
  keyedProviders,
  onChanged,
}: {
  projectId: string
  agents: Agent[]
  keyedProviders: Set<string>
  onChanged: () => void
}) {
  const [error, setError] = useState('')

  async function remove(a: Agent) {
    if (!window.confirm(`ลบ agent "${a.name}" ?`)) return
    setError('')
    const res = await fetch(`/api/projects/${projectId}/agents/${a.id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError(await readError(res, 'ลบไม่สำเร็จ'))
      return
    }
    onChanged()
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-neutral-300">Agents ({agents.length})</h2>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="space-y-2">
        {agents.map((a) => {
          const meta = getProviderMeta(a.provider)
          const missingKey = !keyedProviders.has(a.provider)
          return (
            <div
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{a.name}</div>
                <div className="truncate text-neutral-400">
                  {a.role} · {meta?.label ?? a.provider} / {a.model}
                </div>
                {a.base_url && <div className="truncate text-xs text-neutral-500">{a.base_url}</div>}
                {missingKey && (
                  <div className="mt-1 text-xs text-amber-400">
                    ยังไม่มี API key ของ {meta?.label ?? a.provider} — เพิ่มด้านล่าง
                  </div>
                )}
              </div>
              <button
                onClick={() => remove(a)}
                aria-label={`ลบ ${a.name}`}
                className="shrink-0 rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-red-400"
              >
                <TrashIcon />
              </button>
            </div>
          )
        })}
        {agents.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มี Agent</p>}
      </div>
    </section>
  )
}

function AddAgentForm({
  projectId,
  keyedProviders,
  onChanged,
}: {
  projectId: string
  keyedProviders: Set<string>
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(PROVIDER_LIST[0]?.id ?? 'anthropic')
  const [model, setModel] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('manager')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [priceIn, setPriceIn] = useState('')
  const [priceOut, setPriceOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const meta = getProviderMeta(provider)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')

    const payload: Record<string, unknown> = {
      name,
      provider,
      model,
      role,
      system_prompt: systemPrompt,
    }
    if (maxTokens.trim()) payload.max_tokens = Number(maxTokens)
    if (meta?.customBaseUrl) payload.base_url = baseUrl
    if (priceIn.trim() || priceOut.trim()) {
      payload.price_in = Number(priceIn)
      payload.price_out = Number(priceOut)
    }

    const res = await fetch(`/api/projects/${projectId}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)

    if (!res.ok) {
      setError(await readError(res, 'เพิ่ม agent ไม่สำเร็จ'))
      return
    }
    setName('')
    setModel('')
    setSystemPrompt('')
    setMaxTokens('')
    setPriceIn('')
    setPriceOut('')
    setNotice(`เพิ่ม agent แล้ว${keyedProviders.has(provider) ? '' : ' — อย่าลืมเพิ่ม API key ของ provider นี้'}`)
    onChanged()
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-neutral-300">เพิ่ม Agent</h2>
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>ชื่อ agent</label>
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น Manager หลัก"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} className={inputCls}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
              {PROVIDER_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {keyedProviders.has(p.id) ? ' (มี key แล้ว)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Model</label>
            <input
              required
              maxLength={100}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="ชื่อรุ่นตามเอกสารของค่าย"
              className={inputCls}
            />
          </div>
        </div>

        {meta?.customBaseUrl && (
          <div>
            <label className={labelCls}>Base URL (endpoint แบบ OpenAI-compatible)</label>
            <input
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className={inputCls}
            />
          </div>
        )}

        <div>
          <label className={labelCls}>System prompt (ไม่บังคับ)</label>
          <textarea
            rows={3}
            maxLength={10000}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="บอกหน้าที่และสไตล์การทำงานของ agent นี้"
            className={inputCls}
          />
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">ตั้งค่าเพิ่มเติม</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Max tokens</label>
              <input
                type="number"
                min={1}
                max={200000}
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="ใช้ค่าของ project"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>ราคา input ($/1M token)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={priceIn}
                onChange={(e) => setPriceIn(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>ราคา output ($/1M token)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={priceOut}
                onChange={(e) => setPriceOut(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            ถ้าไม่ใส่ราคา ค่าใช้จ่ายของรุ่นนี้จะนับเป็น $0 และระบบคุมงบจะไม่ทำงานกับรุ่นนี้
            ราคาจะถูกบันทึกเฉพาะรุ่นที่ยังไม่เคยมีราคา (ไม่เขียนทับ)
          </p>
        </details>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}

        <button type="submit" disabled={busy} className={primaryBtn}>
          <PlusIcon />
          {busy ? 'กำลังเพิ่ม...' : 'เพิ่ม Agent'}
        </button>
      </form>
    </section>
  )
}

function KeysSection({
  credentials,
  onChanged,
}: {
  credentials: Credential[]
  onChanged: () => void
}) {
  const [provider, setProvider] = useState(PROVIDER_LIST[0]?.id ?? 'anthropic')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const meta = getProviderMeta(provider)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(await readError(res, 'บันทึก key ไม่สำเร็จ'))
      return
    }
    setApiKey('')
    setNotice('บันทึก key แล้ว')
    onChanged()
  }

  async function remove(p: string) {
    if (!window.confirm('ลบ API key นี้ ?')) return
    setError('')
    const res = await fetch(`/api/credentials?provider=${encodeURIComponent(p)}`, { method: 'DELETE' })
    if (!res.ok) {
      setError(await readError(res, 'ลบ key ไม่สำเร็จ'))
      return
    }
    onChanged()
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-neutral-300">API Keys</h2>
      <div className="mb-3 space-y-2">
        {credentials.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <span className="text-neutral-500">
                <KeyIcon />
              </span>
              {getProviderMeta(c.provider)?.label ?? c.provider}
              <span className="font-mono text-xs text-neutral-500">••••{c.last4}</span>
            </span>
            <button
              onClick={() => remove(c.provider)}
              aria-label="ลบ key"
              className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-red-400"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        {credentials.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มี API key</p>}
      </div>

      <form onSubmit={save} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
              {PROVIDER_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>API key</label>
            <input
              required
              type="password"
              autoComplete="off"
              minLength={8}
              maxLength={500}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={meta?.keyPlaceholder}
              className={inputCls}
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          เก็บเข้ารหัสใน Vault และไม่ส่งกลับมาแสดงอีก (เห็นแค่ 4 ตัวท้าย) — บันทึกซ้ำ provider เดิมเพื่อเปลี่ยน key
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          <KeyIcon />
          {busy ? 'กำลังบันทึก...' : 'บันทึก key'}
        </button>
      </form>
    </section>
  )
}
