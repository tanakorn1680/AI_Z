-- =============================================================================
-- schema.sql — Multi-Agent AI Workspace (ไฟล์เดียว รันครั้งเดียวจบ)
--
-- วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- รันซ้ำไม่ได้ (create type/table ซ้ำจะ error) ถ้าต้องการรันใหม่ให้ลบ project
-- หรือรัน supabase/reset.sql ก่อน
--
-- ต้องการ: Supabase project ใหม่ (Vault เปิดใช้งานเป็นค่าเริ่มต้น)
-- =============================================================================

-- =============================================================================
-- 0001_core_schema.sql
-- Multi-Agent AI Workspace — Phase 0: ตารางหลัก + RLS
--
-- หลักการ:
--   * ทุกแถวผูกกับ user หรือ project อย่างชัดเจน
--   * RLS เปิดทุกตาราง (deny by default) แล้วอนุญาตเฉพาะเจ้าของ project
--   * ตารางที่ผู้ใช้ "ไม่ควรเขียนเอง" (task_results, usage) ไม่มี policy INSERT/UPDATE/DELETE
--     จึงเขียนได้เฉพาะ service role ที่ใช้ใน Worker ฝั่ง Server เท่านั้น
--   * api_credentials ไม่มี policy SELECT เลย: ผู้ใช้อ่านแถวตัวเองไม่ได้ผ่าน API ตรง ๆ
--     ต้องอ่านผ่านมุมมอง api_credentials_safe ที่ไม่มีคอลัมน์ลับ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums (ใช้ enum แทน text เพื่อกันค่าผิดที่ระดับ DB)
-- -----------------------------------------------------------------------------
create type public.task_status as enum
  ('pending', 'running', 'completed', 'failed', 'cancelled');

create type public.agent_role as enum
  ('manager', 'researcher', 'coder', 'reviewer', 'custom');

create type public.provider_name as enum
  ('anthropic', 'openai', 'google',
   'openrouter', 'deepseek', 'groq', 'xai', 'mistral', 'together', 'custom');

create type public.message_role as enum
  ('user', 'assistant', 'system');

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references public.profiles (id) on delete cascade,
  name                   text not null check (char_length(name) between 1 and 200),
  instructions           text not null default '',
  -- Cost control: ค่าเหล่านี้ผู้ใช้ตั้งเอง ไม่มีค่า default ที่ฝังตัวเลขราคา
  budget_usd             numeric(12, 4) check (budget_usd is null or budget_usd >= 0),
  spent_usd              numeric(12, 4) not null default 0 check (spent_usd >= 0),
  max_concurrent_tasks   integer not null default 3 check (max_concurrent_tasks between 1 and 20),
  max_tokens_per_task    integer not null default 4096 check (max_tokens_per_task between 1 and 200000),
  max_tasks_per_run      integer not null default 12 check (max_tasks_per_run between 1 and 100),
  created_at             timestamptz not null default now()
);
create index projects_owner_idx on public.projects (owner_id);

-- -----------------------------------------------------------------------------
-- api_credentials  (BYOK) — เก็บแค่ตัวชี้ไป Vault ไม่เก็บ key จริง
-- -----------------------------------------------------------------------------
create table public.api_credentials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  provider        public.provider_name not null,
  vault_secret_id uuid not null,
  last4           text not null check (char_length(last4) = 4),
  created_at      timestamptz not null default now(),
  -- 1 key ต่อ provider ต่อผู้ใช้ (เรียบง่าย; เปลี่ยน key = ลบแล้วเพิ่มใหม่)
  unique (user_id, provider)
);

