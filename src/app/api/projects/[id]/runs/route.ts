import { apiError } from '@/lib/utils/api'

/**
 * เลิกใช้แล้ว — เดิมทุกข้อความในแชทถูกแปลงเป็นงานทันที
 * ระบบใหม่คุยกับหัวหน้าทีมผ่าน POST /api/projects/:id/chat แล้วให้ผู้ใช้กดยืนยันแผนก่อนเริ่มงาน
 * คงไฟล์นี้ไว้เป็น stub เพื่อให้การแตกไฟล์ทับ repo เดิมไม่ทิ้งโค้ดเก่าที่พึ่ง planner.ts (ลบ planner.ts ทิ้งได้)
 */
export async function POST() {
  return apiError('BAD_REQUEST', 'เส้นทางนี้เลิกใช้แล้ว — ใช้ /api/projects/:id/chat แทน')
}
