import { describe, expect, test } from 'vitest'
import { hubFetch, isLocalRequest } from './net'

describe('isLocalRequest', () => {
  test.each(['localhost:3000', 'localhost', '127.0.0.1:3000', '[::1]:3000'])('%s is the laptop itself', host => {
    expect(isLocalRequest(host)).toBe(true)
  })

  test.each(['172.20.10.12:3000', 'deskstock.vercel.app', 'localhost.evil.com', null])(
    '%s is not the laptop itself',
    host => {
      expect(isLocalRequest(host)).toBe(false)
    },
  )
})

describe('hubFetch', () => {
  test('answers at once with an offline error (never throws, so nothing retries) when switched offline', async () => {
    process.env.HUB_FORCE_OFFLINE = 'true'
    try {
      const started = Date.now()

      const res = await hubFetch('https://example.invalid/rest/v1/components')

      expect(Date.now() - started).toBeLessThan(50)
      expect(res.status).toBe(504)
      expect(((await res.json()) as { message: string }).message).toMatch(/fetch failed/)
    } finally {
      delete process.env.HUB_FORCE_OFFLINE
    }
  })
})