-- -----------------------------------------------------------------------------
-- agents
-- -----------------------------------------------------------------------------
create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 100),
  provider      public.provider_name not null,
  model         text not null check (char_length(model) between 1 and 100),
  role          public.agent_role not null,
  system_prompt text not null default '',
  -- ค่าเริ่มต้นเป็นสิทธิ์น้อยที่สุด (อ่านไฟล์ได้อย่างเดียว) — Backend เป็นผู้บังคับใช้
  allowed_tools text[] not null default array['read_file']::text[],
  max_tokens    integer check (max_tokens is null or max_tokens between 1 and 200000),
  -- ใช้เฉพาะ provider = 'custom' (endpoint แบบ OpenAI-compatible ที่ผู้ใช้กรอกเอง)
  base_url      text check (base_url is null or char_length(base_url) <= 300),
  created_at    timestamptz not null default now(),
  unique (project_id, name)
);
create index agents_project_idx on public.agents (project_id);

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  parent_id      uuid references public.tasks (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 300),
  description    text not null default '',
  assigned_agent uuid references public.agents (id) on delete set null,
  status         public.task_status not null default 'pending',
  priority       integer not null default 0,
  depends_on     uuid[] not null default '{}'::uuid[],
  input          jsonb not null default '{}'::jsonb,
  error          text,
  attempts       integer not null default 0 check (attempts >= 0),
  max_attempts   integer not null default 2 check (max_attempts between 1 and 5),
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  -- Task ห้ามพึ่งพาตัวเอง (ตรวจวงจรที่ซับซ้อนกว่านี้ใน planner ฝั่งแอป)
  constraint tasks_no_self_dependency check (not (id = any (depends_on)))
);
-- ใช้ตอน list task ของ project และนับ task ที่ running (concurrency limit)
create index tasks_project_status_idx on public.tasks (project_id, status);
-- ใช้หา task ที่พร้อมรัน / ตัวกู้ task ค้าง
create index tasks_pending_idx on public.tasks (created_at) where status = 'pending';
create index tasks_running_idx on public.tasks (started_at) where status = 'running';
create index tasks_parent_idx  on public.tasks (parent_id);

-- -----------------------------------------------------------------------------
-- task_results  (แยกจาก tasks เพื่อไม่ลากข้อความยาวมาทุกครั้งที่ list task)
-- -----------------------------------------------------------------------------
create table public.task_results (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null unique references public.tasks (id) on delete cascade,
  output     text not null default '',
  -- summary สั้น ๆ คือสิ่งที่ส่งต่อให้ Task ถัดไป (แทน output เต็ม เพื่อประหยัด token)
  summary    text not null default '',
  tokens_in  integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- messages  (แชทระหว่างผู้ใช้กับระบบ)
-- -----------------------------------------------------------------------------
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  role       public.message_role not null,
  content    text not null,
  task_id    uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now()
);
create index messages_project_created_idx on public.messages (project_id, created_at desc);

-- -----------------------------------------------------------------------------
-- files + file_versions
-- -----------------------------------------------------------------------------
create table public.files (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  path               text not null check (char_length(path) between 1 and 500),
  current_version_id uuid,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now()
);
-- path ซ้ำกันไม่ได้ใน project เดียวกัน (เฉพาะไฟล์ที่ยังไม่ถูกลบ)
create unique index files_project_path_uniq
  on public.files (project_id, path) where deleted_at is null;

create table public.file_versions (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.files (id) on delete cascade,
  content    text not null,
  created_by uuid references public.agents (id) on delete set null,
  created_at timestamptz not null default now()
);
create index file_versions_file_idx on public.file_versions (file_id, created_at desc);

alter table public.files
  add constraint files_current_version_fk
  foreign key (current_version_id) references public.file_versions (id) on delete set null;

-- -----------------------------------------------------------------------------
-- usage  +  model_prices
-- -----------------------------------------------------------------------------
create table public.usage (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id    uuid references public.tasks (id) on delete set null,
  provider   public.provider_name not null,
  model      text not null,
  tokens_in  integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  cost_usd   numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index usage_project_created_idx on public.usage (project_id, created_at desc);

-- ราคาต่อ 1 ล้าน token: ไม่ฝังตัวเลขในโค้ดหรือใน migration — ผู้ดูแลกรอกเองจากหน้า pricing ทางการ
create table public.model_prices (
  provider    public.provider_name not null,
  model       text not null,
  in_per_mtok  numeric(12, 6) not null check (in_per_mtok >= 0),
  out_per_mtok numeric(12, 6) not null check (out_per_mtok >= 0),
  updated_at  timestamptz not null default now(),
  primary key (provider, model)
);

-- =============================================================================
-- ฟังก์ชันตัวช่วย RLS
-- security definer + search_path ล็อกไว้ เพื่อกัน search_path hijack
-- และเพื่อไม่ให้ policy วนเรียก RLS ของตาราง projects ซ้ำซ้อน
-- =============================================================================
create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.owner_id = (select auth.uid())
  );
$$;

