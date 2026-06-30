import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google'
import './globals.css'
import Link from 'next/link'

const plusJakarta = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'DeskStock',
  description: 'ESP32 component sorter dashboard',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        <nav className="flex items-center gap-6 px-6 py-3 bg-white border-b border-gray-200 text-sm sticky top-0 z-10">
          <span className="font-semibold text-gray-900 tracking-tight">DeskStock</span>
          <Link href="/"          className="text-gray-500 hover:text-gray-900 transition-colors">Sort</Link>
          <Link href="/inventory" className="text-gray-500 hover:text-gray-900 transition-colors">Inventory</Link>
          <Link href="/borrows"   className="text-gray-500 hover:text-gray-900 transition-colors">Borrows</Link>
          <Link href="/components"className="text-gray-500 hover:text-gray-900 transition-colors">Components</Link>
          <Link href="/device"    className="text-gray-500 hover:text-gray-900 transition-colors">Device</Link>
          <Link href="/reports"   className="text-gray-500 hover:text-gray-900 transition-colors">Reports</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
