import { normalizeFilePath, MAX_FILE_CHARS } from './path'

export interface ExtractedFile {
  path: string
  content: string
}

export interface ExtractResult {
  files: ExtractedFile[]
  /** ข้อความเดิมที่แทนแต่ละบล็อกไฟล์ด้วยตัวบอก [ไฟล์ path] — ใช้แสดงในแชท/ทำ summary */
  text: string
  /** บล็อกที่ข้ามเพราะ path ไม่ถูกต้องหรือเนื้อหาใหญ่เกิน */
  skipped: string[]
}

const FILE_BLOCK = /<file\s+path\s*=\s*"([^"]*)"\s*>\r?\n?([\s\S]*?)\r?\n?<\/file>/g

/** โมเดลมักห่อเนื้อหาด้วย ``` อีกชั้น — ปอกออกเฉพาะกรณีที่ห่อทั้งก้อนจริง ๆ */
function stripWrappingFence(content: string): string {
  const m = content.match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/)
  return m ? (m[1] ?? content) : content
}

/**
 * ดึงไฟล์ที่ AI ส่งมาในรูปแบบ <file path="...">เนื้อหา</file>
 * ถ้าไฟล์ path ซ้ำกันในคำตอบเดียว ใช้อันหลังสุด
 */
export function extractFiles(output: string): ExtractResult {
  const byPath = new Map<string, string>()
  const skipped: string[] = []

  const text = output.replace(FILE_BLOCK, (_all, rawPath: string, rawContent: string) => {
    const check = normalizeFilePath(rawPath)
    if (!check.ok) {
      skipped.push(`${rawPath || '(ไม่มี path)'}: ${check.error}`)
      return `[ข้ามไฟล์ ${rawPath || '(ไม่มี path)'}]`
    }
    const content = stripWrappingFence(rawContent)
    if (content.length > MAX_FILE_CHARS) {
      skipped.push(`${check.path}: ไฟล์ใหญ่เกิน ${MAX_FILE_CHARS} ตัวอักษร`)
      return `[ข้ามไฟล์ ${check.path}]`
    }
    byPath.set(check.path, content)
    return `[ไฟล์ ${check.path}]`
  })

  return {
    files: [...byPath.entries()].map(([path, content]) => ({ path, content })),
    text,
    skipped,
  }
}

/** คำสั่งที่ต่อท้าย system prompt ของ agent ที่มีสิทธิ์เขียนไฟล์ */
export const FILE_WRITE_INSTRUCTION = `

## การส่งมอบไฟล์
ถ้างานนี้ต้องส่งมอบไฟล์ (โค้ด เอกสาร ข้อมูล ฯลฯ) ให้ใส่เนื้อหาไฟล์ "ทั้งไฟล์" ในรูปแบบนี้เท่านั้น:
<file path="โฟลเดอร์/ชื่อไฟล์.นามสกุล">
เนื้อหาไฟล์
</file>
- path เป็นแบบสัมพัทธ์ ไม่ขึ้นต้นด้วย / และห้ามมี ..
- ถ้าแก้ไฟล์ที่มีอยู่แล้ว ให้ใช้ path เดิมและใส่เนื้อหาใหม่ทั้งไฟล์
- ไม่ต้องห่อเนื้อหาในแท็กด้วย code fence
- ข้อความนอกแท็กคือคำอธิบายสั้น ๆ สำหรับผู้ใช้ ไม่ต้องวางเนื้อหาไฟล์ซ้ำ`
