'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

interface FileItem {
  id: string
  path: string
  updated_at: string
}

interface VersionItem {
  id: string
  created_at: string
  author: string
}

interface FileDetail {
  file: { id: string; path: string; current_version_id: string | null }
  version_id: string | null
  content: string
  versions: VersionItem[]
}

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'file'; id: string }

const inputCls =
  'w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-indigo-500'
const labelCls = 'mb-1 block text-xs text-neutral-400'
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50'
const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-50'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
const BackIcon = () => <Icon><path d="M15 6l-6 6 6 6" /></Icon>
const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>
const FileIcon = () => <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>
const CopyIcon = () => <Icon><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>
const DownloadIcon = () => <Icon><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Icon>
const EditIcon = () => <Icon><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Icon>
const TrashIcon = () => <Icon><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></Icon>

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}

export default function FilesPanel({ projectId }: { projectId: string }) {
  const [view, setView] = useState<View>({ kind: 'list' })

  if (view.kind === 'new') {
    return (
      <NewFile
        projectId={projectId}
        onCancel={() => setView({ kind: 'list' })}
        onSaved={(id) => setView({ kind: 'file', id })}
      />
    )
  }
  if (view.kind === 'file') {
    return (
      <FileViewer
        key={view.id}
        projectId={projectId}
        fileId={view.id}
        onBack={() => setView({ kind: 'list' })}
      />
    )
  }
  return <FileList projectId={projectId} onOpen={(id) => setView({ kind: 'file', id })} onNew={() => setView({ kind: 'new' })} />
}

