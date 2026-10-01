-- reset.sql — ลบทุกอย่างที่ schema.sql สร้าง เพื่อรันใหม่ (ข้อมูลทั้งหมดจะหาย!)
drop view     if exists public.api_credentials_safe;
drop table    if exists public.usage, public.model_prices, public.file_versions, public.files,
                        public.messages, public.task_results, public.tasks, public.agents,
                        public.api_credentials, public.projects, public.profiles cascade;
drop function if exists public.store_api_key(uuid, public.provider_name, text),
                        public.delete_api_key(uuid, public.provider_name),
                        public.get_api_key(uuid, public.provider_name),
                        public.claim_task(uuid),
                        public.complete_task(uuid,text,text,integer,integer,public.provider_name,text,numeric),
                        public.fail_task(uuid,text),
                        public.recover_stuck_tasks(uuid,integer),
                        public.recover_my_project(uuid,integer),
                        public.ready_tasks(uuid),
                        public.cancel_blocked_tasks(uuid),
                        public.is_project_owner(uuid),
                        public.guard_task_status_change(),
                        public.guard_task_insert(),
                        public.enforce_task_agent_same_project(),
                        public.handle_new_user() cascade;
drop type     if exists public.task_status, public.agent_role, public.provider_name, public.message_role cascade;
