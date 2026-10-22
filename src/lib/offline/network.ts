// Recognises "couldn't reach the server" failures, as opposed to the server
// answering with an error. supabase-js doesn't throw on these: it returns
// { error } with the browser's fetch message, which differs per browser.

const NETWORK_MESSAGE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    return typeof message === 'string' && NETWORK_MESSAGE.test(message)
  }
  return false
}

/** localStorage switch to simulate being offline (for testing the offline mode). */
export const FORCE_OFFLINE_KEY = 'deskstock.forceOffline'

export function isForcedOffline(): boolean {
  try {
    return window.localStorage.getItem(FORCE_OFFLINE_KEY) === 'true'
  } catch {
    return false
  }
}
