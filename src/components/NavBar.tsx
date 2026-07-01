'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Sort' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/borrows', label: 'Borrows' },
  { href: '/components', label: 'Components' },
  { href: '/device', label: 'Device' },
  { href: '/reports', label: 'Reports' },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function NavBar() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-4 sm:gap-6 px-4 sm:px-6 py-3 bg-gray-100 border-b border-gray-200 text-sm sticky top-0 z-10 overflow-x-auto whitespace-nowrap">
      <span className="font-semibold text-gray-900 tracking-tight shrink-0">DeskStock</span>
      {NAV_ITEMS.map(({ href, label }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            className={
              active
                ? 'shrink-0 text-emerald-600 font-semibold transition-colors'
                : 'shrink-0 text-gray-500 hover:text-gray-900 transition-colors'
            }
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
