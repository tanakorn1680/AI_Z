# ขั้นตอนที่เหลือ (ตัด RLS test ออกจาก critical path)

## 1. Supabase — แค่รัน schema.sql พอ
- Supabase Dashboard → New Project
- SQL Editor → วาง supabase/schema.sql ทั้งไฟล์ → Run
- ข้าม rls_test.sql ไปได้เลย ไม่จำเป็นสำหรับใช้งานคนเดียว
- เก็บ 3 ค่า: Project URL, anon key, service_role key (Settings → API)

## 2. Push ขึ้น GitHub
git init
git add .
git commit -m "initial"
# สร้าง repo เปล่าบน github.com ก่อน แล้ว
git remote add origin <your-repo-url>
git push -u origin main

## 3. Vercel — deploy แล้วดู build log
- vercel.com/new → import repo
- ใส่ env vars 4 ตัว (ดู .env.example)
- Deploy
- **ถ้า build fail**: copy error message ทั้งก้อนมาให้ผมดู — นี่คือจุดที่ยังไม่เคยทดสอบจริง
  เพราะ sandbox เขียนโค้ดนี้ต่อเน็ตไม่ได้ ดังนั้นมีโอกาสพอสมควรที่จะมี error เล็ก ๆ
  (import ผิด, syntax ที่ TypeScript version จริงเข้มกว่า stub ที่ผมใช้ตรวจ ฯลฯ)
  แก้ตามนั้นได้เลย ไม่ต้องเดา

## 4. เปิด Vercel Queues
- Vercel Dashboard → โปรเจกต์นี้ → Storage/Queues → เปิดใช้งาน
- Deploy ใหม่อีกครั้ง

## 5. ทดสอบใช้งาน
- สมัคร → สร้าง project → เพิ่ม API key ผ่าน curl (ดู README ข้อ 4)
- เพิ่ม agent role=manager → พิมพ์คำสั่งใน chat