-- ไม่ให้ anon เรียก; เฉพาะผู้ใช้ที่ล็อกอิน
revoke all on function public.is_project_owner(uuid) from public;
revoke all on function public.is_project_owner(uuid) from anon;
grant execute on function public.is_project_owner(uuid) to authenticated;

-- =============================================================================
-- Trigger: สร้าง profile อัตโนมัติเมื่อสมัครสมาชิก
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Trigger: กัน agent/task/file ที่ผูกข้าม project (integrity ระดับ DB)
-- ผู้ใช้อาจส่ง assigned_agent ของ project อื่นมา ซึ่ง RLS ปกติไม่จับ
-- =============================================================================
create or replace function public.enforce_task_agent_same_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_agent is not null then
    if not exists (
      select 1 from public.agents a
      where a.id = new.assigned_agent and a.project_id = new.project_id
    ) then
      raise exception 'assigned_agent must belong to the same project';
    end if;
  end if;
  if new.parent_id is not null then
    if not exists (
      select 1 from public.tasks t
      where t.id = new.parent_id and t.project_id = new.project_id
    ) then
      raise exception 'parent_id must belong to the same project';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_same_project_guard
  before insert or update of assigned_agent, parent_id, project_id on public.tasks
  for each row execute function public.enforce_task_agent_same_project();

-- =============================================================================
-- เปิด RLS ทุกตาราง (deny by default)
-- =============================================================================
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.api_credentials enable row level security;
alter table public.agents          enable row level security;
alter table public.tasks           enable row level security;
alter table public.task_results    enable row level security;
alter table public.messages        enable row level security;
alter table public.files           enable row level security;
alter table public.file_versions   enable row level security;
alter table public.usage           enable row level security;
alter table public.model_prices    enable row level security;

-- -----------------------------------------------------------------------------
-- Policies
-- (select auth.uid()) ห่อด้วย select เพื่อให้ Postgres cache ค่าต่อ query
-- -----------------------------------------------------------------------------

-- profiles: อ่าน/แก้ได้เฉพาะของตัวเอง (สร้างโดย trigger เท่านั้น จึงไม่มี INSERT)
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- projects: เจ้าของเท่านั้น
-- หมายเหตุ: spent_usd ไม่ควรถูกผู้ใช้แก้เอง — ดู column privileges ด้านล่าง
create policy projects_select_own on public.projects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy projects_insert_own on public.projects
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy projects_update_own on public.projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy projects_delete_own on public.projects
  for delete to authenticated using (owner_id = (select auth.uid()));

-- api_credentials: ไม่มี SELECT/UPDATE policy — ผู้ใช้อ่านแถวตรง ๆ ไม่ได้
-- INSERT/DELETE ผ่าน API route ฝั่ง server (service role) เพื่อจัดการ Vault ให้ถูกต้อง
-- (ไม่มี policy ใด ๆ สำหรับ role authenticated)

-- agents / tasks / messages / files: เจ้าของ project เท่านั้น
create policy agents_all_owner on public.agents
  for all to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- tasks: ผู้ใช้อ่านและ "ยกเลิก/retry" ได้ แต่สถานะอื่นควบคุมโดย Worker
-- (บังคับเพิ่มด้วย column privileges ด้านล่าง)
create policy tasks_all_owner on public.tasks
  for all to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

create policy messages_all_owner on public.messages
  for all to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

create policy files_all_owner on public.files
  for all to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- file_versions: ไม่มี project_id ตรง ๆ จึงเช็คผ่านไฟล์แม่
create policy file_versions_all_owner on public.file_versions
  for all to authenticated
  using (
    exists (
      select 1 from public.files f
      where f.id = file_versions.file_id
        and public.is_project_owner(f.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.files f
      where f.id = file_versions.file_id
        and public.is_project_owner(f.project_id)
    )
  );

-- task_results: อ่านได้อย่างเดียว (Worker เขียนผ่าน service role)
create policy task_results_select_owner on public.task_results
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_results.task_id
        and public.is_project_owner(t.project_id)
    )
  );

-- usage: อ่านได้อย่างเดียว (Worker เขียนผ่าน service role) — กันผู้ใช้ปลอมตัวเลขค่าใช้จ่าย
create policy usage_select_owner on public.usage
  for select to authenticated
  using (public.is_project_owner(project_id));

