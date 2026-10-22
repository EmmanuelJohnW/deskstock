#!/usr/bin/env bash
#
# test-ingest.sh — simulate a full ESP32 sort run against the live API
#
# Mirrors what the device does:
#   1. GET  /api/run-config  → component table for the active inventory
#                              (auto-opens a count session if none is open)
#   2. POST /api/ingest      → status:"running" ticks with cumulative bin counts
#   3. POST /api/ingest      → status:"complete" (persists the run, then
#                              auto-reconciles and closes the session)
#
# Bin shape (see CompleteRunBinSchema in src/lib/ingest/completeRun.ts):
#   {name, weight_g, bin, count} — bin 0 is the reject chute ("Unknown").
#
# Usage:
#   INGEST_TOKEN=... ./test-ingest.sh
#   INGEST_URL=http://localhost:3000 INGEST_TOKEN=... ./test-ingest.sh
#   FAKE_NO_NTP=1 ...            # device clock not set (offline hotspot)
#
# NOTE: this writes real data. Completed counts replace stock levels for the
# active inventory — point the dashboard at a test inventory first.

set -euo pipefail

BASE_URL="${INGEST_URL:-https://deskstock.vercel.app}"
TOKEN="${INGEST_TOKEN:?Set INGEST_TOKEN (copy it from Vercel environment variables)}"
RUN_ID="test-$(date +%s)"   # unique each run so it persists, not skipped as a duplicate
TICKS=3                     # running ticks before complete
PER_TICK=2                  # items added to each bin per tick
TICK_DELAY=2                # seconds between ticks
MAX_COMPONENT_BINS=5        # bins 1..5; bin 0 is the reject chute
REJECT_WEIGHT_G=1           # server requires weight_g > 0; unused for the reject chute

echo "Target: $BASE_URL"
echo "Run ID: $RUN_ID"

# ── 1. run-config ─────────────────────────────────────────────────────────────
config=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/run-config")
config_status=${config##*$'\n'}
config_body=${config%$'\n'*}
if [ "$config_status" != "200" ]; then
  echo "run-config failed (HTTP $config_status): $config_body" >&2
  exit 1
fi

# Build bins_json() from the component table: reject chute + up to 5 components.
components=$(python3 -c '
import json, sys
rows = json.loads(sys.argv[1])
max_bins = int(sys.argv[2])
for i, r in enumerate(rows[:max_bins], start=1):
    print("%d\t%s\t%s" % (i, r["weight_g"], r["name"]))
' "$config_body" "$MAX_COMPONENT_BINS")

if [ -z "$components" ]; then
  echo "Active inventory has no registered components — add some on /components first." >&2
  exit 1
fi
echo "Components:"
echo "$components" | sed 's/^/  bin /'

bins_json() {
  python3 -c '
import json, sys
count = int(sys.argv[1])
bins = [{"name": "Unknown", "weight_g": float(sys.argv[2]), "bin": 0, "count": count // 2}]
for line in sys.argv[3].splitlines():
    idx, weight, name = line.split("\t", 2)
    bins.append({"name": name, "weight_g": float(weight), "bin": int(idx), "count": count})
print(json.dumps(bins))
' "$1" "$REJECT_WEIGHT_G" "$components"
}

post() {
  curl -sS -o /dev/null -w "  → HTTP %{http_code}\n" -X POST "$BASE_URL/api/ingest" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1"
}

# ── 2. running ticks ──────────────────────────────────────────────────────────
for step in $(seq 1 "$TICKS"); do
  echo "Tick $step/$TICKS"
  post "{\"run_id\":\"$RUN_ID\",\"status\":\"running\",\"elapsed_ms\":$((step * TICK_DELAY * 1000)),\"est_remaining_ms\":$(((TICKS - step) * TICK_DELAY * 1000)),\"bins\":$(bins_json $((step * PER_TICK)))}"
  sleep "$TICK_DELAY"
done

# ── 3. complete ───────────────────────────────────────────────────────────────
duration_s=$((TICKS * TICK_DELAY))
started_at=$(date -u -v-"${duration_s}"S +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -d "-${duration_s} seconds" +%Y-%m-%dT%H:%M:%SZ)
# FAKE_NO_NTP=1 mimics the device on a hotspot with no internet: its clock was
# never set, so it reports a 1970 start time (the laptop hub corrects it).
if [ "${FAKE_NO_NTP:-}" = "1" ]; then started_at="1970-01-01T00:00:12Z"; fi
echo "Complete"
post "{\"run_id\":\"$RUN_ID\",\"status\":\"complete\",\"duration_ms\":$((duration_s * 1000)),\"started_at\":\"$started_at\",\"bins\":$(bins_json $((TICKS * PER_TICK)))}"

echo
echo "Done. Each component bin should now read $((TICKS * PER_TICK)) in the active inventory"
echo "(reject chute excluded), and the count session should be closed."
