import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from 'next/link';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeskStock",
  description: "ESP32 component sorter dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-white">
        <nav className="flex items-center gap-6 px-6 py-3 bg-slate-900/80 border-b border-slate-800 text-sm backdrop-blur sticky top-0 z-10">
          <span className="font-semibold text-white tracking-tight">DeskStock</span>
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">Sort</Link>
          <Link href="/inventory" className="text-slate-400 hover:text-white transition-colors">Inventory</Link>
          <Link href="/borrows" className="text-slate-400 hover:text-white transition-colors">Borrows</Link>
          <Link href="/components" className="text-slate-400 hover:text-white transition-colors">Components</Link>
          <Link href="/device" className="text-slate-400 hover:text-white transition-colors">Device</Link>
          <Link href="/reports" className="text-slate-400 hover:text-white transition-colors">Reports</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