-- model_prices: ทุกคนที่ล็อกอินอ่านได้ (ไม่ใช่ข้อมูลลับ) แต่ไม่มีใครเขียนได้ผ่าน API
create policy model_prices_select_all on public.model_prices
  for select to authenticated using (true);

-- =============================================================================
-- Column-level privileges
-- RLS จำกัด "แถวไหน" แต่ไม่จำกัด "คอลัมน์ไหน" — ปิดช่องที่ผู้ใช้ไม่ควรแก้เอง
-- =============================================================================

-- ผู้ใช้แก้ spent_usd ของ project ตัวเองไม่ได้ (กันข้าม budget)
revoke update on public.projects from authenticated;
grant  update (name, instructions, budget_usd, max_concurrent_tasks,
               max_tokens_per_task, max_tasks_per_run)
  on public.projects to authenticated;

-- ผู้ใช้แก้ task ได้เฉพาะ status (เพื่อ cancel/retry) และ assigned_agent (เปลี่ยน agent)
-- ไม่ให้แก้ attempts / error / started_at / completed_at / depends_on เอง
revoke update on public.tasks from authenticated;
grant  update (status, assigned_agent) on public.tasks to authenticated;

-- ผู้ใช้ INSERT task ได้เฉพาะคอลัมน์พื้นฐาน; ค่าที่ระบบคุม (attempts, error ฯลฯ) ใช้ default
revoke insert on public.tasks from authenticated;
grant  insert (project_id, parent_id, title, description, assigned_agent,
               priority, depends_on, input)
  on public.tasks to authenticated;

-- api_credentials: ปิดทุกอย่างจาก role authenticated (เข้าถึงผ่าน service role เท่านั้น)
revoke all on public.api_credentials from authenticated;
revoke all on public.api_credentials from anon;

-- =============================================================================
-- มุมมองปลอดภัยสำหรับแสดงรายการ key ในหน้า Settings (ไม่มี vault_secret_id)
-- view นี้รันด้วยสิทธิ์ของเจ้าของ view (ไม่ใช่ security_invoker) เพราะตารางฐาน
-- ถูก revoke จาก authenticated ไปแล้ว จึงต้องกรอง user_id = auth.uid() ใน view เอง
-- และเปิดเฉพาะคอลัมน์ที่ปลอดภัย (ไม่มี vault_secret_id)
-- =============================================================================
create or replace view public.api_credentials_safe
with (security_barrier = true) as
  select id, provider, last4, created_at
  from public.api_credentials
  where user_id = (select auth.uid());

revoke all on public.api_credentials_safe from public;
revoke all on public.api_credentials_safe from anon;
grant select on public.api_credentials_safe to authenticated;

-- anon ไม่มีสิทธิ์เข้าถึงตารางใดเลย (ทั้งของที่มีอยู่ และที่จะสร้างในอนาคต)
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- =============================================================================
-- ส่วนที่ 2: กฎ status ของ task, Vault (BYOK), ฟังก์ชันของ Worker
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (2.1) ผู้ใช้เปลี่ยน status ได้แค่ 2 แบบ: ยกเลิกงาน และสั่ง retry
--       สถานะอื่น (running/completed/failed) เป็นของ Worker เท่านั้น
--       service role (Worker) ไม่ถูกจำกัด เพราะ auth.uid() เป็น null
-- -----------------------------------------------------------------------------
create or replace function public.guard_task_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- ไม่ใช่ผู้ใช้ที่ล็อกอิน (Worker/service role/ตัวแก้ในฐานะ admin) → ผ่านได้
  if (select auth.uid()) is null then
    return new;
  end if;
  -- ผู้ใช้เรียกผ่านฟังก์ชัน security definer ของเรา (เช่น recover_my_project) → ผ่านได้
  --
  -- เดิมจุดนี้เช็คจาก current_setting('app.system_task_update') ที่ผู้เรียกตั้งเอง
  -- ก่อนเรียก UPDATE ซึ่งเป็นช่องโหว่จริง: set_config() เป็นฟังก์ชันมาตรฐานที่ role
  -- authenticated เรียกได้เสมอสำหรับ custom GUC (ไม่ต้องมีสิทธิ์พิเศษแบบ superuser-only
  -- parameter) ผู้ใช้จึงตั้งค่านี้เองก่อน UPDATE ตรง ๆ แล้วหลอก trigger ได้
  --
  -- current_user คือแนวป้องกันที่แท้จริง: security definer function รันด้วยสิทธิ์ของ
  -- เจ้าของฟังก์ชัน (ผู้สร้าง schema นี้ ปกติคือ postgres) ไม่ใช่สิทธิ์ของผู้เรียก และ
  -- ผู้ใช้ authenticated ไม่มีทาง SET ROLE เป็นเจ้าของฟังก์ชันได้เอง (ไม่ได้ grant สิทธิ์
  -- SET ROLE ให้ authenticated ไว้เลย) — ค่านี้จึงปลอมไม่ได้จากฝั่งผู้เรียก
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'cancelled' and old.status in ('pending', 'running') then
      return new;
    end if;
    if new.status = 'pending' and old.status in ('failed', 'cancelled') then
      -- retry: เริ่มนับรอบใหม่ (attempts แก้เองไม่ได้ จึงรีเซ็ตที่นี่)
      new.attempts := 0;
      new.error := null;
      new.started_at := null;
      new.completed_at := null;
      return new;
    end if;
    raise exception 'ผู้ใช้เปลี่ยนสถานะ task จาก % เป็น % ไม่ได้', old.status, new.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_status_guard
  before update of status on public.tasks
  for each row execute function public.guard_task_status_change();

