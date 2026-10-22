import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google'
import './globals.css'
import { NavBar } from '@/components/NavBar'
import { InventoryProvider } from '@/lib/inventory/context'
import { ForecastProvider } from '@/lib/forecast/context'
import { ConnectivityProvider } from '@/lib/offline/connectivity'
import { InventoryDataProvider } from '@/lib/offline/data'
import { ServiceWorkerRegistrar } from '@/components/offline/ServiceWorkerRegistrar'
import { ForecastAlertBanner } from '@/components/forecast/ForecastAlertBanner'

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
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <ConnectivityProvider>
          <ServiceWorkerRegistrar />
          <InventoryProvider>
            <InventoryDataProvider>
              <ForecastProvider>
                <NavBar />
                <ForecastAlertBanner />
                {children}
              </ForecastProvider>
            </InventoryDataProvider>
          </InventoryProvider>
        </ConnectivityProvider>
      </body>
    </html>
  )
}
