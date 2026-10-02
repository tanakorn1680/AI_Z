import type { NextConfig } from 'next'

// โปรเจกต์เก่าตั้ง ignoreBuildErrors / ignoreDuringBuilds ไว้ ซึ่งทำให้ build ผ่านทั้งที่โค้ดผิด
// ที่นี่ไม่ปิดการตรวจ: ถ้า type หรือ lint ผิด build ต้องล้ม
const nextConfig: NextConfig = {}

export default nextConfig
