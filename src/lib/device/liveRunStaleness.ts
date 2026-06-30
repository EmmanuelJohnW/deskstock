// A live_runs row is considered abandoned if it hasn't been touched in this
// long — covers device power loss / WiFi drop mid-run, where no 'complete'
// ping ever arrives to clear the row.
export const LIVE_RUN_STALE_MS = 60_000
