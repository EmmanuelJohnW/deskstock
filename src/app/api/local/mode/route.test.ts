import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { GET, POST } from './route'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'deskstock-mode-'))
  process.env.LOCAL_HUB_DIR = dir
  process.env.NEXT_PUBLIC_LOCAL_HUB = 'true'
})

afterEach(async () => {
  delete process.env.LOCAL_HUB_DIR
  delete process.env.NEXT_PUBLIC_LOCAL_HUB
  await rm(dir, { recursive: true, force: true })
})

function request(method: 'GET' | 'POST', headers: Record<string, string> = {}, body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/local/mode', {
    method,
    headers: { host: 'localhost:3000', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const json = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000' }

describe('/api/local/mode', () => {
  test('switches the laptop offline and back', async () => {
    expect(await (await GET(request('GET'))).json()).toEqual({ offline: false })

    const on = await POST(request('POST', json, { offline: true }))
    expect(await on.json()).toEqual({ offline: true })
    expect(await (await GET(request('GET'))).json()).toEqual({ offline: true })

    const off = await POST(request('POST', json, { offline: false }))
    expect(await off.json()).toEqual({ offline: false })
  })

  test('is not available outside the laptop hub', async () => {
    delete process.env.NEXT_PUBLIC_LOCAL_HUB

    expect((await GET(request('GET'))).status).toBe(404)
  })

  test('refuses other devices on the hotspot', async () => {
    const res = await POST(request('POST', { ...json, host: '172.20.10.12:3000' }, { offline: true }))

    expect(res.status).toBe(403)
  })

  test('refuses requests from another website', async () => {
    const crossSite = await POST(request('POST', { ...json, 'sec-fetch-site': 'cross-site' }, { offline: true }))
    const otherOrigin = await POST(request('POST', { ...json, origin: 'https://evil.example' }, { offline: true }))
    const notJson = await POST(request('POST', { ...json, 'content-type': 'text/plain' }, { offline: true }))

    expect([crossSite.status, otherOrigin.status, notJson.status]).toEqual([403, 403, 403])
    expect(await (await GET(request('GET'))).json()).toEqual({ offline: false })
  })

  test('rejects a malformed body', async () => {
    expect((await POST(request('POST', json, { offline: 'yes' }))).status).toBe(422)
  })
})
