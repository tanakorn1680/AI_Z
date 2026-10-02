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
export async function enqueueTask(msg: TaskMessage): Promise<void> {
  await send('agent-tasks', msg)
}
