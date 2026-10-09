'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { ArrowDownIcon, CloseIcon, SendIcon, Spinner } from './icons'

export interface PlanTaskView {
  title: string
  description?: string
  /** ชื่อ AI ที่รับงาน */
  agent: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  /** มีค่า = ข้อความนี้คือผลงานของ task (แสดงเป็นการ์ดผลงาน) */
  task_id?: string | null
  /** แผนงานที่หัวหน้าทีมเสนอ รอผู้ใช้กดยืนยัน */
  plan?: { tasks: PlanTaskView[] } | null
  plan_status?: 'pending' | 'started' | 'dismissed' | null
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** ห่างกันเกินนี้ (นาที) ถึงจะแสดงป้ายเวลาคั่น */
const TIME_GAP_MIN = 15
/** ห่างจากก้นแชทไม่เกินนี้ (px) ถือว่า "อยู่ล่างสุด" */
const BOTTOM_THRESHOLD = 80

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60000
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === new Date().toDateString()) return time
  const date = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  return `${date} ${time}`
}

type Part = { kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string }

/** แยกบล็อกโค้ด ```...``` ออกจากข้อความปกติ */
function splitContent(content: string): Part[] {
  const parts: Part[] = []
  const re = /```([\w+-]*)[ \t]*\r?\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', text: content.slice(last, m.index) })
    parts.push({ kind: 'code', lang: m[1] ?? '', text: (m[2] ?? '').replace(/\n$/, '') })
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push({ kind: 'text', text: content.slice(last) })
  return parts
    .map((p) => (p.kind === 'text' ? { ...p, text: p.text.replace(/^\n+|\n+$/g, '') } : p))
    .filter((p) => p.text.length > 0)
}

// ---------------------------------------------------------------------------
// ชิ้นส่วนย่อย
// ---------------------------------------------------------------------------

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // เบราว์เซอร์ไม่อนุญาตให้คัดลอก — ข้ามไป
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 pl-3 pr-1 text-xs text-neutral-500">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-2 text-neutral-300 active:bg-neutral-800"
        >
          {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed text-neutral-200">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** แผนงานที่หัวหน้าทีมเสนอ — เริ่มงานจริงต่อเมื่อผู้ใช้กดยืนยันเท่านั้น */
function PlanCard({ m, projectId, onChanged }: { m: Message; projectId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<'start' | 'dismiss' | null>(null)
  const [error, setError] = useState('')
  const tasks = m.plan?.tasks ?? []

  async function act(action: 'start' | 'dismiss') {
    setBusy(action)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/plans/${m.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown }
        setError(typeof body.error === 'string' ? body.error : 'ทำรายการไม่สำเร็จ')
      }
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง')
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  return (
    <div className="mt-2 w-full max-w-[92%] rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3.5">
      <p className="text-xs font-medium text-neutral-400">แผนงาน · {tasks.length} งาน</p>
      <ol className="mt-2 space-y-1.5 text-sm text-neutral-200">
        {tasks.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 text-neutral-500">{i + 1}.</span>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {t.title}
              <span className="ml-1.5 text-xs text-neutral-500">· {t.agent}</span>
            </span>
          </li>
        ))}
      </ol>
      {tasks.some((t) => t.description) && (
        <details className="mt-2 text-xs text-neutral-400">
          <summary className="cursor-pointer py-1.5">ดูรายละเอียดแต่ละงาน</summary>
          <ul className="mt-1 space-y-2">
            {tasks.map((t, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <span className="font-medium text-neutral-300">{t.title}:</span> {t.description}
              </li>
            ))}
          </ul>
        </details>
      )}
      {m.plan_status === 'pending' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act('start')}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white active:bg-indigo-500 disabled:opacity-60"
          >
            {busy === 'start' && <Spinner size={14} />}
            เริ่มทำตามแผน
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act('dismiss')}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-700 px-4 text-sm text-neutral-300 active:bg-neutral-800 disabled:opacity-60"
          >
            ไม่เอาแผนนี้
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">
          {m.plan_status === 'started' ? 'เริ่มทำงานตามแผนนี้แล้ว' : 'ยกเลิกแผนนี้แล้ว'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400 [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
    </div>
  )
}

/** ผลงานของ task — บรรทัดแรกคือชื่องาน ที่เหลือพับเก็บถ้ายาว เพื่อไม่ให้แชทยาวเกินไป */
const RESULT_PREVIEW_CHARS = 500

function ResultCard({ m }: { m: Message }) {
  const [open, setOpen] = useState(false)
  const nl = m.content.indexOf('\n')
  const title = nl === -1 ? m.content : m.content.slice(0, nl)
  const body = nl === -1 ? '' : m.content.slice(nl + 1).trim()
  const long = body.length > RESULT_PREVIEW_CHARS
  const shown = open || !long ? body : `${body.slice(0, RESULT_PREVIEW_CHARS)}…`
  const parts = splitContent(shown)

  return (
    <div className="w-full max-w-[92%] rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-[15px] leading-relaxed text-neutral-100 [overflow-wrap:anywhere]">
      <p className="text-xs font-medium text-neutral-400">ผลงาน</p>
      <p className="mt-0.5 font-medium">{title}</p>
      {parts.map((p, i) =>
        p.kind === 'code' ? (
          <CodeBlock key={i} code={p.text} lang={p.lang} />
        ) : (
          <p key={i} className="mt-1.5 whitespace-pre-wrap text-neutral-200">
            {p.text}
          </p>
        ),
      )}
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 rounded px-1 py-1.5 text-sm font-medium text-indigo-400 active:bg-neutral-800"
        >
          {open ? 'พับเก็บ' : 'ดูทั้งหมด'}
        </button>
      )}
    </div>
  )
}

function MessageBubble({
  m,
  showLabel,
  projectId,
  onChanged,
}: {
  m: Message
  showLabel: boolean
  projectId: string
  onChanged: () => void
}) {
  if (m.role === 'system') {
    return (
      <p className="mx-auto max-w-[90%] text-center text-xs text-neutral-500 [overflow-wrap:anywhere]">
        {m.content}
      </p>
    )
  }

  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-[15px] leading-relaxed text-white [overflow-wrap:anywhere]">
          {m.content}
        </div>
      </div>
    )
  }

  if (m.task_id) {
    return (
      <div className="flex flex-col items-start">
        {showLabel && <span className="mb-1 ml-1 text-xs text-neutral-500">ทีม AI</span>}
        <ResultCard m={m} />
      </div>
    )
  }

  const parts = splitContent(m.content)
  return (
    <div className="flex flex-col items-start">
      {showLabel && <span className="mb-1 ml-1 text-xs text-neutral-500">ทีม AI</span>}
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-[15px] leading-relaxed text-neutral-100 [overflow-wrap:anywhere]">
        {parts.length === 0 && <span className="text-neutral-500">(ไม่มีเนื้อหา)</span>}
        {parts.map((p, i) =>
          p.kind === 'code' ? (
            <CodeBlock key={i} code={p.text} lang={p.lang} />
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {p.text}
            </p>
          ),
        )}
      </div>
      {m.plan && m.plan_status && <PlanCard m={m} projectId={projectId} onChanged={onChanged} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// หน้าแชท
// ---------------------------------------------------------------------------

export default function ChatView({
  projectId,
  messages,
  running,
  pending,
  hasAgents,
  draft,
  onDraftChange,
  onSent,
  onOpenAgents,
  onOpenTasks,
}: {
  projectId: string
  messages: Message[]
  running: number
  pending: number
  /** null = ยังโหลดรายชื่อ Agent ไม่เสร็จ */
  hasAgents: boolean | null
  draft: string
  onDraftChange: (v: string) => void
  /** เรียกให้ดึงข้อมูลใหม่ทันทีหลังส่งคำสั่ง */
  onSent: () => void
  onOpenAgents: () => void
  onOpenTasks: () => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true) // true = ผู้ใช้อยู่ล่างสุด ให้เลื่อนตามข้อความใหม่
  const lastIdRef = useRef<string | null>(null)
  const touchingRef = useRef(false) // นิ้วแตะกล่องแชทอยู่
  const userInputAtRef = useRef(0) // เวลาที่ผู้ใช้แตะ/ลาก/หมุนล้อล่าสุด
  const [showJump, setShowJump] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollerRef.current
    if (!el) return
    // เลื่อนเฉพาะกล่องแชทนี้เท่านั้น ไม่ใช้ scrollIntoView
    // เพราะมันลากทั้งหน้าเว็บ (รวมแถบบน) เลื่อนตามไปด้วย
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  function markUserInput() {
    userInputAtRef.current = Date.now()
  }

  function handleScroll() {
    const el = scrollerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
    if (nearBottom) {
      stickRef.current = true
      setShowJump(false)
      return
    }
    // ออกจากก้นแชทแล้ว: นับว่า "ผู้ใช้เลื่อนหนี" ก็ต่อเมื่อเกิดจากนิ้ว/ล้อเมาส์ของผู้ใช้จริง
    // การเลื่อนที่เบราว์เซอร์ทำเองตอนเลย์เอาต์เปลี่ยน (เช่น คีย์บอร์ดขึ้น) ไม่นับ
    if (touchingRef.current || Date.now() - userInputAtRef.current < 1500) {
      stickRef.current = false
      setShowJump(true)
    }
  }

  // เลื่อนลงล่างสุดเฉพาะตอน "มีข้อความใหม่จริง ๆ" (ดูจาก id ล่าสุด)
  // และเฉพาะเมื่อผู้ใช้อยู่ล่างสุดอยู่แล้ว — ถ้าผู้ใช้เลื่อนขึ้นไปอ่านจะไม่ดึงกลับ
  useEffect(() => {
    const last = messages[messages.length - 1]
    const lastId = last?.id ?? null
    if (lastId === lastIdRef.current) return
    const first = lastIdRef.current === null
    lastIdRef.current = lastId
    if (first || stickRef.current || last?.role === 'user') {
      scrollToBottom(!first)
    } else {
      setShowJump(true)
    }
  }, [messages, scrollToBottom])

  // เมื่อขนาดกล่องแชทเปลี่ยน (คีย์บอร์ดขึ้น / ช่องพิมพ์สูงขึ้น) ให้คงตำแหน่งล่างสุดไว้
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ช่องพิมพ์ขยายตามจำนวนบรรทัด (สูงสุด 160px)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  async function submit() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError('')
    onDraftChange('') // เคลียร์ช่องพิมพ์ทันที ถ้าล้มเหลวจะคืนข้อความให้
    stickRef.current = true
    const early = window.setTimeout(onSent, 1000) // ให้ข้อความของเราโผล่เร็วขึ้น

    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const body = await res.json().catch(() => ({}) as { error?: unknown })
      if (!res.ok) {
        onDraftChange(text)
        setError(typeof body.error === 'string' ? body.error : 'ส่งข้อความไม่สำเร็จ')
        return
      }
    } catch {
      onDraftChange(text)
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง')
      return
    } finally {
      window.clearTimeout(early)
      setSending(false)
      onSent()
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void submit()
  }

  // คอมพิวเตอร์: Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่ / มือถือ: Enter = ขึ้นบรรทัดใหม่
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault()
      void submit()
    }
  }

  const busy = sending || running + pending > 0
  const busyLabel = sending
    ? 'หัวหน้าทีมกำลังพิมพ์'
    : running > 0
      ? `กำลังทำงาน ${running} งาน${pending > 0 ? ` · รอคิว ${pending}` : ''}`
      : `รอคิว ${pending} งาน`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* รายการข้อความ — เป็นตัวเลื่อนตัวเดียวของหน้าแชท */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          onTouchStart={() => {
            touchingRef.current = true
            markUserInput()
          }}
          onTouchEnd={() => {
            touchingRef.current = false
            markUserInput()
          }}
          onTouchCancel={() => {
            touchingRef.current = false
            markUserInput()
          }}
          onWheel={markUserInput}
          onPointerDown={markUserInput}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-4">
            {messages.length === 0 ? (
              <div className="my-auto px-4 py-10 text-center">
                <p className="text-lg font-medium text-neutral-100">คุยกับทีม AI ได้เลย</p>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-neutral-500">
                  เล่าสิ่งที่อยากทำ หัวหน้าทีมจะถามเพิ่มถ้าต้องการ แล้วเสนอแผนให้คุณกดยืนยันก่อนเริ่มลงมือ
                </p>
              </div>
            ) : (
              <div className="mt-auto">
                {messages.map((m, i) => {
                  const prev = messages[i - 1]
                  const showTime = !prev || minutesBetween(prev.created_at, m.created_at) >= TIME_GAP_MIN
                  const grouped = !!prev && !showTime && prev.role === m.role
                  return (
                    <Fragment key={m.id}>
                      {showTime && (
                        <p className={`text-center text-[11px] text-neutral-500 ${i === 0 ? 'mb-4' : 'my-5'}`}>
                          {formatStamp(m.created_at)}
                        </p>
                      )}
                      <div className={showTime || i === 0 ? '' : grouped ? 'mt-1.5' : 'mt-4'}>
                        <MessageBubble m={m} showLabel={!grouped} projectId={projectId} onChanged={onSent} />
                      </div>
                    </Fragment>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {showJump && (
          <button
            type="button"
            onClick={() => {
              stickRef.current = true
              scrollToBottom(true)
            }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900/95 px-3.5 py-2 text-xs text-neutral-200 shadow-lg active:bg-neutral-800"
          >
            <ArrowDownIcon size={14} />
            ข้อความล่าสุด
          </button>
        )}
      </div>

      {/* แถบสถานะงาน */}
      {busy && (
        <div className="shrink-0 border-t border-neutral-800 bg-neutral-900/60 px-4 py-2">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-neutral-300">
              <Spinner size={14} />
              <span className="truncate">{busyLabel}</span>
            </span>
            <button
              type="button"
              onClick={onOpenTasks}
              className="shrink-0 rounded px-2 py-1.5 font-medium text-indigo-400 active:bg-neutral-800"
            >
              ดู Tasks
            </button>
          </div>
        </div>
      )}

      {/* ยังไม่มี AI ในทีม */}
      {hasAgents === false && (
        <div className="shrink-0 border-t border-neutral-800 bg-neutral-900/60 px-4 py-2.5">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 text-sm">
            <span className="text-neutral-300">ยังไม่มี AI ในทีม — แค่วาง API key แล้วเลือกโมเดล</span>
            <button
              type="button"
              onClick={onOpenAgents}
              className="shrink-0 rounded-md px-3 py-2 font-medium text-indigo-400 active:bg-neutral-800"
            >
              เพิ่ม AI
            </button>
          </div>
        </div>
      )}

      {/* ช่องพิมพ์ */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-neutral-800 bg-neutral-950 px-3 pt-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {error && (
          <div
            role="alert"
            className="mx-auto mb-2 flex max-w-3xl items-start justify-between gap-3 rounded-lg border border-red-900/60 bg-red-950/40 py-2 pl-3 pr-1 text-sm text-red-300"
          >
            <span className="py-1 [overflow-wrap:anywhere]">{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              aria-label="ปิดข้อความ"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-300 active:bg-red-950"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={20000}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="พิมพ์ข้อความ..."
            aria-label="ข้อความ"
            className="block max-h-40 min-h-11 w-full resize-none rounded-3xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-base leading-6 text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-600"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            aria-label="ส่ง"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors active:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {sending ? <Spinner size={18} /> : <SendIcon size={20} />}
          </button>
        </div>
      </form>
    </div>
  )
}
