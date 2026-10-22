import { describe, expect, test } from 'vitest'
import { isNetworkError } from './network'

describe('isNetworkError', () => {
  test('a thrown fetch TypeError is a network error', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
  })

  test.each(['TypeError: Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])(
    'supabase-style error "%s" is a network error',
    message => {
      expect(isNetworkError({ message })).toBe(true)
    },
  )

  test('a server error is not a network error', () => {
    expect(isNetworkError({ message: 'insufficient_stock' })).toBe(false)
    expect(isNetworkError(new Error('boom'))).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})
