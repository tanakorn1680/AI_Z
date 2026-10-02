-- =============================================================================
-- 0002: รองรับ provider เพิ่ม (OpenAI-compatible) + base_url ต่อ agent
-- รันครั้งเดียวใน Supabase SQL Editor (รันซ้ำได้ ไม่พัง)
-- ไม่ต้องสร้างยศแอดมิน — ระบบนี้ไม่มี role แอดมิน ผู้ใช้ทุกคนจัดการ agent ของ project ตัวเอง
-- =============================================================================

alter type public.provider_name add value if not exists 'openrouter';
alter type public.provider_name add value if not exists 'deepseek';
alter type public.provider_name add value if not exists 'groq';
alter type public.provider_name add value if not exists 'xai';
alter type public.provider_name add value if not exists 'mistral';
alter type public.provider_name add value if not exists 'together';
-- 'custom' = endpoint แบบ OpenAI-compatible อะไรก็ได้ (ผู้ใช้กรอก base URL ต่อ agent)
alter type public.provider_name add value if not exists 'custom';

alter table public.agents
  add column if not exists base_url text
  check (base_url is null or char_length(base_url) <= 300);
