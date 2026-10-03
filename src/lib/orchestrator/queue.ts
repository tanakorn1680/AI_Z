/**
 * ชั้นห่อ Vercel Queues — จุดเดียวที่ import '@vercel/queue'
 * เหตุผล: ตอนเขียนนี้ Vercel Queues ยังเป็น public beta (queue/v2beta trigger)
 * แยกไว้ที่นี่เพื่อให้ถ้า SDK เปลี่ยน API หรือคุณอยากสลับไป self-host (BullMQ ฯลฯ)
 * แก้ไฟล์เดียวจบ ไม่ต้องแตะ route อื่น
 */
import { send } from '@vercel/queue'

export interface TaskMessage {
  taskId: string
  projectId: string
}

/** เข้าคิวให้ Worker หยิบไปทำ — ห้าม await ผลลัพธ์การทำงานจริงที่นี่ (แค่ enqueue) */
export async function enqueueTask(msg: TaskMessage, opts: { delaySeconds?: number } = {}): Promise<void> {
  // delaySeconds ให้คิวหน่วงก่อนส่งให้ Worker (SDK รับได้สูงสุด 7 วัน) ใช้รอโควตา rate limit
  if (opts.delaySeconds && opts.delaySeconds > 0) {
    await send('agent-tasks', msg, { delaySeconds: Math.ceil(opts.delaySeconds) })
  } else {
    await send('agent-tasks', msg)
  }
}
