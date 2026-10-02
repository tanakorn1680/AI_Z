-- =============================================================================
-- rls_test.sql — ทดสอบ RLS ของ 0001_core_schema.sql
--
-- วิธีรัน: รัน schema.sql ก่อน แล้ววางไฟล์นี้ใน Supabase SQL Editor แล้วกด Run
--   * ผ่านทั้งหมด  → ได้ NOTICE "ALL RLS TESTS PASSED" และ ROLLBACK ไม่ทิ้งข้อมูล
--   * มีข้อใดล้มเหลว → ได้ EXCEPTION ระบุชื่อเทสต์ที่ล้ม
-- ทุกอย่างอยู่ใน transaction เดียวและ rollback ท้ายไฟล์ จึงไม่กระทบข้อมูลจริง
--
-- วิธีจำลองผู้ใช้: set local role authenticated + ตั้ง request.jwt.claims
-- ซึ่งเป็นวิธีเดียวกับที่ PostgREST ของ Supabase ใช้จริง
-- =============================================================================
begin;

-- ---------- helper: สลับตัวตนเป็นผู้ใช้ที่ระบุ ----------
create or replace function pg_temp.act_as(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.act_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end $$;

create or replace function pg_temp.act_as_admin() returns void
language plpgsql as $$
begin
  execute 'reset role';
end $$;

-- ตรวจว่า "คำสั่งนี้ต้องถูกปฏิเสธ" — ถ้าไม่ถูกปฏิเสธ = เทสต์ล้ม
create or replace function pg_temp.expect_denied(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_rows bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    -- UPDATE/DELETE ที่โดน RLS กรองจะสำเร็จแต่กระทบ 0 แถว ถือว่า "ถูกบล็อก"
    if v_rows > 0 then
      raise exception 'FAIL [%]: ควรถูกปฏิเสธ แต่กระทบ % แถว', p_name, v_rows;
    end if;
  exception
    when insufficient_privilege or check_violation or raise_exception then
      -- raise_exception จาก trigger ของเราเองก็ถือว่าถูกปฏิเสธ
      if sqlerrm like 'FAIL [%' then raise; end if;
  end;
end $$;

create or replace function pg_temp.expect_count(p_name text, p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  if v <> p_expected then
    raise exception 'FAIL [%]: คาดว่า % แถว แต่ได้ %', p_name, p_expected, v;
  end if;
end $$;

-- ---------- เตรียมข้อมูล (ทำในฐานะ admin) ----------
do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000000a';
  ub uuid := '00000000-0000-0000-0000-00000000000b';
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (ua, 'a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (ub, 'b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  -- trigger handle_new_user ต้องสร้าง profile ให้เอง
end $$;

do $$
begin
  if (select count(*) from public.profiles
      where id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')) <> 2 then
    raise exception 'FAIL [trigger handle_new_user]: profile ไม่ถูกสร้างอัตโนมัติ';
  end if;
end $$;

-- ข้อมูลของ A และ B (สร้างในฐานะ admin เพื่อให้แน่ใจว่ามีอยู่จริง)
insert into public.projects (id, owner_id, name, budget_usd) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'A-project', 5),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'B-project', 5);

insert into public.agents (id, project_id, name, provider, model, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'a-coder', 'anthropic', 'm', 'coder'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'b-coder', 'anthropic', 'm', 'coder');

insert into public.tasks (id, project_id, title) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'A-task'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'B-task');

insert into public.task_results (task_id, output, summary) values
  ('30000000-0000-0000-0000-00000000000b', 'B-secret-output', 'B-secret-summary');

insert into public.messages (project_id, role, content) values
  ('10000000-0000-0000-0000-00000000000b', 'user', 'B-secret-message');

insert into public.usage (project_id, provider, model, cost_usd) values
  ('10000000-0000-0000-0000-00000000000b', 'anthropic', 'm', 1.5);

insert into public.api_credentials (user_id, provider, vault_secret_id, last4) values
  ('00000000-0000-0000-0000-00000000000b', 'anthropic', gen_random_uuid(), 'B123');

insert into public.model_prices (provider, model, in_per_mtok, out_per_mtok) values
  ('anthropic', 'm', 1, 2);

insert into public.files (id, project_id, path) values
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'b/secret.ts');
insert into public.file_versions (id, file_id, content) values
  ('50000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', 'B-secret-source-code');

-- =============================================================================
-- เทสต์ในฐานะผู้ใช้ A
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

-- (1) การมองเห็น: A ต้องเห็นเฉพาะของตัวเอง ไม่เห็นของ B
select pg_temp.expect_count('A เห็น project ของตัวเอง 1 อัน', 'select 1 from public.projects', 1);
select pg_temp.expect_count('A ไม่เห็น project ของ B',
  $q$select 1 from public.projects where owner_id = '00000000-0000-0000-0000-00000000000b'$q$, 0);
select pg_temp.expect_count('A ไม่เห็น agent ของ B',
  $q$select 1 from public.agents where project_id = '10000000-0000-0000-0000-00000000000b'$q$, 0);
select pg_temp.expect_count('A ไม่เห็น task ของ B',
  $q$select 1 from public.tasks where project_id = '10000000-0000-0000-0000-00000000000b'$q$, 0);
select pg_temp.expect_count('A ไม่เห็น task_results ของ B', 'select 1 from public.task_results', 0);
select pg_temp.expect_count('A ไม่เห็น messages ของ B',
  $q$select 1 from public.messages where project_id = '10000000-0000-0000-0000-00000000000b'$q$, 0);
select pg_temp.expect_count('A ไม่เห็น usage ของ B', 'select 1 from public.usage', 0);
select pg_temp.expect_count('A เห็น profile ตัวเองเท่านั้น', 'select 1 from public.profiles', 1);
select pg_temp.expect_count('A อ่าน model_prices ได้', 'select 1 from public.model_prices', 1);

-- (1b) files / file_versions: policy ของ file_versions อ้อมผ่านตาราง files จึงต้องทดสอบให้ครบ
select pg_temp.expect_count('A ไม่เห็นไฟล์ของ B',
  $q$select 1 from public.files where project_id = '10000000-0000-0000-0000-00000000000b'$q$, 0);
select pg_temp.expect_count('A ไม่เห็นเนื้อหาไฟล์ (file_versions) ของ B', 'select 1 from public.file_versions', 0);
select pg_temp.expect_denied('A เพิ่มเวอร์ชันให้ไฟล์ของ B ไม่ได้',
  $q$insert into public.file_versions (file_id, content)
     values ('40000000-0000-0000-0000-00000000000b','injected')$q$);
select pg_temp.expect_denied('A แก้เวอร์ชันไฟล์ของ B ไม่ได้',
  $q$update public.file_versions set content = 'hacked'
     where id = '50000000-0000-0000-0000-00000000000b'$q$);
select pg_temp.expect_denied('A ลบเวอร์ชันไฟล์ของ B ไม่ได้',
  $q$delete from public.file_versions where id = '50000000-0000-0000-0000-00000000000b'$q$);
select pg_temp.expect_denied('A สร้างไฟล์ใน project ของ B ไม่ได้',
  $q$insert into public.files (project_id, path)
     values ('10000000-0000-0000-0000-00000000000b','x.ts')$q$);

-- (2) api_credentials: อ่านตารางตรง ๆ ต้องถูกปฏิเสธ; ผ่าน view ต้องไม่เห็นของ B
select pg_temp.expect_denied('A อ่าน api_credentials ตรง ๆ ไม่ได้',
  'select * from public.api_credentials');
select pg_temp.expect_count('A ไม่เห็น key ของ B ผ่าน view', 'select 1 from public.api_credentials_safe', 0);
select pg_temp.expect_denied('A เขียน api_credentials เองไม่ได้',
  $q$insert into public.api_credentials (user_id, provider, vault_secret_id, last4)
     values ('00000000-0000-0000-0000-00000000000a','openai',gen_random_uuid(),'A123')$q$);

-- (3) การเขียนข้ามผู้ใช้ต้องถูกบล็อก
select pg_temp.expect_denied('A แก้ project ของ B ไม่ได้',
  $q$update public.projects set name = 'hacked' where id = '10000000-0000-0000-0000-00000000000b'$q$);
select pg_temp.expect_denied('A ลบ project ของ B ไม่ได้',
  $q$delete from public.projects where id = '10000000-0000-0000-0000-00000000000b'$q$);
select pg_temp.expect_denied('A สร้าง project โดยอ้างเป็น B ไม่ได้',
  $q$insert into public.projects (owner_id, name) values ('00000000-0000-0000-0000-00000000000b','x')$q$);
select pg_temp.expect_denied('A สร้าง agent ใน project ของ B ไม่ได้',
  $q$insert into public.agents (project_id, name, provider, model, role)
     values ('10000000-0000-0000-0000-00000000000b','x','anthropic','m','coder')$q$);
select pg_temp.expect_denied('A สร้าง task ใน project ของ B ไม่ได้',
  $q$insert into public.tasks (project_id, title) values ('10000000-0000-0000-0000-00000000000b','x')$q$);
select pg_temp.expect_denied('A ส่งข้อความเข้า project ของ B ไม่ได้',
  $q$insert into public.messages (project_id, role, content)
     values ('10000000-0000-0000-0000-00000000000b','user','x')$q$);

-- (4) A ห้ามผูก task ของตัวเองเข้ากับ agent ของ B (ข้าม project)
select pg_temp.expect_denied('A ผูก task กับ agent ของ B ไม่ได้ (trigger)',
  $q$insert into public.tasks (project_id, title, assigned_agent)
     values ('10000000-0000-0000-0000-00000000000a','x','20000000-0000-0000-0000-00000000000b')$q$);
select pg_temp.expect_denied('A ตั้ง parent_id เป็น task ของ B ไม่ได้ (trigger)',
  $q$insert into public.tasks (project_id, title, parent_id)
     values ('10000000-0000-0000-0000-00000000000a','x','30000000-0000-0000-0000-00000000000b')$q$);

-- (5) Budget / ค่าที่ระบบคุม: ผู้ใช้ต้องแก้เองไม่ได้ (column privileges)
select pg_temp.expect_denied('A แก้ spent_usd ของตัวเองไม่ได้',
  $q$update public.projects set spent_usd = 0 where id = '10000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.expect_denied('A แก้ attempts ของ task ตัวเองไม่ได้',
  $q$update public.tasks set attempts = 0 where id = '30000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.expect_denied('A แก้ error ของ task ตัวเองไม่ได้',
  $q$update public.tasks set error = 'x' where id = '30000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.expect_denied('A แก้ depends_on ของ task ตัวเองไม่ได้',
  $q$update public.tasks set depends_on = array['30000000-0000-0000-0000-00000000000b'::uuid]
     where id = '30000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.expect_denied('A INSERT attempts ตอนสร้าง task ไม่ได้',
  $q$insert into public.tasks (project_id, title, attempts)
     values ('10000000-0000-0000-0000-00000000000a','x',99)$q$);

-- (6) ตารางที่มีเฉพาะ Worker เขียน: ผู้ใช้เขียนเองไม่ได้
select pg_temp.expect_denied('A เขียน usage เองไม่ได้ (กันปลอมค่าใช้จ่าย)',
  $q$insert into public.usage (project_id, provider, model, cost_usd)
     values ('10000000-0000-0000-0000-00000000000a','anthropic','m',0)$q$);
select pg_temp.expect_denied('A เขียน task_results เองไม่ได้',
  $q$insert into public.task_results (task_id, output)
     values ('30000000-0000-0000-0000-00000000000a','x')$q$);
select pg_temp.expect_denied('A แก้ model_prices ไม่ได้',
  $q$update public.model_prices set in_per_mtok = 0$q$);
select pg_temp.expect_denied('A เพิ่ม model_prices ไม่ได้',
  $q$insert into public.model_prices (provider, model, in_per_mtok, out_per_mtok)
     values ('openai','x',0,0)$q$);

-- (7) สิ่งที่ A "ต้องทำได้" (กัน policy เข้มจนใช้งานไม่ได้)
do $$
begin
  insert into public.projects (owner_id, name)
    values ('00000000-0000-0000-0000-00000000000a', 'A-second');
  update public.projects set name = 'A-renamed' where id = '10000000-0000-0000-0000-00000000000a';
  insert into public.agents (project_id, name, provider, model, role)
    values ('10000000-0000-0000-0000-00000000000a', 'a-researcher', 'google', 'm', 'researcher');
  insert into public.tasks (project_id, title, assigned_agent, depends_on)
    values ('10000000-0000-0000-0000-00000000000a', 'A-task-2',
            '20000000-0000-0000-0000-00000000000a',
            array['30000000-0000-0000-0000-00000000000a'::uuid]);
  update public.tasks set status = 'cancelled'
    where id = '30000000-0000-0000-0000-00000000000a';
  insert into public.messages (project_id, role, content)
    values ('10000000-0000-0000-0000-00000000000a', 'user', 'hello');
  insert into public.files (id, project_id, path)
    values ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'src/index.ts');
  insert into public.file_versions (file_id, content)
    values ('40000000-0000-0000-0000-00000000000a', 'console.log(1)');
