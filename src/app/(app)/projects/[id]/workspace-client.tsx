'use client'

import { useEffect, useState, useCallback, useRef, ChangeEvent } from 'react'
import AgentsPanel, { type Agent } from './agents-panel'
import FilesPanel from './files-panel'

type Tab = 'chat' | 'agents' | 'tasks' | 'files' | 'usage'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

interface TaskRow {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  error: string | null
  created_at: string
}

// polling แทน Realtime ตามหลักการของสเปค (ข้อ 2: ถ้าไม่จำเป็นต้องใช้ Realtime ให้ใช้ Polling)
const POLL_MS = 3000

const STATUS_COLOR: Record<TaskRow['status'], string> = {
  pending: 'text-neutral-400',
  running: 'text-indigo-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-neutral-600',
}

export default function WorkspaceClient({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const [tab, setTab] = useState<Tab>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const [msgRes, taskRes, agentRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/messages`),
      fetch(`/api/projects/${projectId}/tasks`),
      fetch(`/api/projects/${projectId}/agents`),
    ])
    if (msgRes.ok) setMessages((await msgRes.json()).messages)
    if (taskRes.ok) setTasks((await taskRes.json()).tasks)
    if (agentRes.ok) setAgents((await agentRes.json()).agents)
  }, [projectId])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (tab === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, tab])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!instruction.trim() || sending) return
    setSending(true)
    setSendError('')

    const res = await fetch(`/api/projects/${projectId}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction }),
    })
    const body = await res.json()
    setSending(false)

    if (!res.ok) {
      setSendError(body.error ?? 'สั่งงานไม่สำเร็จ')
      return
    }
    setInstruction('')
    refresh()
  }

  async function handleRetry(taskId: string) {
    await fetch(`/api/tasks/${taskId}/retry`, { method: 'POST' })
    refresh()
  }

  async function handleCancel(taskId: string) {
    await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' })
    refresh()
  }

  return (
    <div className="mx-auto flex h-screen max-w-4xl flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h1 className="font-medium">{projectName}</h1>
        <nav className="flex gap-1 text-sm">
          {(['chat', 'agents', 'tasks', 'files', 'usage'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 capitalize transition ${
                tab === t ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {tab === 'chat' && (
          <div className="space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'ml-auto bg-indigo-600 text-white'
                    : 'bg-neutral-900 text-neutral-200'
                }`}
              >
                {m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {tab === 'agents' && (
          <AgentsPanel projectId={projectId} agents={agents} onChanged={refresh} />
        )}

        {tab === 'tasks' && (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.title}</span>
                  <span className={STATUS_COLOR[t.status]}>{t.status}</span>
                </div>
                {t.error && <p className="mt-1 text-xs text-red-400">{t.error}</p>}
                <div className="mt-2 flex gap-2">
                  {(t.status === 'failed' || t.status === 'cancelled') && (
                    <button
                      onClick={() => handleRetry(t.id)}
                      className="text-xs text-indigo-400 hover:underline"
                    >
                      ลองใหม่
                    </button>
                  )}
                  {(t.status === 'pending' || t.status === 'running') && (
                    <button
                      onClick={() => handleCancel(t.id)}
                      className="text-xs text-neutral-500 hover:underline"
                    >
                      ยกเลิก
                    </button>
                  )}
                </div>
              </div>
            ))}
            {tasks.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มี Task</p>}
          </div>
        )}

        {tab === 'files' && <FilesPanel projectId={projectId} />}

        {tab === 'usage' && <UsagePanel projectId={projectId} />}
      </main>

      {tab === 'chat' && (
        <form onSubmit={handleSend} className="border-t border-neutral-800 p-4">
          {sendError && <p className="mb-2 text-sm text-red-400">{sendError}</p>}
          <div className="flex gap-2">
            <input
              value={instruction}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setInstruction(e.target.value)}
              placeholder="สั่งงานทีม AI ของคุณ..."
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-md bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {sending ? 'กำลังส่ง...' : 'ส่ง'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function UsagePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{
    budget_usd: number | null
    spent_usd: number
    usage: Array<{ provider: string; model: string; cost_usd: number; created_at: string }>
  } | null>(null)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/usage`)
      .then((r) => r.json())
      .then(setData)
  }, [projectId])

  if (!data) return null

  return (
    <div>
      <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-sm text-neutral-400">ใช้ไปแล้ว</p>
        <p className="text-2xl font-semibold">
          ${data.spent_usd.toFixed(4)}
          {data.budget_usd !== null && <span className="text-neutral-500"> / ${data.budget_usd}</span>}
        </p>
      </div>
      <div className="space-y-1">
        {data.usage.map((u, i) => (
          <div key={i} className="flex justify-between rounded-md bg-neutral-900 px-3 py-2 text-xs">
            <span>{u.provider}/{u.model}</span>
            <span>${u.cost_usd.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
