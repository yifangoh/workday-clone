import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Workpath', template: '%s · Workpath' },
  description: 'Leave and expense claims — apply, approve, record and pay in one place.',
}

export const viewport: Viewport = { themeColor: '#0d2440' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-SG">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
