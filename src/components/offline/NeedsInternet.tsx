'use client'

import { CloudOff } from 'lucide-react'
import { useConnectivity } from '@/lib/offline/connectivity'

interface NeedsInternetProps {
  feature: string
}

/** Banner for features that only work online (the sorting device talks to the hosted site). */
export function NeedsInternet({ feature }: NeedsInternetProps) {
  const { isOffline } = useConnectivity()
  if (!isOffline) return null
  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 sm:px-6">
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">{feature} needs an internet connection.</span> Inventory, borrows and
        components still work offline and sync later.
      </span>
    </div>
  )
}
