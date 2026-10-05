import { unzipSync } from 'fflate'
import {
  normalizeFilePath,
  MAX_FILE_CHARS,
  IMPORT_BATCH_MAX_FILES,
  IMPORT_BATCH_MAX_CHARS,
} from './path'

// ---------------------------------------------------------------------------
// เพดาน — ทำงานในเบราว์เซอร์ของผู้ใช้ (มือถือ) จึงตั้งให้พอดีกับหน่วยความจำ และกัน zip bomb
// ---------------------------------------------------------------------------
export const ZIP_MAX_BYTES = 30 * 1024 * 1024 // ขนาดไฟล์ zip
export const ZIP_MAX_ENTRIES = 100_000 // จำนวนรายการใน zip (รวมโฟลเดอร์ระบบอย่าง node_modules)
export const ZIP_MAX_FILES = 500 // จำนวนไฟล์ข้อความที่นำเข้าได้ต่อ zip
export const ZIP_MAX_TOTAL_BYTES = 20 * 1024 * 1024 // ขนาดรวมหลังแตกของไฟล์ที่จะนำเข้า
/** 1 ตัวอักษร (ไทย/ยูนิโค้ด) ใช้ได้ถึง 3 ไบต์ใน UTF-8 */
const MAX_FILE_BYTES = MAX_FILE_CHARS * 3

export class ZipImportError extends Error {}

export type SkipReason = 'secret' | 'binary' | 'too_large' | 'bad_path'

export interface SkippedItem {
  path: string
  reason: SkipReason
  detail?: string
}

export interface ZipFile {
  path: string
  content: string
}

export interface ZipAnalysis {
  /** ไฟล์ข้อความที่พร้อมนำเข้า (เรียงตาม path) */
  files: ZipFile[]
  /** ไฟล์ที่ข้าม พร้อมเหตุผล (ไม่รวมโฟลเดอร์/ไฟล์ระบบ — นับแยกใน systemSkipped) */
  skipped: SkippedItem[]
  /** จำนวนรายการที่ข้ามเงียบ ๆ เพราะเป็นของระบบ เช่น .git, node_modules, __MACOSX, .DS_Store */
  systemSkipped: number
  /** โฟลเดอร์ชั้นนอกสุดที่ห่อทุกไฟล์ (เช่น zip จาก GitHub = "AI_Z-main") ถ้าไม่มีเป็น null */
  commonRoot: string | null
}

/** ส่วนของ fflate.unzipSync ที่เราใช้ — แยกเป็น type เพื่อให้ทดสอบได้ */
export type UnzipFn = (
  data: Uint8Array,
  opts: { filter?: (file: { name: string; originalSize: number }) => boolean }
) => Record<string, Uint8Array>

// ---------------------------------------------------------------------------
// กติกาคัดไฟล์
// ---------------------------------------------------------------------------
const IGNORED_DIRS = new Set(['__MACOSX', '.git', 'node_modules', '.next', '.vercel', '.turbo'])
const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

/** นามสกุลที่เป็นไบนารีแน่ ๆ — ข้ามโดยไม่ต้องแตกไฟล์ (svg เป็นข้อความ จึงไม่อยู่ในรายการ) */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'avif', 'psd',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war',
  'mp3', 'mp4', 'm4a', 'mov', 'avi', 'mkv', 'wav', 'ogg', 'flac', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'pyc', 'wasm',
  'sqlite', 'sqlite3', 'db', 'mdb',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'apk', 'aab', 'iso', 'dmg',
])

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isSystem(segments: string[]): boolean {
  const base = (segments[segments.length - 1] ?? '').toLowerCase()
  if (IGNORED_FILES.has(base) || base.startsWith('._')) return true
  return segments.slice(0, -1).some((s) => IGNORED_DIRS.has(s))
}

/** ไฟล์ที่มักมีรหัสผ่าน/คีย์ — ไม่นำเข้า เพราะเนื้อหาไฟล์อาจถูกส่งให้ AI เป็นบริบทของงาน */
function isSecret(base: string): boolean {
  const b = base.toLowerCase()
  if (/^\.env(\..+)?$/.test(b) && !/\.(example|sample|template|dist)$/.test(b)) return true
  if (/\.(pem|key|p12|pfx)$/.test(b)) return true
  return b === 'id_rsa' || b === 'id_ed25519' || b === '.npmrc' || b === '.netrc'
}

