import { beforeEach, describe, expect, test, vi } from 'vitest'

// A tiny stand-in for the Supabase query builder: every chained call returns
// the same builder, and awaiting it yields the rows configured for the table.
type Rows = Record<string, unknown[]>
let tables: Rows = {}
let failTable: string | null = null
let rangeCalls: [number, number][] = []

function builder(table: string) {
  let range: [number, number] | null = null
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    range: (from: number, to: number) => {
      range = [from, to]
      rangeCalls.push(range)
      return chain
    },
    then: (resolve: (v: unknown) => void) => {
      if (failTable === table) return resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } })
      const rows = tables[table] ?? []
      resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null })
    },
  }
  return chain
}

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => builder(table),
    rpc: () => builder('get_inventory'),
  }),
}))

const { fetchSnapshot } = await import('./snapshot')

beforeEach(() => {
  failTable = null
  rangeCalls = []
  tables = {
    components: [{ id: 1, name: 'Button', weight_g: 1.2, created_at: 'x' }],
    borrows: [],
    inventory_ledger: [],
    get_inventory: [{ component: 'Button', qty: '50' }],
    reconciliations: [],
    count_sessions: [],
  }
})

describe('fetchSnapshot', () => {
  test('collects every table and converts stock to numbers', async () => {
    const snap = await fetchSnapshot(3)

    expect(snap.inventoryId).toBe(3)
    expect(snap.components).toHaveLength(1)
    expect(snap.stock).toEqual([{ component: 'Button', qty: 50 }])
    expect(Date.parse(snap.fetchedAt)).not.toBeNaN()
  })

  test('pages through a long ledger', async () => {
    tables.inventory_ledger = Array.from({ length: 2500 }, (_, i) => ({ id: i, delta: 1 }))

    const snap = await fetchSnapshot(3)

    expect(snap.ledger).toHaveLength(2500)
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  test('passes on a failed request so the caller can tell it was offline', async () => {
    failTable = 'borrows'

    await expect(fetchSnapshot(3)).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
  })
})
