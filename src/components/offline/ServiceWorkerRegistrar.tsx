'use client'

import { useEffect } from 'react'
import { useConnectivity } from '@/lib/offline/connectivity'

// Registers public/sw.js (production builds only) so pages open offline, and
// asks it to save every page whenever we're online.

const SW_VERSION = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local'

export function ServiceWorkerRegistrar() {
  const { isOffline } = useConnectivity()

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register(`/sw.js?v=${SW_VERSION}`)
      .catch(err => console.error('[sw] registration failed:', err))
  }, [])

  useEffect(() => {
    if (isOffline || process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then(reg => reg.active?.postMessage('warm')).catch(() => {})
  }, [isOffline])

  return null
}