function FileList({
  projectId,
  onOpen,
  onNew,
}: {
  projectId: string
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const [files, setFiles] = useState<FileItem[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/files`)
    if (!res.ok) {
      setError(await readError(res, 'โหลดรายการไฟล์ไม่สำเร็จ'))
      return
    }
    setError('')
    setFiles(((await res.json()) as { files: FileItem[] }).files ?? [])
  }, [projectId])

  // agent อาจสร้างไฟล์ระหว่างที่เปิดหน้านี้อยู่ จึงรีเฟรชเป็นระยะ
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-300">Files{files ? ` (${files.length})` : ''}</h2>
        <button onClick={onNew} className={primaryBtn}>
          <PlusIcon />
          ไฟล์ใหม่
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="space-y-2">
        {files?.map((f) => (
          <button
            key={f.id}
            onClick={() => onOpen(f.id)}
            className="flex w-full items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left text-sm transition hover:border-neutral-700"
          >
            <span className="shrink-0 text-neutral-500">
              <FileIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px]">{f.path}</span>
              <span className="block text-xs text-neutral-500">แก้ล่าสุด {formatTime(f.updated_at)}</span>
            </span>
          </button>
        ))}
        {files && files.length === 0 && (
          <p className="text-sm text-neutral-500">
            ยังไม่มีไฟล์ — agent ที่เปิดสิทธิ์ &quot;สร้าง/แก้ไฟล์ได้&quot; จะบันทึกไฟล์ที่ทำเสร็จไว้ที่นี่ หรือกด &quot;ไฟล์ใหม่&quot; เพื่อสร้างเอง
          </p>
        )}
        {!files && !error && <p className="text-sm text-neutral-500">กำลังโหลด...</p>}
      </div>
    </section>
  )
}

function NewFile({
  projectId,
  onCancel,
  onSaved,
}: {
  projectId: string
  onCancel: () => void
  onSaved: (id: string) => void
}) {
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(await readError(res, 'บันทึกไม่สำเร็จ'))
      return
    }
    onSaved(((await res.json()) as { file: { id: string } }).file.id)
  }

  return (
    <section>
      <button onClick={onCancel} className={`${ghostBtn} mb-3`}>
        <BackIcon />
        กลับ
      </button>
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div>
          <label className={labelCls}>Path ของไฟล์</label>
          <input
            required
            maxLength={500}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="เช่น src/app.ts หรือ docs/notes.md"
            className={`${inputCls} font-mono`}
          />
        </div>
        <div>
          <label className={labelCls}>เนื้อหา</label>
          <textarea
            rows={14}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className={`${inputCls} font-mono text-xs`}
          />
        </div>
        <p className="text-xs text-neutral-500">ถ้า path นี้มีอยู่แล้ว จะบันทึกเป็นเวอร์ชันใหม่ของไฟล์เดิม</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </form>
    </section>
  )
}

function FileViewer({
  projectId,
  fileId,
  onBack,
}: {
  projectId: string
  fileId: string
  onBack: () => void
}) {
  const [detail, setDetail] = useState<FileDetail | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(
    async (versionId?: string) => {
      const qs = versionId ? `?version=${encodeURIComponent(versionId)}` : ''
      const res = await fetch(`/api/projects/${projectId}/files/${fileId}${qs}`)
      if (!res.ok) {
        setError(await readError(res, 'โหลดไฟล์ไม่สำเร็จ'))
        return
      }
      setError('')
      setDetail((await res.json()) as FileDetail)
    },
    [projectId, fileId]
  )

  useEffect(() => {
    void load()
  }, [load])

  if (!detail) {
    return (
      <section>
        <button onClick={onBack} className={`${ghostBtn} mb-3`}>
          <BackIcon />
          กลับ
        </button>
        {error ? <p className="text-sm text-red-400">{error}</p> : <p className="text-sm text-neutral-500">กำลังโหลด...</p>}
      </section>
    )
  }

  const isCurrent = detail.version_id === detail.file.current_version_id
  const fileName = detail.file.path.split('/').pop() || 'file.txt'

  async function save(content: string) {
    if (!detail || busy) return
    setBusy(true)
    setError('')
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: detail.file.path, content }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(await readError(res, 'บันทึกไม่สำเร็จ'))
      return
    }
    setEditing(false)
    await load()
  }

  async function remove() {
    if (!window.confirm(`ลบไฟล์ "${detail?.file.path}" ?`)) return
    const res = await fetch(`/api/projects/${projectId}/files/${fileId}`, { method: 'DELETE' })
    if (!res.ok) {
      setError(await readError(res, 'ลบไม่สำเร็จ'))
      return
    }
    onBack()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(detail?.content ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาต')
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([detail?.content ?? ''], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className={ghostBtn}>
          <BackIcon />
          กลับ
        </button>
        <button onClick={remove} aria-label="ลบไฟล์" className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-red-400">
          <TrashIcon />
        </button>
      </div>

      <div>
        <h2 className="break-all font-mono text-sm">{detail.file.path}</h2>
        {!isCurrent && (
          <p className="mt-1 text-xs text-amber-400">
            กำลังดูเวอร์ชันเก่า —{' '}
            <button onClick={() => load()} className="underline">
              กลับไปเวอร์ชันปัจจุบัน
            </button>
          </p>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            rows={18}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className={`${inputCls} font-mono text-xs`}
          />
          <div className="flex gap-2">
            <button onClick={() => save(draft)} disabled={busy} className={primaryBtn}>
              {busy ? 'กำลังบันทึก...' : 'บันทึกเป็นเวอร์ชันใหม่'}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy} className={ghostBtn}>
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className={ghostBtn}>
              <CopyIcon />
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </button>
            <button onClick={download} className={ghostBtn}>
              <DownloadIcon />
              ดาวน์โหลด
            </button>
            {isCurrent ? (
              <button
                onClick={() => {
                  setDraft(detail.content)
                  setEditing(true)
                }}
                className={ghostBtn}
              >
                <EditIcon />
                แก้ไข
              </button>
            ) : (
              <button onClick={() => save(detail.content)} disabled={busy} className={ghostBtn}>
                กู้คืนเวอร์ชันนี้
              </button>
            )}
          </div>
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed">
            {detail.content || <span className="text-neutral-600">(ไฟล์ว่าง)</span>}
          </pre>
        </>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
        <summary className="cursor-pointer text-neutral-300">ประวัติเวอร์ชัน ({detail.versions.length})</summary>
        <div className="mt-2 space-y-1">
          {detail.versions.map((v, i) => (
            <button
              key={v.id}
              onClick={() => (i === 0 ? load() : load(v.id))}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-neutral-800 ${
                v.id === detail.version_id ? 'bg-neutral-800' : ''
              }`}
            >
              <span>{formatTime(v.created_at)}</span>
              <span className="text-neutral-500">
                {v.author}
                {i === 0 ? ' · ปัจจุบัน' : ''}
              </span>
            </button>
          ))}
        </div>
      </details>
    </section>
  )
}