exception when others then
  raise exception 'FAIL [A ทำงานปกติของตัวเองไม่ได้]: %', sqlerrm;
end $$;

-- A ต้องเห็นผลของการกระทำตัวเอง
select pg_temp.expect_count('A เห็น project 2 อัน', 'select 1 from public.projects', 2);
select pg_temp.expect_count('A เห็น task ของตัวเอง 2 อัน', 'select 1 from public.tasks', 2);
select pg_temp.expect_count('A เห็นเวอร์ชันไฟล์ของตัวเอง', 'select 1 from public.file_versions', 1);
select pg_temp.expect_count('A เห็น task ที่ตัวเอง cancel',
  $q$select 1 from public.tasks where status = 'cancelled'$q$, 1);

-- =============================================================================
-- เทสต์ในฐานะ anon (ยังไม่ล็อกอิน)
-- =============================================================================
select pg_temp.act_as_anon();
select pg_temp.expect_denied('anon อ่าน projects ไม่ได้',   'select * from public.projects');
select pg_temp.expect_denied('anon อ่าน tasks ไม่ได้',      'select * from public.tasks');
select pg_temp.expect_denied('anon อ่าน model_prices ไม่ได้','select * from public.model_prices');
select pg_temp.expect_denied('anon อ่าน api_credentials ไม่ได้','select * from public.api_credentials');
select pg_temp.expect_denied('anon อ่าน view key ไม่ได้',   'select * from public.api_credentials_safe');
select pg_temp.expect_denied('anon เรียก is_project_owner ไม่ได้',
  $q$select public.is_project_owner('10000000-0000-0000-0000-00000000000a')$q$);

