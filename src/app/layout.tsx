import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Multi-Agent Workspace',
  description: 'ทีม AI หลายตัวทำงานร่วมกันในโปรเจกต์เดียว',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ให้หน้าจอย่อตามคีย์บอร์ดบนมือถือ: ช่องพิมพ์จะอยู่เหนือคีย์บอร์ดและแถบบนไม่หายไป
  interactiveWidget: 'resizes-content',
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  )
}