-- ผู้ใช้สร้าง task ได้แค่สถานะ pending (ห้ามสร้างเป็น completed เพื่อหลอก dependency)
create or replace function public.guard_task_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.status <> 'pending' then
    raise exception 'ผู้ใช้สร้าง task ที่ไม่ใช่ pending ไม่ได้' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_insert_guard
  before insert on public.tasks
  for each row execute function public.guard_task_insert();

-- ผู้ใช้ต้องมีสิทธิ์ INSERT คอลัมน์ status ด้วย เพื่อให้ trigger ข้างบนทำงานได้
-- (ถ้าไม่ให้ ค่า default 'pending' ก็ใช้ได้อยู่แล้ว จึงไม่ต้อง grant เพิ่ม)

-- -----------------------------------------------------------------------------
-- (2.2) BYOK ด้วย Supabase Vault
--       ตรวจกับเอกสารแล้ว: vault.create_secret() และ vault.decrypted_secrets
--       ฟังก์ชันเหล่านี้เรียกได้เฉพาะ service role เท่านั้น
-- -----------------------------------------------------------------------------
create or replace function public.store_api_key(
  p_user_id  uuid,
  p_provider public.provider_name,
  p_key      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_old       uuid;
begin
  if p_key is null or char_length(p_key) < 8 then
    raise exception 'API key สั้นเกินไป';
  end if;

  select vault_secret_id into v_old
  from public.api_credentials
  where user_id = p_user_id and provider = p_provider;

  -- ชื่อ secret ไม่ใส่ตัวคีย์ และไม่ซ้ำ (unique name ของ vault)
  v_secret_id := vault.create_secret(
    p_key,
    'byok:' || p_user_id::text || ':' || p_provider::text || ':' || gen_random_uuid()::text,
    'BYOK ' || p_provider::text
  );

  insert into public.api_credentials (user_id, provider, vault_secret_id, last4)
  values (p_user_id, p_provider, v_secret_id, right(p_key, 4))
  on conflict (user_id, provider)
  do update set vault_secret_id = excluded.vault_secret_id,
                last4           = excluded.last4,
                created_at      = now();

  -- ลบ secret เก่าที่ถูกแทนที่ ไม่ให้ตกค้างใน Vault
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;
end;
$$;

create or replace function public.delete_api_key(
  p_user_id  uuid,
  p_provider public.provider_name
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_secret_id uuid;
begin
  delete from public.api_credentials
  where user_id = p_user_id and provider = p_provider
  returning vault_secret_id into v_secret_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

create or replace function public.get_api_key(
  p_user_id  uuid,
  p_provider public.provider_name
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from public.api_credentials c
  join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
  where c.user_id = p_user_id and c.provider = p_provider;
$$;

-- ล็อกให้เรียกได้เฉพาะ service role: ห้าม anon และ authenticated เรียกเอง
-- (ถ้าเปิดให้ authenticated จะเรียก get_api_key ด้วย user_id ของคนอื่นได้!)
revoke all on function public.store_api_key(uuid, public.provider_name, text) from public, anon, authenticated;
revoke all on function public.delete_api_key(uuid, public.provider_name)       from public, anon, authenticated;
revoke all on function public.get_api_key(uuid, public.provider_name)          from public, anon, authenticated;
grant execute on function public.store_api_key(uuid, public.provider_name, text) to service_role;
grant execute on function public.delete_api_key(uuid, public.provider_name)       to service_role;
grant execute on function public.get_api_key(uuid, public.provider_name)          to service_role;

-- -----------------------------------------------------------------------------
-- (2.3) ฟังก์ชันของ Worker — ทำเป็น SQL เพื่อให้ atomic (กันแย่งกันทำ/เกินงบ)
-- -----------------------------------------------------------------------------

-- claim: จับ task 1 อัน แบบ atomic โดยตรวจ 4 เงื่อนไขพร้อมกันในคำสั่งเดียว
--   1) task ยังเป็น pending          2) dependency ทุกตัว completed
--   3) จำนวนที่ running ไม่เกินเพดาน   4) ยังไม่เกินงบ
-- คืน 0 แถวเมื่อจับไม่ได้ (ไม่ใช่ error) — Worker ที่เรียกซ้ำก็ไม่ทำงานซ้ำ
create or replace function public.claim_task(p_task_id uuid)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_task    public.tasks;
  v_running integer;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then return; end if;

  -- ล็อกแถว project เพื่อให้การนับ running กับการ claim ไม่แย่งกันข้าม Worker
  select * into v_project from public.projects where id = v_task.project_id for update;

  select count(*) into v_running
  from public.tasks
  where project_id = v_task.project_id and status = 'running';

  if v_running >= v_project.max_concurrent_tasks then return; end if;

  if v_project.budget_usd is not null and v_project.spent_usd >= v_project.budget_usd then
    return;
  end if;

  return query
  update public.tasks t
     set status = 'running',
         started_at = now(),
         attempts = t.attempts + 1,
         error = null
   where t.id = p_task_id
     and t.status = 'pending'
     and not exists (
       select 1
       from unnest(t.depends_on) d(dep_id)
       left join public.tasks dt on dt.id = d.dep_id
       where dt.id is null or dt.status <> 'completed'
     )
  returning t.*;
