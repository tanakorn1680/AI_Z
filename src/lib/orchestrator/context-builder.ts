import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * สร้าง Context เฉพาะของ Task เดียว (หลักข้อ 8 ของสเปค)
 * ส่งเฉพาะ: คำสั่งของ Task + summary ของ Task ที่ depends_on + instructions ของ project
 * ไม่ส่ง: ประวัติ Chat ทั้งหมด, งานของ Agent อื่นที่ไม่เกี่ยวข้อง, output เต็มของ Task ก่อนหน้า
 */
export async function buildTaskContext(
  admin: SupabaseClient,
  task: { id: string; project_id: string; title: string; description: string; depends_on: string[] },
  opts: { includeFiles?: boolean; /** path ของไฟล์ที่ต้องส่งเนื้อหา (ที่เหลือส่งแค่ชื่อ) */ files?: string[] } = {}
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

  const filesSection = opts.includeFiles ? await buildFilesContext(admin, task.project_id, opts.files ?? []) : ''

  const parts = [
    project?.instructions ? `## คำสั่งของโปรเจกต์\n${project.instructions}` : '',
    `## งานที่ต้องทำ: ${task.title}\n${task.description}`,
    dependencySummaries ? `## ข้อมูลจากงานก่อนหน้า (สรุป)\n${dependencySummaries}` : '',
    filesSection,
  ].filter(Boolean)

  return parts.join('\n\n')
}

// เพดานของเนื้อหาไฟล์ที่ส่งเข้า prompt — คุม token (โดยเฉพาะบน free tier)
// ส่งเนื้อหาเฉพาะไฟล์ที่แผนระบุว่างานนี้ต้องใช้ ส่วนไฟล์อื่นส่งแค่ชื่อให้รู้ว่ามีอะไรอยู่
const MAX_FILES_LISTED = 30
const MAX_CHARS_PER_FILE = 6_000
const MAX_CHARS_TOTAL = 12_000

async function buildFilesContext(admin: SupabaseClient, projectId: string, wanted: string[]): Promise<string> {
  const { data: fileRows } = await admin
    .from('files')
    .select('id, path, current_version_id, created_at')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_FILES_LISTED)
  const listed = (fileRows ?? []) as Array<{ id: string; path: string; current_version_id: string | null }>

  // ไฟล์ที่ต้องอ่านเนื้อหา — ค้นตาม path ตรง ๆ (อาจเก่ากว่า 30 ไฟล์ล่าสุดที่แสดงชื่อ)
  const wantedRows = (
    await Promise.all(
      [...new Set(wanted)].slice(0, 8).map(async (path) => {
        const { data } = await admin
          .from('files')
          .select('id, path, current_version_id')
          .eq('project_id', projectId)
          .eq('path', path)
          .is('deleted_at', null)
          .maybeSingle()
        return data as { id: string; path: string; current_version_id: string | null } | null
      })
    )
  ).filter((r): r is { id: string; path: string; current_version_id: string | null } => !!r && !!r.current_version_id)

  if (listed.length === 0 && wantedRows.length === 0) return ''

  const contentByVersion = new Map<string, string>()
  if (wantedRows.length > 0) {
    const { data: versionRows } = await admin
      .from('file_versions')
      .select('id, content')
      .in('id', wantedRows.map((f) => f.current_version_id as string))
    for (const v of (versionRows ?? []) as Array<{ id: string; content: string }>) contentByVersion.set(v.id, v.content)
  }

  let budget = MAX_CHARS_TOTAL
  const blocks: string[] = []
  for (const f of wantedRows) {
    if (budget <= 0) break
    const full = contentByVersion.get(f.current_version_id as string) ?? ''
    const take = Math.min(full.length, MAX_CHARS_PER_FILE, budget)
    budget -= take
    const truncated = take < full.length ? `\n… (ตัดเหลือ ${take} จาก ${full.length} ตัวอักษร)` : ''
    blocks.push(`### ${f.path}\n\`\`\`\n${full.slice(0, take)}${truncated}\n\`\`\``)
  }

  return [
    listed.length ? `## ไฟล์ในโปรเจกต์ (ชื่อเท่านั้น)\n${listed.map((f) => `- ${f.path}`).join('\n')}` : '',
    blocks.length ? `## เนื้อหาไฟล์ที่งานนี้ต้องใช้\n${blocks.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
