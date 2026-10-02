import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Multi-Agent Workspace',
  description: 'ทีม AI หลายตัวทำงานร่วมกันในโปรเจกต์เดียว',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  )
}
