import { createAdminClient } from '@/lib/supabase/admin'
import { enqueueReadyTasks } from '@/lib/orchestrator/worker'
import { apiOk, apiError } from '@/lib/utils/api'

/**
 * เรียกทุกชั่วโมงโดย Vercel Cron (ดู vercel.json)
 * กู้ task ที่ค้างสถานะ running นานผิดปกติ (Worker ตายกลางทาง) แล้วส่งกลับเข้าคิว
 * Vercel ใส่ header Authorization: Bearer $CRON_SECRET ให้เองเมื่อเรียกจาก crons ที่ประกาศไว้
 */
const STUCK_THRESHOLD_SECONDS = 20 * 60 // 20 นาที: เผื่อเวลาสำหรับ Task ที่ตอบช้าจริง ๆ ก่อนถือว่าค้าง

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return apiError('UNAUTHORIZED', 'เรียกได้เฉพาะจาก Vercel Cron')
  }

  const admin = createAdminClient()
  const { data: projects, error } = await admin.from<{ id: string }>('projects').select('id')
  if (error) return apiError('INTERNAL_ERROR', error.message)

  let recovered = 0
  for (const p of projects ?? []) {
    const { data: n } = await admin.rpc<number>('recover_stuck_tasks', {
      p_project_id: p.id,
      p_older_than_seconds: STUCK_THRESHOLD_SECONDS,
    })
    recovered += n ?? 0
    await enqueueReadyTasks(admin, p.id)
  }

  return apiOk({ projectsChecked: projects?.length ?? 0, tasksRecovered: recovered })
}