-- =============================================================================
-- เทสต์ในฐานะผู้ใช้ B: ต้องไม่เห็นผลงานของ A และเห็นเฉพาะของตัวเอง
-- =============================================================================
select pg_temp.act_as_admin();
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');

select pg_temp.expect_count('B เห็น project ตัวเอง 1 อัน', 'select 1 from public.projects', 1);
select pg_temp.expect_count('B ไม่เห็น message ของ A',
  $q$select 1 from public.messages where content = 'hello'$q$, 0);
select pg_temp.expect_count('B เห็น task_results ของตัวเอง', 'select 1 from public.task_results', 1);
select pg_temp.expect_count('B เห็น usage ของตัวเอง', 'select 1 from public.usage', 1);
select pg_temp.expect_count('B เห็นเวอร์ชันไฟล์ของตัวเอง 1 อัน', 'select 1 from public.file_versions', 1);
select pg_temp.expect_count('B ไม่เห็นไฟล์ของ A',
  $q$select 1 from public.files where path = 'src/index.ts'$q$, 0);
select pg_temp.expect_count('B เห็น key ของตัวเองผ่าน view เท่านั้น 1 อัน',
  'select 1 from public.api_credentials_safe', 1);
select pg_temp.expect_denied('B อ่าน api_credentials ตรง ๆ ไม่ได้',
  'select vault_secret_id from public.api_credentials');

