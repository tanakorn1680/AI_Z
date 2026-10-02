import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * สร้าง Context เฉพาะของ Task เดียว (หลักข้อ 8 ของสเปค)
 * ส่งเฉพาะ: คำสั่งของ Task + summary ของ Task ที่ depends_on + instructions ของ project
 * ไม่ส่ง: ประวัติ Chat ทั้งหมด, งานของ Agent อื่นที่ไม่เกี่ยวข้อง, output เต็มของ Task ก่อนหน้า
 */
export async function buildTaskContext(
  admin: SupabaseClient,
  task: { id: string; project_id: string; title: string; description: string; depends_on: string[] }
): Promise<string> {
  const { data: project } = await admin
    .from<{ instructions: string }>('projects')
    .select('instructions')
    .eq('id', task.project_id)
    .single()

  let dependencySummaries = ''
  if (task.depends_on.length > 0) {
    interface DependencyResultRow {
      summary: string
      tasks: { title: string } | { title: string }[]
    }
    const { data: results } = await admin
      .from<DependencyResultRow>('task_results')
      .select('task_id, summary, tasks!inner(title)')
      .in('task_id', task.depends_on)

    dependencySummaries = (results ?? [])
      .map((r) => {
        const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks
        return `### ผลจาก: ${t?.title ?? 'งานก่อนหน้า'}\n${r.summary}`
      })
      .join('\n\n')
  }

  const parts = [
    project?.instructions ? `## คำสั่งของโปรเจกต์\n${project.instructions}` : '',
    `## งานที่ต้องทำ: ${task.title}\n${task.description}`,
    dependencySummaries ? `## ข้อมูลจากงานก่อนหน้า (สรุป)\n${dependencySummaries}` : '',
  ].filter(Boolean)

  return parts.join('\n\n')
}
