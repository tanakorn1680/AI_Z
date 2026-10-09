-- =============================================================================
-- 0004: Agent แบบเรียบง่าย
--   1) 1 API key ต่อ 1 agent (เก็บใน Vault เหมือนเดิม — ในตาราง agents เก็บแค่ตัวชี้ + 4 ตัวท้าย)
--   2) 1 หน้าที่ต่อ 1 agent (ข้อความอิสระ ไม่ต้องเลือกจากรายการตายตัว)
--   3) แผนงานที่ AI เสนอในแชท รอผู้ใช้กดยืนยัน (เก็บไว้กับข้อความนั้น)
--   4) ฟังก์ชันบันทึก token/ค่าใช้จ่ายของการคุยแชท
--
-- รันครั้งเดียวใน Supabase -> SQL Editor (รันซ้ำได้ ไม่พัง) หลังรัน schema.sql แล้ว
-- agent เดิมที่ใช้ key ร่วมตาม provider ยังทำงานต่อได้ ไม่ต้องแก้อะไร
-- =============================================================================

-- (1)(2) คอลัมน์ใหม่ของ agents
alter table public.agents add column if not exists vault_secret_id uuid;
alter table public.agents add column if not exists key_last4 text
  check (key_last4 is null or char_length(key_last4) = 4);
alter table public.agents add column if not exists duty text not null default ''
  check (char_length(duty) <= 300);

-- (3) แผนงานที่รอยืนยัน อยู่กับข้อความของ AI ที่เสนอแผนนั้น
alter table public.messages add column if not exists plan jsonb;
alter table public.messages add column if not exists plan_status text
  check (plan_status is null or plan_status in ('pending', 'started', 'dismissed'));
create index if not exists messages_plan_pending_idx
  on public.messages (project_id, created_at desc) where plan_status = 'pending';

-- -----------------------------------------------------------------------------
-- key ต่อ agent — ใช้ Vault เหมือน store_api_key/get_api_key เดิม
-- ชื่อ secret ขึ้นต้นด้วย agentkey:<agent_id>: เสมอ และทุกฟังก์ชันตรวจชื่อนี้ซ้ำ
-- เพื่อว่าต่อให้มีคนแก้ vault_secret_id ของ agent ตัวเองให้ชี้ไป secret ของคนอื่น ก็อ่าน/ลบไม่ได้
-- -----------------------------------------------------------------------------
create or replace function public.set_agent_key(p_agent_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if p_key is null or char_length(p_key) < 8 then
    raise exception 'API key สั้นเกินไป';
  end if;

  select vault_secret_id into v_old from public.agents where id = p_agent_id;
  if not found then
    raise exception 'ไม่พบ agent';
  end if;

  v_new := vault.create_secret(
    p_key,
    'agentkey:' || p_agent_id::text || ':' || gen_random_uuid()::text,
    'agent key'
  );

  update public.agents
     set vault_secret_id = v_new,
         key_last4       = right(p_key, 4)
   where id = p_agent_id;

  -- ลบ key เก่าที่ถูกแทนที่ ไม่ให้ตกค้างใน Vault
  if v_old is not null then
    delete from vault.secrets
     where id = v_old
       and name like ('agentkey:' || p_agent_id::text || ':%');
  end if;
end;
$$;

create or replace function public.get_agent_key(p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from public.agents a
  join vault.decrypted_secrets ds on ds.id = a.vault_secret_id
  where a.id = p_agent_id
    and ds.name like ('agentkey:' || a.id::text || ':%');
$$;

-- ลบ agent (หรือลบทั้ง project) แล้ว key ใน Vault ต้องหายไปด้วย
create or replace function public.agents_delete_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.vault_secret_id is not null then
    delete from vault.secrets
     where id = old.vault_secret_id
       and name like ('agentkey:' || old.id::text || ':%');
  end if;
  return old;
end;
$$;

drop trigger if exists agents_secret_cleanup on public.agents;
create trigger agents_secret_cleanup
  after delete on public.agents
  for each row execute function public.agents_delete_secret();

-- เรียกได้เฉพาะ service role (เซิร์ฟเวอร์ของเรา) เท่านั้น — ห้ามผู้ใช้เรียกเอง
revoke all on function public.set_agent_key(uuid, text)    from public, anon, authenticated;
revoke all on function public.get_agent_key(uuid)          from public, anon, authenticated;
revoke all on function public.agents_delete_secret()       from public, anon, authenticated;
grant execute on function public.set_agent_key(uuid, text) to service_role;
grant execute on function public.get_agent_key(uuid)       to service_role;

-- -----------------------------------------------------------------------------
-- บันทึก token + ค่าใช้จ่ายของการคุยแชท (ไม่ผูกกับ task) ในธุรกรรมเดียว
-- ทำให้ตัวเลข spent_usd ของ project รวมค่าคุยแชทด้วย
-- -----------------------------------------------------------------------------
create or replace function public.record_chat_usage(
  p_project_id uuid,
  p_provider   public.provider_name,
  p_model      text,
  p_tokens_in  integer,
  p_tokens_out integer,
  p_cost_usd   numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage (project_id, task_id, provider, model, tokens_in, tokens_out, cost_usd)
  values (p_project_id, null, p_provider, p_model,
          greatest(p_tokens_in, 0), greatest(p_tokens_out, 0), greatest(p_cost_usd, 0));

  update public.projects
     set spent_usd = spent_usd + greatest(p_cost_usd, 0)
   where id = p_project_id;
end;
$$;

revoke all on function public.record_chat_usage(uuid, public.provider_name, text, integer, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.record_chat_usage(uuid, public.provider_name, text, integer, integer, numeric)
  to service_role;