-- ต้องไม่มีคอลัมน์ vault_secret_id หลุดใน view
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'api_credentials_safe'
      and column_name in ('vault_secret_id', 'user_id')
  ) then
    raise exception 'FAIL [view api_credentials_safe มีคอลัมน์ลับหลุด]';
  end if;
end $$;


-- =============================================================================
-- ส่วนที่ 2: กฎ status, Vault, ฟังก์ชัน Worker
-- =============================================================================
select pg_temp.act_as_admin();

-- เตรียม project สำหรับทดสอบ Worker (ในฐานะ admin/service)
insert into public.projects (id, owner_id, name, budget_usd, max_concurrent_tasks) values
  ('11000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'W-project', 1.0, 2);
insert into public.agents (id, project_id, name, provider, model, role) values
  ('21000000-0000-0000-0000-00000000000a', '11000000-0000-0000-0000-00000000000a', 'w-agent', 'anthropic', 'm', 'coder');
insert into public.tasks (id, project_id, title, assigned_agent, depends_on) values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-00000000000a', 'T1', '21000000-0000-0000-0000-00000000000a', '{}'),
  ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-00000000000a', 'T2', '21000000-0000-0000-0000-00000000000a',
     array['31000000-0000-0000-0000-000000000001'::uuid]),
  ('31000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-00000000000a', 'T3', '21000000-0000-0000-0000-00000000000a', '{}'),
  ('31000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-00000000000a', 'T4', '21000000-0000-0000-0000-00000000000a', '{}');

-- ---- ฟังก์ชัน Worker ต้องปิดจากผู้ใช้และ anon ----
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_denied('ผู้ใช้เรียก claim_task ตรง ๆ ไม่ได้',
  $q$select * from public.claim_task('31000000-0000-0000-0000-000000000001')$q$);
select pg_temp.expect_denied('ผู้ใช้เรียก complete_task เองไม่ได้ (กันปลอมผล/ค่าใช้จ่าย)',
  $q$select public.complete_task('31000000-0000-0000-0000-000000000001','x','x',1,1,'anthropic','m',0)$q$);
select pg_temp.expect_denied('ผู้ใช้เรียก fail_task เองไม่ได้',
  $q$select public.fail_task('31000000-0000-0000-0000-000000000001','x')$q$);
select pg_temp.expect_denied('ผู้ใช้ดึง API key ด้วย get_api_key ไม่ได้',
  $q$select public.get_api_key('00000000-0000-0000-0000-00000000000b','anthropic')$q$);
select pg_temp.expect_denied('ผู้ใช้เรียก store_api_key เองไม่ได้',
  $q$select public.store_api_key('00000000-0000-0000-0000-00000000000a','anthropic','sk-test-12345678')$q$);
select pg_temp.expect_denied('ผู้ใช้อ่าน vault.decrypted_secrets ไม่ได้',
  'select * from vault.decrypted_secrets');
