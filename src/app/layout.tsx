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
        <nav className="flex items-center gap-4 sm:gap-6 px-4 sm:px-6 py-3 bg-white border-b border-gray-200 text-sm sticky top-0 z-10 overflow-x-auto whitespace-nowrap">
          <span className="font-semibold text-gray-900 tracking-tight shrink-0">DeskStock</span>
          <Link href="/"          className="shrink-0 text-gray-500 hover:text-gray-900 transition-colors">Sort</Link>
          <Link href="/inventory" className="shrink-0 text-gray-500 hover:text-gray-900 transition-colors">Inventory</Link>
          <Link href="/borrows"   className="shrink-0 text-gray-500 hover:text-gray-900 transition-colors">Borrows</Link>
          <Link href="/components"className="shrink-0 text-gray-500 hover:text-gray-900 transition-colors">Components</Link>
          <Link href="/device"    className="shrink-0 text-gray-500 hover:text-gray-900 transition-colors">Device</Link>
          <Link href="/reports"   className="shrink-0 text-gray-500 hover:text-gray-900 transition-colors">Reports</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
