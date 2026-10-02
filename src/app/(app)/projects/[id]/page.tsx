import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import WorkspaceClient from './workspace-client'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // RLS กรองให้อยู่แล้ว: ถ้าไม่ใช่เจ้าของจะได้ null และเราถือว่าไม่พบ (ไม่บอกว่ามีอยู่แต่ไม่มีสิทธิ์)
  const { data: project } = await supabase
    .from<{ id: string; name: string }>('projects')
    .select('id, name')
    .eq('id', id)
    .single()

  if (!project) notFound()

  return <WorkspaceClient projectId={project.id} projectName={project.name} />
}
