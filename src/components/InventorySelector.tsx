'use client'

import { useState } from 'react'
import { useInventory } from '@/lib/inventory/context'

const SELECT_CLS =
  'bg-white border border-gray-300 rounded px-2 py-1 text-gray-900 text-xs focus:outline-none focus:border-emerald-500'

export function InventorySelector() {
  const { inventories, selectedInventoryId, loading, selectInventory, createInventory, archiveInventory } =
    useInventory()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setError(null)
    const result = await createInventory(name)
    if (!result.success) {
      setError(result.error ?? 'Failed to create inventory')
      return
    }
    setNewName('')
    setCreating(false)
  }

  async function handleArchive() {
    if (selectedInventoryId === null) return
    const current = inventories.find(inv => inv.id === selectedInventoryId)
    if (!current) return
    if (!window.confirm(`Archive "${current.name}"? Its history stays intact but it won't be selectable anymore.`)) {
      return
    }
    setError(null)
    const result = await archiveInventory(selectedInventoryId)
    if (!result.success) setError(result.error ?? 'Failed to archive inventory')
  }

  if (loading) {
    return <span className="text-xs text-gray-400 shrink-0 ml-auto">Loading inventories…</span>
  }

  return (
    <div className="flex items-center gap-2 shrink-0 ml-auto">
      {inventories.length === 0 && !creating && (
        <span className="text-xs text-gray-400">No inventory yet</span>
      )}

      {inventories.length > 0 && !creating && (
        <>
          <select
            value={selectedInventoryId ?? ''}
            onChange={e => selectInventory(Number(e.target.value))}
            className={SELECT_CLS}
          >
            {inventories.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleArchive}
            className="text-xs text-gray-400 hover:text-red-600 transition-colors"
            title="Archive this inventory"
          >
            Archive
          </button>
        </>
      )}

      {creating ? (
        <form onSubmit={handleCreate} className="flex items-center gap-1">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Inventory name"
            className={SELECT_CLS}
          />
          <button type="submit" className="text-xs text-emerald-600 font-semibold">
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setNewName('')
              setError(null)
            }}
            className="text-xs text-gray-400"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
        >
          + New Inventory
        </button>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