function extOf(base: string): string {
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

// ---------------------------------------------------------------------------
// วิเคราะห์ zip
// ---------------------------------------------------------------------------
export function analyzeZip(bytes: Uint8Array, unzip: UnzipFn = unzipSync): ZipAnalysis {
  if (bytes.length > ZIP_MAX_BYTES) {
    throw new ZipImportError(`ไฟล์ zip ใหญ่เกิน ${ZIP_MAX_BYTES / 1024 / 1024} MB`)
  }

  // รอบแรก: อ่านรายการอย่างเดียว ยังไม่แตกอะไรเลย (filter คืน false ทุกรายการ)
  const entries: Array<{ name: string; originalSize: number }> = []
  try {
    unzip(bytes, {
      filter: (f) => {
        entries.push({ name: f.name, originalSize: f.originalSize })
        return false
      },
    })
  } catch {
    throw new ZipImportError('อ่านไฟล์ zip ไม่ได้ — ไฟล์อาจเสียหรือตั้งรหัสผ่านไว้')
  }
  if (entries.length === 0) throw new ZipImportError('zip นี้ว่างเปล่า')
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new ZipImportError(`zip มีรายการมากเกิน ${ZIP_MAX_ENTRIES.toLocaleString('th-TH')} รายการ`)
  }

  const skipped: SkippedItem[] = []
  let systemSkipped = 0
  const candidates: Array<{ name: string; path: string; originalSize: number }> = []

  for (const e of entries) {
    const rawName = e.name.replace(/\\/g, '/')
    if (rawName.endsWith('/')) continue // รายการโฟลเดอร์ ไม่ใช่ไฟล์

    if (isSystem(rawName.split('/').filter(Boolean))) {
      systemSkipped++
      continue
    }
    const check = normalizeFilePath(rawName)
    if (!check.ok) {
      skipped.push({ path: rawName, reason: 'bad_path', detail: check.error })
      continue
    }
    const base = baseName(check.path)
    if (isSecret(base)) {
      skipped.push({ path: check.path, reason: 'secret' })
      continue
    }
    if (BINARY_EXT.has(extOf(base))) {
      skipped.push({ path: check.path, reason: 'binary' })
      continue
    }
    if (e.originalSize > MAX_FILE_BYTES) {
      skipped.push({ path: check.path, reason: 'too_large' })
      continue
    }
    candidates.push({ name: e.name, path: check.path, originalSize: e.originalSize })
  }

  if (candidates.length > ZIP_MAX_FILES) {
    throw new ZipImportError(
      `มีไฟล์ข้อความ ${candidates.length.toLocaleString('th-TH')} ไฟล์ เกินที่นำเข้าได้ครั้งละ ${ZIP_MAX_FILES} ไฟล์ — ` +
        'แยกเป็นหลาย zip หรือเอาโฟลเดอร์ที่ไม่ต้องใช้ออกก่อน'
    )
  }
  const totalBytes = candidates.reduce((sum, c) => sum + c.originalSize, 0)
  if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
    throw new ZipImportError(
      `ขนาดรวมของไฟล์ข้อความเกิน ${ZIP_MAX_TOTAL_BYTES / 1024 / 1024} MB — แยกเป็นหลาย zip ก่อน`
    )
  }

  // รอบสอง: แตกเฉพาะไฟล์ที่ผ่านการคัดแล้ว
  const wanted = new Set(candidates.map((c) => c.name))
  let raw: Record<string, Uint8Array>
  try {
    raw = unzip(bytes, { filter: (f) => wanted.has(f.name) })
  } catch {
    throw new ZipImportError('แตกไฟล์ zip ไม่สำเร็จ — ไฟล์อาจเสียหรือใช้การบีบอัดที่ไม่รองรับ')
  }

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const byPath = new Map<string, string>()
  for (const c of candidates) {
    const data = raw[c.name]
    if (!data) continue
    if (data.length > MAX_FILE_BYTES) {
      skipped.push({ path: c.path, reason: 'too_large' })
      continue
    }
    let text: string
    try {
      text = decoder.decode(data) // ไม่ใช่ UTF-8 ที่ถูกต้อง = ไม่ใช่ไฟล์ข้อความ
    } catch {
      skipped.push({ path: c.path, reason: 'binary' })
      continue
    }
    if (text.includes('\u0000')) {
      skipped.push({ path: c.path, reason: 'binary' })
      continue
    }
    if (text.length > MAX_FILE_CHARS) {
      skipped.push({
        path: c.path,
        reason: 'too_large',
        detail: `${text.length.toLocaleString('th-TH')} ตัวอักษร`,
      })
      continue
    }
    byPath.set(c.path, text)
  }

  const files = [...byPath.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return { files, skipped, systemSkipped, commonRoot: detectCommonRoot(files) }
}

/** ทุกไฟล์อยู่ใต้โฟลเดอร์ชั้นนอกชื่อเดียวกันหรือไม่ (เช่น AI_Z-main/...) */
function detectCommonRoot(files: ZipFile[]): string | null {
  let root: string | null = null
  for (const f of files) {
    const i = f.path.indexOf('/')
    if (i <= 0) return null
    const first = f.path.slice(0, i)
    if (root === null) root = first
    else if (root !== first) return null
  }
  return root
}

/** ตัดโฟลเดอร์ชั้นนอกออก (ไม่แตะไฟล์ที่ไม่ได้อยู่ใต้โฟลเดอร์นั้น) */
export function stripRoot(files: ZipFile[], root: string): ZipFile[] {
  const prefix = `${root}/`
  return files.map((f) => (f.path.startsWith(prefix) ? { path: f.path.slice(prefix.length), content: f.content } : f))
}

/** แบ่งไฟล์เป็นชุดสำหรับส่งขึ้นเซิร์ฟเวอร์ ไม่ให้เกินเพดานจำนวนไฟล์/ขนาดต่อ request */
export function planBatches(files: ZipFile[]): ZipFile[][] {
  const batches: ZipFile[][] = []
  let current: ZipFile[] = []
  let chars = 0
  for (const f of files) {
    const size = f.content.length
    if (current.length > 0 && (current.length >= IMPORT_BATCH_MAX_FILES || chars + size > IMPORT_BATCH_MAX_CHARS)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(f)
    chars += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}
