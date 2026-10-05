'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  analyzeZip,
  planBatches,
  stripRoot,
  ZipImportError,
  type SkipReason,
  type ZipAnalysis,
  type ZipFile,
} from '@/lib/files/zip-import'
import { MAX_FILE_CHARS } from '@/lib/files/path'
import type { ImportResult } from '@/lib/files/import'

const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50'
const ghostBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-50'
const card = 'rounded-lg border border-neutral-800 bg-neutral-900 p-4'

const REASON_LABEL: Record<SkipReason, string> = {
  secret: 'ไฟล์ที่อาจมีรหัสลับ',
  binary: 'ไม่ใช่ไฟล์ข้อความ',
  too_large: 'ใหญ่เกินกำหนด',
  bad_path: 'path ไม่ถูกต้อง',
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
const BackIcon = () => <Icon><path d="M15 6l-6 6 6 6" /></Icon>

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}

/** ส่งหนึ่งชุด — ลองซ้ำ 1 ครั้งเมื่อเน็ตหลุดหรือเซิร์ฟเวอร์ 5xx (ส่งซ้ำได้ปลอดภัย เพราะไฟล์ที่เหมือนเดิมจะถูกข้าม) */
async function sendBatch(projectId: string, batch: ZipFile[]): Promise<ImportResult[]> {
  const fail = (error: string): ImportResult[] => batch.map((f) => ({ path: f.path, status: 'failed', error }))
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`/api/projects/${projectId}/files/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: batch }),
      })
      if (res.ok) {
        const body = (await res.json()) as { results?: ImportResult[] }
        return body.results ?? fail('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง')
      }
      if (res.status < 500 || attempt === 1) return fail(await readError(res, `นำเข้าไม่สำเร็จ (${res.status})`))
    } catch {
      if (attempt === 1) return fail('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')
    }
  }
  return fail('นำเข้าไม่สำเร็จ')
}

interface Summary {
  created: number
  updated: number
  unchanged: number
  failed: Array<{ path: string; error: string }>
  notSent: number
}

type Stage =
  | { kind: 'reading' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; analysis: ZipAnalysis }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; summary: Summary }

export default function ZipImport({
  projectId,
  file,
  onClose,
}: {
  projectId: string
  file: File
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'reading' })
  const [stopping, setStopping] = useState(false)
  const stopRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const buf = await file.arrayBuffer()
        await new Promise((r) => setTimeout(r, 30)) // ให้หน้าจอแสดง "กำลังอ่าน" ก่อนเริ่มงานหนัก
        if (cancelled) return
        const analysis = analyzeZip(new Uint8Array(buf))
        if (!cancelled) setStage({ kind: 'preview', analysis })
      } catch (e) {
        if (!cancelled) {
          setStage({ kind: 'error', message: e instanceof ZipImportError ? e.message : 'อ่านไฟล์ไม่สำเร็จ' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  async function startImport(files: ZipFile[]) {
    const batches = planBatches(files)
    const total = files.length
    const summary: Summary = { created: 0, updated: 0, unchanged: 0, failed: [], notSent: 0 }
    stopRef.current = false
    setStopping(false)
    setStage({ kind: 'importing', done: 0, total })

    let done = 0
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      if (!batch) continue
      if (stopRef.current) {
        summary.notSent = batches.slice(i).reduce((n, b) => n + b.length, 0)
        break
      }
      const results = await sendBatch(projectId, batch)
      for (const r of results) {
        if (r.status === 'failed') summary.failed.push({ path: r.path, error: r.error ?? 'ไม่สำเร็จ' })
        else summary[r.status]++
      }
      done += batch.length
      setStage({ kind: 'importing', done, total })
    }
    setStage({ kind: 'done', summary })
  }

  if (stage.kind === 'reading') {
    return (
      <section className={`${card} flex items-center gap-3 text-sm text-neutral-300`}>
        <Spinner />
        กำลังอ่านไฟล์ zip...
      </section>
    )
  }

  if (stage.kind === 'error') {
    return (
      <section className="space-y-3">
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
          {stage.message}
        </p>
        <button onClick={onClose} className={ghostBtn}>
          <BackIcon />
          กลับ
        </button>
      </section>
    )
  }

  if (stage.kind === 'importing') {
    const pct = stage.total > 0 ? Math.round((stage.done / stage.total) * 100) : 0
    return (
      <section className={`${card} space-y-3`}>
        <p className="text-sm">
          {stopping ? 'กำลังหยุดหลังชุดนี้เสร็จ...' : `กำลังนำเข้า ${stage.done}/${stage.total} ไฟล์`}
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={stage.total}
          aria-valuenow={stage.done}
          className="h-2 overflow-hidden rounded-full bg-neutral-800"
        >
          <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-neutral-500">อย่าปิดหรือออกจากหน้านี้จนกว่าจะเสร็จ</p>
        <button
          disabled={stopping}
          onClick={() => {
            stopRef.current = true
            setStopping(true)
          }}
          className={ghostBtn}
        >
          หยุดนำเข้า
        </button>
      </section>
    )
  }

  if (stage.kind === 'done') {
    const s = stage.summary
    const title =
      s.notSent > 0
        ? 'หยุดนำเข้าแล้ว'
        : s.failed.length > 0
          ? 'นำเข้าเสร็จ แต่มีบางไฟล์ไม่สำเร็จ'
          : 'นำเข้าเสร็จแล้ว'
    return (
      <section className="space-y-3">
        <div className={`${card} space-y-3`}>
          <h2 className="text-base font-medium">{title}</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['ไฟล์ใหม่', s.created],
                ['อัปเดต', s.updated],
                ['ไม่เปลี่ยน', s.unchanged],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-md bg-neutral-950 px-2 py-3">
                <p className="text-lg font-semibold">{n}</p>
                <p className="text-xs text-neutral-500">{label}</p>
              </div>
            ))}
          </div>
          {s.notSent > 0 && <p className="text-sm text-amber-400">ยังไม่ได้นำเข้า {s.notSent} ไฟล์ (ถูกหยุดไว้)</p>}
          {s.failed.length > 0 && (
            <details open className="text-sm">
              <summary className="cursor-pointer text-red-400">ไม่สำเร็จ {s.failed.length} ไฟล์</summary>
              <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-xs">
                {s.failed.map((f, i) => (
                  <li key={`${f.path}-${i}`}>
                    <span className="break-all font-mono">{f.path}</span>
                    <span className="block text-red-300/80">{f.error}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <button onClick={onClose} className={primaryBtn}>
          กลับไปรายการไฟล์
        </button>
      </section>
    )
  }

  return <Preview file={file} analysis={stage.analysis} onStart={startImport} onCancel={onClose} />
}

function Preview({
  file,
  analysis,
  onStart,
  onCancel,
}: {
  file: File
  analysis: ZipAnalysis
  onStart: (files: ZipFile[]) => void
  onCancel: () => void
}) {
  const [stripWrapper, setStripWrapper] = useState(true)
  const root = analysis.commonRoot

  const files = useMemo(
    () => (root && stripWrapper ? stripRoot(analysis.files, root) : analysis.files),
    [analysis.files, root, stripWrapper]
  )
  const totalChars = useMemo(() => files.reduce((n, f) => n + f.content.length, 0), [files])

  const skippedTotal = analysis.skipped.length + analysis.systemSkipped
  const byReason = useMemo(() => {
    const counts: Partial<Record<SkipReason, number>> = {}
    for (const s of analysis.skipped) counts[s.reason] = (counts[s.reason] ?? 0) + 1
    return counts
  }, [analysis.skipped])
  const SKIPPED_LIST_MAX = 200

  return (
    <section className="space-y-3">
      <button onClick={onCancel} className={ghostBtn}>
        <BackIcon />
        กลับ
      </button>

      <div className={`${card} space-y-4`}>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-neutral-500">{formatSize(file.size)}</p>
        </div>

        {files.length === 0 ? (
          <p className="text-sm text-neutral-400">ไม่พบไฟล์ข้อความที่นำเข้าได้ใน zip นี้</p>
        ) : (
          <p className="text-sm">
            พร้อมนำเข้า <span className="font-semibold">{files.length}</span> ไฟล์{' '}
            <span className="text-neutral-500">(ประมาณ {formatSize(totalChars)})</span>
          </p>
        )}

        {root && files.length > 0 && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={stripWrapper}
              onChange={(e) => setStripWrapper(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
            />
            <span>
              ตัดโฟลเดอร์ชั้นนอก <span className="break-all font-mono text-[13px]">{root}/</span> ออก
              <span className="block text-xs text-neutral-500">เหมาะกับ zip ที่ดาวน์โหลดจาก GitHub</span>
            </span>
          </label>
        )}

        {files.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer py-1 text-neutral-300">ดูรายการไฟล์ ({files.length})</summary>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto font-mono text-xs text-neutral-300">
              {files.map((f) => (
                <li key={f.path} className="break-all">
                  {f.path}
                </li>
              ))}
            </ul>
          </details>
        )}

        {skippedTotal > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer py-1 text-neutral-300">ข้ามไป {skippedTotal.toLocaleString('th-TH')} รายการ</summary>
            <div className="mt-2 space-y-2 text-xs text-neutral-400">
              <ul className="space-y-1">
                {analysis.systemSkipped > 0 && (
                  <li>
                    โฟลเดอร์/ไฟล์ระบบ (.git, node_modules, __MACOSX ฯลฯ) {analysis.systemSkipped.toLocaleString('th-TH')} รายการ
                  </li>
                )}
                {byReason.secret && <li>ไฟล์ที่อาจมีรหัสลับ (.env, *.pem ฯลฯ) {byReason.secret} ไฟล์ — ไม่นำเข้าเพื่อความปลอดภัย</li>}
                {byReason.binary && <li>ไม่ใช่ไฟล์ข้อความ (รูปภาพ ฟอนต์ ไฟล์ไบนารี) {byReason.binary} ไฟล์</li>}
                {byReason.too_large && (
                  <li>ใหญ่เกิน {MAX_FILE_CHARS.toLocaleString('th-TH')} ตัวอักษร {byReason.too_large} ไฟล์</li>
                )}
                {byReason.bad_path && <li>path ไม่ถูกต้อง {byReason.bad_path} ไฟล์</li>}
              </ul>
              {analysis.skipped.length > 0 && (
                <ul className="max-h-48 space-y-1 overflow-y-auto border-t border-neutral-800 pt-2">
                  {analysis.skipped.slice(0, SKIPPED_LIST_MAX).map((s, i) => (
                    <li key={`${s.path}-${i}`}>
                      <span className="break-all font-mono text-neutral-300">{s.path}</span>
                      <span className="text-neutral-500">
                        {' '}
                        — {REASON_LABEL[s.reason]}
                        {s.detail ? ` (${s.detail})` : ''}
                      </span>
                    </li>
                  ))}
                  {analysis.skipped.length > SKIPPED_LIST_MAX && (
                    <li className="text-neutral-500">และอีก {analysis.skipped.length - SKIPPED_LIST_MAX} ไฟล์</li>
                  )}
                </ul>
              )}
            </div>
          </details>
        )}

        {files.length > 0 && (
          <p className="text-xs leading-relaxed text-neutral-500">
            ไฟล์ที่ path ตรงกับของเดิมจะถูกบันทึกเป็นเวอร์ชันใหม่ (ย้อนกลับได้จากประวัติเวอร์ชัน) ส่วนไฟล์ที่เนื้อหาเหมือนเดิมจะไม่ถูกบันทึกซ้ำ
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => onStart(files)} disabled={files.length === 0} className={primaryBtn}>
          นำเข้า {files.length} ไฟล์
        </button>
        <button onClick={onCancel} className={`${ghostBtn} px-4 py-2.5 text-sm`}>
          ยกเลิก
        </button>
      </div>
    </section>
  )
}
