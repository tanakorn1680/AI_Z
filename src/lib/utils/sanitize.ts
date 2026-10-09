/**
 * Strips HTML tags and normalizes whitespace.
 * Used for all user-supplied text before DB insert.
 */
export function sanitizeText(input: unknown, maxLength = 10_000): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/<[^>]*>/g, '')         // strip HTML tags
    .replace(/\0/g, '')              // strip null bytes
    .trim()
    .slice(0, maxLength)
}

export function sanitizeShort(input: unknown, maxLength = 200): string {
  return sanitizeText(input, maxLength)
}

/**
 * Validates a UUID string.
 */
export function isValidUUID(id: unknown): id is string {
  if (typeof id !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/**
 * Validates an enum value is one of the allowed values.
 */
export function isValidEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.includes(value as T)
}

/**
 * Clamps a number between min and max.
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * ข้อความแชทของผู้ใช้: ตัดอักขระควบคุม (รวม NUL ที่ Postgres เก็บไม่ได้) แล้วจำกัดความยาว
 * ไม่ตัดแท็ก HTML แบบ sanitizeText เพราะผู้ใช้อาจวางโค้ดมาคุย — ตอนแสดงผล React escape ให้อยู่แล้ว
 */
export function cleanChatText(input: unknown, maxLength = 20_000): string {
  if (typeof input !== 'string') return ''
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength)
}
