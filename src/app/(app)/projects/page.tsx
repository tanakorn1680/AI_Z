import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import NewProjectForm from './new-project-form'

export default async function ProjectsPage() {
  const supabase = await createClient()
  interface ProjectListRow {
    id: string; name: string; spent_usd: number; budget_usd: number | null; created_at: string
  }
  const { data: projects } = await supabase
    .from<ProjectListRow>('projects')
    .select('id, name, spent_usd, budget_usd, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Workspace ของคุณ</h1>

      <NewProjectForm />

      <div className="mt-8 space-y-2">
        {(projects ?? []).map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="block rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition hover:border-indigo-600"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{p.name}</span>
              <span className="text-sm text-neutral-400">
                ${p.spent_usd.toFixed(2)}{p.budget_usd ? ` / $${p.budget_usd}` : ''}
              </span>
            </div>
          </Link>
        ))}
        {(projects ?? []).length === 0 && (
          <p className="text-sm text-neutral-500">ยังไม่มี Project — สร้างใหม่ด้านบน</p>
        )}
      </div>
    </div>
  )
}
