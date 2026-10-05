export const MAX_FILE_CHARS = 500_000

/** นำเข้าหลายไฟล์ (เช่น จาก zip) ส่งเป็นชุด ชุดละไม่เกินนี้ — ต้องเล็กกว่าเพดาน request body 4.5 MB ของ Vercel */
export const IMPORT_BATCH_MAX_FILES = 25
export const IMPORT_BATCH_MAX_CHARS = 900_000

export type PathCheck = { ok: true; path: string } | { ok: false; error: string }

/**
 * ทำ path ของไฟล์ให้เป็นรูปแบบเดียวกัน (relative, คั่นด้วย /) และกัน path แปลก ๆ
 * ไฟล์ในระบบนี้เป็นแถวในฐานข้อมูล ไม่ได้เขียนลงดิสก์ แต่ยังกัน ../ และอักขระควบคุมไว้
 * เพราะผู้ใช้อาจดาวน์โหลดแล้วนำไปวางต่อ และชื่อไฟล์ที่ AI ตั้งมาไม่ควรเชื่อถือ
 */
export function normalizeFilePath(raw: unknown): PathCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'ต้องใส่ path ของไฟล์' }
  const p = raw.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '')
  if (!p) return { ok: false, error: 'ต้องใส่ path ของไฟล์' }
  if (p.length > 500) return { ok: false, error: 'path ยาวเกิน 500 ตัวอักษร' }
  if (/[\u0000-\u001f\u007f]/.test(p)) return { ok: false, error: 'path มีอักขระที่ไม่อนุญาต' }
  const segments = p.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { ok: false, error: 'path ต้องไม่มี .. หรือ // และห้ามลงท้ายด้วย /' }
  }
  return { ok: true, path: p }
}