select pg_temp.expect_denied('ผู้ใช้อ่าน vault.secrets ไม่ได้',
  'select * from vault.secrets');

-- ---- ผู้ใช้เปลี่ยน status ผิดกติกาไม่ได้ ----
select pg_temp.expect_denied('ผู้ใช้ตั้ง task เป็น completed เองไม่ได้',
  $q$update public.tasks set status = 'completed' where id = '31000000-0000-0000-0000-000000000001'$q$);
select pg_temp.expect_denied('ผู้ใช้ตั้ง task เป็น running เองไม่ได้',
  $q$update public.tasks set status = 'running' where id = '31000000-0000-0000-0000-000000000001'$q$);
select pg_temp.expect_denied('ผู้ใช้ตั้ง task เป็น failed เองไม่ได้',
  $q$update public.tasks set status = 'failed' where id = '31000000-0000-0000-0000-000000000001'$q$);
select pg_temp.expect_denied('ผู้ใช้สร้าง task เป็น completed เองไม่ได้',
  $q$insert into public.tasks (project_id, title, status)
     values ('11000000-0000-0000-0000-00000000000a','x','completed')$q$);
-- guard_task_status_change เช็คจาก current_user ว่าเป็นเจ้าของฟังก์ชัน (postgres/
-- supabase_admin) หรือไม่ — ไม่ใช้ session flag ที่ผู้เรียกตั้งเองได้แบบเดิม (เวอร์ชันก่อนหน้า
-- เคยใช้ set_config('app.system_task_update', ...) ซึ่งเป็นช่องโหว่จริง: set_config() เป็น
-- ฟังก์ชันมาตรฐานที่ role authenticated เรียกได้เองสำหรับ custom GUC โดยไม่ต้องมีสิทธิ์พิเศษ
-- ผู้ใช้จึงตั้ง flag นี้เองก่อน UPDATE ตรง ๆ แล้วหลอก trigger ให้ผ่านได้
--
-- หมายเหตุเรื่อง current_user check นี้: บน Supabase role 'postgres' เคยเป็น superuser
-- แต่หลัง security migration ของ Supabase (ดู supabase.com/changelog/9314) จะไม่ใช่
-- superuser อีกต่อไปในโปรเจกต์ที่ผ่านการย้ายแล้ว — แต่ยังไม่ยืนยันได้ 100% ว่าทุกโปรเจกต์
-- ผ่านการย้ายแล้วหรือยัง (ขึ้นกับตอนที่สร้างโปรเจกต์) เทสต์นี้จึงตรวจแค่ว่า current_user
-- ของ role authenticated ไม่ใช่ postgres/supabase_admin โดยตรง (ซึ่งเป็นความจริงเสมอ
-- ไม่ว่า postgres จะเป็น superuser หรือไม่ก็ตาม) และไม่พึ่งพฤติกรรมของ SET ROLE เลย
-- เพราะพฤติกรรมนั้นอาจต่างกันระหว่างโปรเจกต์เก่า/ใหม่ — จุดป้องกันจริงคือ authenticated
-- ไม่เคยถูก GRANT membership ใน postgres role (ตรวจได้จาก schema.sql: ไม่มีบรรทัด
-- GRANT postgres TO authenticated ที่ใดเลย) จึง SET ROLE postgres ควรถูกปฏิเสธเสมอ
-- ในระบบที่ deploy จริงผ่าน Supabase API (session_user เป็น authenticated ตรง ๆ
-- ไม่ใช่ postgres ที่ลดสิทธิ์ชั่วคราวแบบใน SQL Editor)
do $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    raise exception 'FAIL [สมมติฐานเทสต์ผิด]: role authenticated ไม่ควรมี current_user เป็น %', current_user;
  end if;
end $$;

-- ลองยืนยันด้วย SET ROLE จริง — ถ้า deny แปลว่า current_user check ปลอดภัยแน่นอนในบริบทนี้
-- ถ้ากลับสำเร็จ (เช่น project เก่าที่ postgres ยังเป็น superuser) เทสต์จะแจ้ง WARNING
-- ให้รู้ตัว แทนที่จะ FAIL ทั้งไฟล์ เพราะนี่เป็นข้อจำกัดของสภาพแวดล้อมทดสอบ ไม่ใช่ของระบบจริง
-- เทสต์เชิงโครงสร้างจาก pg_auth_members catalog โดยตรง: authenticated ต้องไม่ได้เป็น
-- สมาชิกของ postgres/supabase_admin เลย ไม่ว่า postgres จะมี SUPERUSER attribute
-- หรือไม่ในโปรเจกต์นี้ก็ตาม (เพราะ current_user check ใน guard_task_status_change
-- ปลอดภัยตราบใดที่ authenticated ไม่มี membership ในสอง role นี้)
--
-- จงใจไม่ทดสอบด้วยการ SET ROLE postgres จริง ๆ ในไฟล์นี้ เพราะพบว่าการทำเช่นนั้นแล้ว
-- พยายาม "คืนค่ากลับ" มีความเสี่ยงสูงที่จะทำผิดพลาด (RESET ROLE คืนไปที่ session_user
-- ซึ่งบน SQL Editor คือ postgres เสมอ ไม่ใช่ role ก่อนหน้าใน transaction) และถ้าคืนค่า
-- กลับพลาด session จะค้างเป็น postgres ไปตลอดเทสต์ที่เหลือทั้งไฟล์ ทำให้ทุกเทสต์หลังจากนั้น
-- ไม่ได้ทดสอบในฐานะ authenticated จริง — ความเสี่ยงนี้สูงกว่าประโยชน์ที่ได้จากการพิสูจน์
-- runtime behavior ตรง ๆ การตรวจ catalog ข้างล่างนี้ให้หลักฐานที่เพียงพอและปลอดภัยกว่า
do $$
declare v_is_member boolean;
begin
  select exists (
    select 1
    from pg_auth_members m
    join pg_roles member_role on member_role.oid = m.member
    join pg_roles granted_role on granted_role.oid = m.roleid
    where member_role.rolname = 'authenticated'
      and granted_role.rolname in ('postgres', 'supabase_admin')
  ) into v_is_member;

  if v_is_member then
    raise exception 'FAIL [authenticated ไม่ควรเป็นสมาชิกของ postgres/supabase_admin]: '
      'พบ membership จริง — ตรวจ GRANT ที่ผิดพลาดใน schema.sql';
  end if;
end $$;

-- สิ่งที่ทดสอบได้จริงในบริบทนี้: แม้ผู้ใช้จะยังจำวิธีเก่า (ตั้ง legacy flag ก่อน update)
-- ก็ต้องไม่มีผลใด ๆ เพราะ trigger เวอร์ชันนี้ไม่อ่านค่า session flag นั้นอีกต่อไปแล้ว
-- (แยกเป็น do block เพราะ EXECUTE ของ expect_denied รันได้ทีละ 1 statement เท่านั้น
--  จะยัด "set_config(...); update ..." เป็น string เดียวไม่ได้ — ดูบทเรียนด้านบน)
do $$
begin
  perform set_config('app.system_task_update', 'on', true);
  begin
    update public.tasks set status = 'completed' where id = '31000000-0000-0000-0000-000000000001';
    raise exception 'FAIL [legacy flag ไม่ควรมีผลกับ trigger เวอร์ชันนี้]: update สำเร็จโดยไม่ควร';
  exception
    when insufficient_privilege then
      null; -- ถูกต้อง: legacy flag ไม่มีผล ถูกปฏิเสธตามปกติ
  end;
  perform set_config('app.system_task_update', '', true); -- คืนค่าเผื่อกระทบเทสต์ถัดไป
exception when others then
  perform set_config('app.system_task_update', '', true);
  raise;
end $$;

-- ---- Worker ทำงาน (ในฐานะ service/admin) ----
select pg_temp.act_as_admin();

do $$
declare n integer;
begin
  -- T2 พึ่ง T1 ที่ยังไม่เสร็จ → claim ไม่ได้
  select count(*) into n from public.claim_task('31000000-0000-0000-0000-000000000002');
  if n <> 0 then raise exception 'FAIL [claim T2 ทั้งที่ dependency ยังไม่เสร็จ]'; end if;

  -- ready_tasks ต้องมี T1, T3, T4 (ไม่มี T2)
  select count(*) into n from public.ready_tasks('11000000-0000-0000-0000-00000000000a');
  if n <> 3 then raise exception 'FAIL [ready_tasks ควรได้ 3 ได้ %]', n; end if;

  -- claim T1 สำเร็จ และ claim ซ้ำต้องไม่ได้ (กัน 2 Worker ทำงานเดียวกัน)
  select count(*) into n from public.claim_task('31000000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'FAIL [claim T1 ควรสำเร็จ]'; end if;
  select count(*) into n from public.claim_task('31000000-0000-0000-0000-000000000001');
  if n <> 0 then raise exception 'FAIL [claim T1 ซ้ำไม่ควรได้]'; end if;

  -- เพดาน concurrency = 2: claim T3 ได้ (running=2) แต่ T4 ต้องไม่ได้
  select count(*) into n from public.claim_task('31000000-0000-0000-0000-000000000003');
  if n <> 1 then raise exception 'FAIL [claim T3 ควรสำเร็จ (running=2)]'; end if;
  select count(*) into n from public.claim_task('31000000-0000-0000-0000-000000000004');
  if n <> 0 then raise exception 'FAIL [claim T4 เกินเพดาน concurrency ต้องไม่ได้]'; end if;

  -- T1 เสร็จ → บันทึกผล + ค่าใช้จ่ายพร้อมกัน
  perform public.complete_task('31000000-0000-0000-0000-000000000001', 'out', 'sum', 10, 20, 'anthropic', 'm', 0.4);
  if (select spent_usd from public.projects where id = '11000000-0000-0000-0000-00000000000a') <> 0.4 then
    raise exception 'FAIL [spent_usd ไม่ถูกอัปเดตตอน complete]';
  end if;
  if (select status from public.tasks where id = '31000000-0000-0000-0000-000000000001') <> 'completed' then
    raise exception 'FAIL [T1 ควร completed]';
  end if;

  -- complete ซ้ำต้องไม่คิดเงินซ้ำ
  perform public.complete_task('31000000-0000-0000-0000-000000000001', 'out', 'sum', 10, 20, 'anthropic', 'm', 0.4);
  if (select spent_usd from public.projects where id = '11000000-0000-0000-0000-00000000000a') <> 0.4 then
    raise exception 'FAIL [complete ซ้ำคิดเงินซ้ำ]';
  end if;

  -- T1 เสร็จแล้ว → T2 พร้อมรัน
  select count(*) into n from public.claim_task('31000000-0000-0000-0000-000000000002');
  if n <> 1 then raise exception 'FAIL [claim T2 หลัง T1 เสร็จควรสำเร็จ]'; end if;

  -- งบ: ตั้ง spent ให้เกินงบ → claim ต้องไม่ได้
  update public.projects set spent_usd = 1.0 where id = '11000000-0000-0000-0000-00000000000a';
  update public.tasks set status = 'completed' where id in
    ('31000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000003');
  select count(*) into n from public.claim_task('31000000-0000-0000-0000-000000000004');
  if n <> 0 then raise exception 'FAIL [claim ทั้งที่เกินงบ ต้องไม่ได้]'; end if;
end $$;

-- ---- retry / fail / cancel_blocked ----
insert into public.tasks (id, project_id, title, max_attempts) values
  ('31000000-0000-0000-0000-000000000010', '11000000-0000-0000-0000-00000000000a', 'R1', 2),
  ('31000000-0000-0000-0000-000000000011', '11000000-0000-0000-0000-00000000000a', 'R2-depends-R1', 2);
update public.tasks set depends_on = array['31000000-0000-0000-0000-000000000010'::uuid]
  where id = '31000000-0000-0000-0000-000000000011';
update public.projects set spent_usd = 0 where id = '11000000-0000-0000-0000-00000000000a';

do $$
declare r text; n integer;
begin
  perform * from public.claim_task('31000000-0000-0000-0000-000000000010');      -- attempts=1
  r := public.fail_task('31000000-0000-0000-0000-000000000010', 'boom');
  if r <> 'retry' then raise exception 'FAIL [fail ครั้งแรกควร retry ได้ %]', r; end if;

  perform * from public.claim_task('31000000-0000-0000-0000-000000000010');      -- attempts=2
  r := public.fail_task('31000000-0000-0000-0000-000000000010', 'boom2');
  if r <> 'failed' then raise exception 'FAIL [fail ครบรอบควรเป็น failed ได้ %]', r; end if;

  n := public.cancel_blocked_tasks('11000000-0000-0000-0000-00000000000a');
  if n <> 1 then raise exception 'FAIL [cancel_blocked ควรปิด R2 จำนวน 1 ได้ %]', n; end if;
  if (select status from public.tasks where id = '31000000-0000-0000-0000-000000000011') <> 'cancelled' then
    raise exception 'FAIL [R2 ควรถูก cancelled]';
  end if;
end $$;

-- ---- ตัวกู้ task ค้าง ----
insert into public.tasks (id, project_id, title, status, attempts, max_attempts, started_at) values
  ('31000000-0000-0000-0000-000000000020', '11000000-0000-0000-0000-00000000000a', 'stuck', 'running', 1, 2, now() - interval '1 hour'),
  ('31000000-0000-0000-0000-000000000021', '11000000-0000-0000-0000-00000000000a', 'fresh', 'running', 1, 2, now());
do $$
declare n integer;
begin
  n := public.recover_stuck_tasks('11000000-0000-0000-0000-00000000000a', 600);
  if n <> 1 then raise exception 'FAIL [recover ควรกู้ 1 ได้ %]', n; end if;
  if (select status from public.tasks where id = '31000000-0000-0000-0000-000000000020') <> 'pending' then
    raise exception 'FAIL [stuck ควรกลับเป็น pending]';
  end if;
  if (select status from public.tasks where id = '31000000-0000-0000-0000-000000000021') <> 'running' then
    raise exception 'FAIL [fresh ต้องไม่ถูกแตะ]';
  end if;
end $$;

-- ผู้ใช้กู้งานค้างของตัวเองได้ผ่าน recover_my_project แต่ของคนอื่นไม่ได้
update public.tasks set status = 'running', started_at = now() - interval '1 hour'
  where id = '31000000-0000-0000-0000-000000000020';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$
begin
  if public.recover_my_project('11000000-0000-0000-0000-00000000000a', 600) <> 1 then
    raise exception 'FAIL [ผู้ใช้ควรกู้งานค้างของตัวเองได้]';
  end if;
end $$;
select pg_temp.expect_denied('ผู้ใช้กู้งานค้างของ project คนอื่นไม่ได้',
  $q$select public.recover_my_project('10000000-0000-0000-0000-00000000000b', 600)$q$);

-- ผู้ใช้ retry งานที่ failed ได้ (failed → pending) และ attempts ถูกรีเซ็ต
do $$
begin
  update public.tasks set status = 'pending' where id = '31000000-0000-0000-0000-000000000010';
  if (select attempts from public.tasks where id = '31000000-0000-0000-0000-000000000010') <> 0 then
    raise exception 'FAIL [retry ต้องรีเซ็ต attempts]';
  end if;
exception when others then
  raise exception 'FAIL [ผู้ใช้ควร retry งาน failed ได้]: %', sqlerrm;
end $$;

-- ---- พิสูจน์ว่า role service_role (ที่ Worker ใช้จริง) เรียกฟังก์ชันได้ ไม่ใช่แค่ postgres ----
select pg_temp.act_as_service();
do $$
declare n integer;
begin
  perform count(*) from public.ready_tasks('11000000-0000-0000-0000-00000000000a');
  perform public.cancel_blocked_tasks('11000000-0000-0000-0000-00000000000a');
  perform public.recover_stuck_tasks('11000000-0000-0000-0000-00000000000a', 600);
  perform public.store_api_key('00000000-0000-0000-0000-00000000000b', 'openai', 'sk-svc-test-000099');
  if public.get_api_key('00000000-0000-0000-0000-00000000000b', 'openai') <> 'sk-svc-test-000099' then
    raise exception 'FAIL [service_role อ่าน key ผ่าน get_api_key ไม่ได้]';
  end if;
  perform public.delete_api_key('00000000-0000-0000-0000-00000000000b', 'openai');
exception when insufficient_privilege then
  raise exception 'FAIL [service_role ขาดสิทธิ์เรียกฟังก์ชัน Worker/Vault]: %', sqlerrm;
end $$;
select pg_temp.act_as_admin();

-- ---- Vault: store/get/delete ทำงานจริง (ในฐานะ admin เทียบเท่า service role) ----
select pg_temp.act_as_admin();
do $$
declare k text;
begin
  perform public.store_api_key('00000000-0000-0000-0000-00000000000a', 'anthropic', 'sk-ant-test-abcdef1234');
  k := public.get_api_key('00000000-0000-0000-0000-00000000000a', 'anthropic');
  if k is distinct from 'sk-ant-test-abcdef1234' then raise exception 'FAIL [get_api_key ไม่คืนค่าเดิม]'; end if;
  if (select last4 from public.api_credentials
      where user_id = '00000000-0000-0000-0000-00000000000a' and provider = 'anthropic') <> '1234' then
    raise exception 'FAIL [last4 ไม่ถูกต้อง]';
  end if;
  -- ตารางของเราต้องไม่มี key เต็ม
  if exists (select 1 from public.api_credentials where last4 like 'sk-%') then
    raise exception 'FAIL [พบ key ในตารางที่ไม่ใช่ Vault]';
  end if;
  -- เปลี่ยน key: ของเก่าต้องหายจาก Vault (ไม่ตกค้าง)
  perform public.store_api_key('00000000-0000-0000-0000-00000000000a', 'anthropic', 'sk-ant-test-newkey9999');
  if (select count(*) from vault.decrypted_secrets where decrypted_secret = 'sk-ant-test-abcdef1234') <> 0 then
    raise exception 'FAIL [key เก่าค้างใน Vault หลังเปลี่ยน]';
  end if;
  perform public.delete_api_key('00000000-0000-0000-0000-00000000000a', 'anthropic');
  if (select count(*) from vault.decrypted_secrets where decrypted_secret = 'sk-ant-test-newkey9999') <> 0 then
    raise exception 'FAIL [key ค้างใน Vault หลังลบ]';
  end if;
  if public.get_api_key('00000000-0000-0000-0000-00000000000a', 'anthropic') is not null then
    raise exception 'FAIL [ลบแล้วยังดึง key ได้]';
  end if;
end $$;

-- =============================================================================
-- สรุป
-- =============================================================================
select pg_temp.act_as_admin();
do $$ begin raise notice 'ALL RLS TESTS PASSED'; end $$;

rollback;