end;
$$;

-- บันทึกผลสำเร็จ + ค่าใช้จ่าย ในธุรกรรมเดียว (ผลกับตัวเลขงบจึงไม่มีทางไม่ตรงกัน)
create or replace function public.complete_task(
  p_task_id    uuid,
  p_output     text,
  p_summary    text,
  p_tokens_in  integer,
  p_tokens_out integer,
  p_provider   public.provider_name,
  p_model      text,
  p_cost_usd   numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_project uuid;
begin
  select project_id into v_project from public.tasks where id = p_task_id and status = 'running';
  if v_project is null then
    -- ถูกยกเลิกระหว่างรัน หรือไม่ได้อยู่สถานะ running → ไม่เขียนทับ
    return;
  end if;

  insert into public.task_results (task_id, output, summary, tokens_in, tokens_out)
  values (p_task_id, p_output, p_summary, p_tokens_in, p_tokens_out)
  on conflict (task_id) do update
    set output = excluded.output, summary = excluded.summary,
        tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out;

  insert into public.usage (project_id, task_id, provider, model, tokens_in, tokens_out, cost_usd)
  values (v_project, p_task_id, p_provider, p_model, p_tokens_in, p_tokens_out, p_cost_usd);

  update public.projects set spent_usd = spent_usd + p_cost_usd where id = v_project;

  update public.tasks
     set status = 'completed', completed_at = now(), error = null
   where id = p_task_id;
end;
$$;

-- ล้มเหลว: ถ้ายังเหลือรอบ retry ให้กลับเป็น pending ไม่งั้นเป็น failed
-- คืน 'retry' หรือ 'failed' ให้ Worker รู้ว่าต้องเรียกตัวเองใหม่หรือไม่
create or replace function public.fail_task(p_task_id uuid, p_error text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id and status = 'running';
  if not found then return 'ignored'; end if;

  if v_task.attempts < v_task.max_attempts then
    update public.tasks set status = 'pending', error = left(p_error, 2000) where id = p_task_id;
    return 'retry';
  end if;

  update public.tasks
     set status = 'failed', error = left(p_error, 2000), completed_at = now()
   where id = p_task_id;
  return 'failed';
end;
$$;

-- กู้ task ที่ค้างที่ running นานเกินกำหนด (Function ตายกลางทาง)
-- ใช้เวลาเป็นวินาทีที่ Worker ส่งมา ไม่ฝังตัวเลขไว้ที่นี่
create or replace function public.recover_stuck_tasks(p_project_id uuid, p_older_than_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with stuck as (
    select id, attempts, max_attempts
    from public.tasks
    where project_id = p_project_id
      and status = 'running'
      and started_at < now() - make_interval(secs => p_older_than_seconds)
    for update skip locked
  ), upd as (
    update public.tasks t
       set status = case when s.attempts < s.max_attempts then 'pending'::public.task_status
                         else 'failed'::public.task_status end,
           error = 'Worker หมดเวลา (ไม่มีการตอบกลับ)',
           completed_at = case when s.attempts < s.max_attempts then null else now() end
      from stuck s
     where t.id = s.id
    returning 1
  )
  select count(*) into v_count from upd;
  return v_count;
end;
$$;

-- คืนรายการ task ที่ "พร้อมรัน" (pending + dependency ครบ) ของ project
create or replace function public.ready_tasks(p_project_id uuid)
returns setof public.tasks
language sql
stable
security definer
set search_path = ''
as $$
  select t.*
  from public.tasks t
  where t.project_id = p_project_id
    and t.status = 'pending'
    and not exists (
      select 1
      from unnest(t.depends_on) d(dep_id)
      left join public.tasks dt on dt.id = d.dep_id
      where dt.id is null or dt.status <> 'completed'
    )
  order by t.priority desc, t.created_at;
$$;

-- ถ้า dependency ตัวใดล้มเหลว/ถูกยกเลิก task ที่รออยู่จะไม่มีวันรัน → ปิดเป็น cancelled
-- คืนจำนวนที่ถูกปิด (Worker เรียกหลัง task ใด ๆ ล้มเหลว)
create or replace function public.cancel_blocked_tasks(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_total integer := 0; v_n integer;
begin
  loop
    with blocked as (
      select t.id
      from public.tasks t
      where t.project_id = p_project_id
        and t.status = 'pending'
        and exists (
          select 1
          from unnest(t.depends_on) d(dep_id)
          join public.tasks dt on dt.id = d.dep_id
          where dt.status in ('failed', 'cancelled')
        )
    ), upd as (
      update public.tasks t
         set status = 'cancelled',
             error = 'ยกเลิกอัตโนมัติ: งานที่ต้องพึ่งพาล้มเหลวหรือถูกยกเลิก',
             completed_at = now()
        from blocked b where t.id = b.id
      returning 1
    )
    select count(*) into v_n from upd;
    exit when v_n = 0;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

-- ทุกฟังก์ชัน Worker: เฉพาะ service role
do $$
declare f text;
begin
  foreach f in array array[
    'claim_task(uuid)',
    'complete_task(uuid,text,text,integer,integer,public.provider_name,text,numeric)',
    'fail_task(uuid,text)',
    'recover_stuck_tasks(uuid,integer)',
    'ready_tasks(uuid)',
    'cancel_blocked_tasks(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ใช้กับ recover: ผู้ใช้กดเองผ่านหน้าเว็บ (เฉพาะ project ของตัวเอง)
create or replace function public.recover_my_project(p_project_id uuid, p_older_than_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- ไม่ต้องตั้ง flag ใด ๆ อีกต่อไป — guard_task_status_change ผ่านให้ฟังก์ชันนี้ได้เอง
  -- เพราะฟังก์ชันนี้เป็น security definer จึงรันด้วยสิทธิ์เจ้าของฟังก์ชัน (current_user
  -- เปลี่ยนไปเป็นเจ้าของฟังก์ชันจริงระหว่างรันฟังก์ชันนี้) ดู guard_task_status_change
  return public.recover_stuck_tasks(p_project_id, p_older_than_seconds);
end;
$$;
revoke all on function public.recover_my_project(uuid, integer) from public, anon;
grant execute on function public.recover_my_project(uuid, integer) to authenticated, service_role;
