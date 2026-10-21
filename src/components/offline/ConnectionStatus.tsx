'use client'

import Link from 'next/link'
import { CloudOff, RefreshCw, TriangleAlert, Wifi } from 'lucide-react'
import { useConnectivity } from '@/lib/offline/connectivity'

/** Nav-bar pill: online / offline / syncing, with counts of unsynced and failed actions. */
export function ConnectionStatus() {
  const { isOffline, isSyncing, ops } = useConnectivity()
  const pending = ops.filter(o => o.status === 'pending').length
  const failed = ops.filter(o => o.status === 'failed').length

  const { Icon, text, cls } = failed > 0
    ? { Icon: TriangleAlert, text: `${failed} need${failed === 1 ? 's' : ''} attention`, cls: 'bg-red-100 text-red-700' }
    : isSyncing
      ? { Icon: RefreshCw, text: 'Syncing…', cls: 'bg-sky-100 text-sky-700' }
      : isOffline
        ? { Icon: CloudOff, text: pending > 0 ? `Offline · ${pending} pending` : 'Offline', cls: 'bg-amber-100 text-amber-800' }
        : pending > 0
          ? { Icon: RefreshCw, text: `${pending} to sync`, cls: 'bg-sky-100 text-sky-700' }
          : { Icon: Wifi, text: 'Online', cls: 'bg-emerald-50 text-emerald-700' }

  return (
    <Link
      href="/sync"
      title="Connection and offline sync"
      className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      <Icon className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden />
      {text}
    </Link>
  )
}
