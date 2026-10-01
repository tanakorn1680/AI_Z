import { handleCallback } from '@vercel/queue'
import { createAdminClient } from '@/lib/supabase/admin'
import { processTask } from '@/lib/orchestrator/worker'
import type { TaskMessage } from '@/lib/orchestrator/queue'

/**
 * Consumer ของ topic 'agent-tasks' — Vercel เรียก route นี้เองเมื่อมีข้อความในคิว
 * (ดู vercel.json: experimentalTriggers ทำให้ route นี้ไม่มี public URL แล้ว
 *  เรียกได้เฉพาะจาก Vercel Queue infrastructure เท่านั้น)
 *
 * ถ้า handler โยน error ข้อความจะถูกส่งมาใหม่ตาม retry policy ของ Queue เอง
 * เราจึงไม่โยนซ้ำจาก processTask (มันจัดการ retry เองผ่าน fail_task RPC แล้ว)
 * เว้นแต่ error ที่ระบบของเราเองไม่คาดคิด (bug) ซึ่งควรให้ Queue retry ชั้นนอกช่วยอีกที
 */
export const POST = handleCallback(async (message: TaskMessage) => {
  const admin = createAdminClient()
  await processTask(admin, message.taskId)
})
