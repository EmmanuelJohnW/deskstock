'use client'

import { useConnectivity } from '@/lib/offline/connectivity'
import { useInventoryData } from '@/lib/offline/data'
import { describeOp } from '@/lib/offline/describe'
import { useInventory } from '@/lib/inventory/context'
import type { Op } from '@/lib/offline/types'

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const BUTTON_CLS =
  'px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors disabled:opacity-50'

interface OpListProps {
  title: string
  ops: Op[]
  empty: string
  renderActions?: (op: Op) => React.ReactNode
}

function OpList({ title, ops, empty, renderActions }: OpListProps) {
  const { inventories } = useInventory()
  const { view } = useInventoryData()
  const inventoryName = (id: number) => inventories.find(i => i.id === id)?.name ?? `Inventory ${id}`

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">
        {title} <span className="font-normal text-gray-400">({ops.length})</span>
      </h2>
      {ops.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {ops.map(op => (
            <li key={op.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="text-gray-900">{describeOp(op, view?.borrows)}</p>
                <p className="text-xs text-gray-400">
                  {inventoryName(op.inventoryId)} · {fmtDateTime(op.createdAt)}
                  {op.error && <span className="ml-2 text-red-600">{op.error}</span>}
                </p>
              </div>
              {renderActions?.(op)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function SyncPage() {
  const { isOffline, isSyncing, ops, lastSyncAt, syncNow, retry, discard, isForcedOffline, setForcedOffline } =
    useConnectivity()
  const { view } = useInventoryData()
  const pending = ops.filter(o => o.status === 'pending')
  const failed = ops.filter(o => o.status === 'failed')

  return (
    <div className="flex-1 space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Offline sync</h1>
        <p className="text-sm text-gray-500">
          Changes made without internet are saved on this laptop and sent to the online database when the connection
          is back.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">Connection</p>
          <p className={`text-lg font-semibold ${isOffline ? 'text-amber-700' : 'text-emerald-600'}`}>
            {isOffline ? 'Offline' : 'Online'}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">Saved copy of this inventory</p>
          <p className="text-lg font-semibold text-gray-900">{view ? fmtDateTime(view.fetchedAt) : '—'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">Last sync</p>
          <p className="text-lg font-semibold text-gray-900">{lastSyncAt ? fmtDateTime(lastSyncAt) : '—'}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => syncNow()}
          disabled={isOffline || isSyncing || pending.length === 0}
          className="rounded bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {isSyncing ? 'Syncing…' : 'Sync now'}
        </button>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={isForcedOffline}
            onChange={e => setForcedOffline(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          {process.env.NEXT_PUBLIC_LOCAL_HUB === 'true'
            ? 'Work offline (this laptop and the sorting device stay off the internet; changes upload when switched off)'
            : 'Work offline (simulate no internet on this browser)'}
        </label>
      </div>

      <OpList
        title="Needs attention"
        ops={failed}
        empty="Nothing failed to sync."
        renderActions={op => (
          <div className="flex gap-2">
            <button type="button" className={BUTTON_CLS} disabled={isOffline} onClick={() => retry(op.id)}>
              Retry
            </button>
            <button type="button" className={BUTTON_CLS} onClick={() => discard(op.id)}>
              Discard
            </button>
          </div>
        )}
      />

      <OpList
        title="Waiting to sync"
        ops={pending}
        empty="Everything is synced."
        renderActions={op => (
          <button type="button" className={BUTTON_CLS} onClick={() => discard(op.id)}>
            Discard
          </button>
        )}
      />

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="mb-2 font-semibold text-gray-900">What works offline</h2>
        <p>
          Inventory, Forecast, Borrows (borrow, return, undo), Add Stock, Components and Reports, using the copy saved
          the last time each inventory was opened online.{' '}
          {process.env.NEXT_PUBLIC_LOCAL_HUB === 'true'
            ? 'Sorting also works: on the hotspot the device sends its runs to this laptop, and they upload here when the internet is back.'
            : 'Sorting and the Device page need internet, because the sorting device talks directly to the online site.'}
        </p>
      </section>
    </div>
  )
}
