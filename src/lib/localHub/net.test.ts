import { describe, expect, test } from 'vitest'
import { isLocalRequest } from './net'

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
