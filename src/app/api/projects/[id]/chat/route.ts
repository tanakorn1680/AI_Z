import { requireUser } from '@/lib/supabase/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError, parseBody } from '@/lib/utils/api'
import { cleanChatText, isValidUUID } from '@/lib/utils/sanitize'
import { getAdapter } from '@/lib/ai/registry'
import { completeWithRetry } from '@/lib/ai/retry'
import { InvalidApiKeyError, InsufficientCreditError, RateLimitError } from '@/lib/ai/types'
import { resolveAgentKey } from '@/lib/ai/agent-key'
import { loadTeam, pickLead, runLeadTurn } from '@/lib/orchestrator/lead'

export const maxDuration = 120

const MIGRATION_HINT = 'ฐานข้อมูลยังไม่รองรับแผนงานในแชท — เปิด Supabase > SQL Editor แล้วรันไฟล์ supabase/migrations/0004_simple_agents.sql หนึ่งครั้ง'

/**
 * คุยกับหัวหน้าทีม — ทุกข้อความเป็นบทสนทนาปกติ ไม่ใช่การสั่งงานทันที
 * หัวหน้าทีมตอบเอง / ถามกลับ / เสนอแผนให้กดยืนยัน (งานจะเริ่มเมื่อผู้ใช้ยืนยันเท่านั้น)
 * ผลลัพธ์อยู่ในตาราง messages (หน้าจอ poll อยู่แล้ว) endpoint นี้ตอบแค่ว่าสำเร็จหรือไม่
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidUUID(id)) return apiError('BAD_REQUEST', 'project id ไม่ถูกต้อง')

  const auth = await requireUser()
  if (!auth) return apiError('UNAUTHORIZED', 'ต้องล็อกอินก่อน')

  const [body, err] = await parseBody<{ message?: unknown }>(req)
  if (err) return err
  const message = cleanChatText(body.message)
  if (!message) return apiError('BAD_REQUEST', 'พิมพ์ข้อความก่อนส่ง')

  const { data: projectRow } = await auth.supabase
    .from('projects')
    .select('id, name, instructions, max_tasks_per_run, budget_usd, spent_usd')
    .eq('id', id)
    .maybeSingle()
  const project = projectRow as {
    id: string; name: string; instructions: string | null; max_tasks_per_run: number
    budget_usd: number | null; spent_usd: number
  } | null
  if (!project) return apiError('NOT_FOUND', 'ไม่พบโปรเจกต์นี้')
  if (project.budget_usd !== null && Number(project.spent_usd) >= Number(project.budget_usd)) {
    return apiError('BUDGET_EXCEEDED', 'ใช้งบของโปรเจกต์นี้ครบแล้ว — เพิ่มงบก่อนจึงจะคุยต่อได้')
  }

  const team = await loadTeam(auth.supabase, id).catch(() => null)
  if (!team) return apiError('INTERNAL_ERROR', 'โหลดทีม AI ไม่สำเร็จ')
  const lead = pickLead(team)
  if (!lead) return apiError('BAD_REQUEST', 'ยังไม่มี AI ในทีม — ไปที่แท็บ Agents แล้วเพิ่ม (แค่วาง API key แล้วเลือกโมเดล)')

  // เช็ก key ก่อนบันทึกข้อความ จะได้ไม่มีข้อความผู้ใช้ค้างในแชทเมื่อยังคุยไม่ได้
  const admin = createAdminClient()
  const apiKey = await resolveAgentKey(admin, lead, auth.user.id)
  if (!apiKey) return apiError('BAD_REQUEST', `${lead.name} ยังไม่มี API key — เพิ่มที่แท็บ Agents`)

  const { data: saved, error: saveError } = await auth.supabase
    .from('messages')
    .insert({ project_id: id, role: 'user', content: message })
    .select('id')
    .single()
  if (saveError || !saved) return apiError('INTERNAL_ERROR', saveError?.message ?? 'บันทึกข้อความไม่สำเร็จ')
  const userMessageId = (saved as { id: string }).id

  try {
    const adapter = getAdapter(lead.provider)
    await runLeadTurn({
      admin,
      complete: (req) => completeWithRetry(adapter, req, { rateLimitWaitMaxSeconds: 20 }),
      project: {
        id,
        name: project.name,
        instructions: project.instructions ?? '',
        max_tasks_per_run: project.max_tasks_per_run,
      },
      team,
      lead,
      apiKey,
      userMessage: message,
      userMessageId,
    })
    return apiOk({ ok: true })
  } catch (e) {
    // ตอบไม่สำเร็จ → ถอนข้อความที่เพิ่งบันทึก หน้าจอจะคืนข้อความเข้าช่องพิมพ์ ผู้ใช้กดส่งใหม่ได้โดยไม่ซ้ำในแชท
    await admin.from('messages').delete().eq('id', userMessageId)
    if (e instanceof InvalidApiKeyError) {
      return apiError('BAD_REQUEST', `API key ของ ${lead.name} ใช้ไม่ได้ (ไม่ถูกต้องหรือหมดอายุ) — เปลี่ยนที่แท็บ Agents`)
    }
    if (e instanceof InsufficientCreditError) {
      return apiError('BAD_REQUEST', `เครดิตหรือโควตาของ ${lead.name} หมด — เติมเครดิตกับผู้ให้บริการ หรือสลับไปใช้โมเดลอื่น`)
    }
    if (e instanceof RateLimitError) {
      return apiError('RATE_LIMITED', 'ผู้ให้บริการจำกัดความถี่การใช้งาน รอสักครู่แล้วลองใหม่')
    }
    const msg = e instanceof Error ? e.message : 'คุยไม่สำเร็จ'
    return apiError('INTERNAL_ERROR', /column|plan_status|\bplan\b/i.test(msg) ? MIGRATION_HINT : msg)
  }
}
