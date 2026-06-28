#!/usr/bin/env bash
#
# test-ingest.sh — simulate a full ESP32 sort run against /api/ingest
#
# Usage:
#   1. Edit URL and TOKEN below (or pass as env vars).
#   2. chmod +x test-ingest.sh
#   3. Open your deployed dashboard in a browser, then run: ./test-ingest.sh
#
# Watch the bins animate live as the running ticks POST, then persist + clear
# when the complete tick fires.

set -euo pipefail

# ── config ────────────────────────────────────────────────────────────────────
URL="${INGEST_URL:-https://deskstock.vercel.app/api/ingest}"
TOKEN="${INGEST_TOKEN:-b684f4dce72fa261ee925445d3429190421c1215d5de7deaa3f5ccfad73f576f}"
RUN_ID="test-$(date +%s)"      # unique each run so it persists, not skipped
TICK_DELAY=1                   # seconds between running ticks (matches ~1Hz device)

# 7 bins; last one (idx 6) is the reject. counts grow each tick.
COMPONENTS=("10kΩ" "100nF" "LED Red" "ATtiny85" "1N4148" "10µH" "HC-SR04")

post() {
  curl -s -o /dev/null -w "  → HTTP %{http_code}\n" \
    -X POST "$URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$1"
}

# build the bins JSON array for a given multiplier (counts = step * per-bin rate)
build_bins() {
  local step=$1
  local arr="["
  local rates=(5 5 5 5 5 5 2)   # reject accrues slower
  for i in "${!COMPONENTS[@]}"; do
    local count=$(( step * rates[i] ))
    [ "$i" -gt 0 ] && arr+=","
    arr+="{\"idx\":$i,\"component\":\"${COMPONENTS[$i]}\",\"count\":$count}"
  done
  arr+="]"
  echo "$arr"
}

echo "Run ID: $RUN_ID"
echo "Target: $URL"
echo "Open your dashboard now. Starting in 2s..."
sleep 2

# ── running ticks (6 ticks, counts climbing) ─────────────────────────────────
TOTAL_STEPS=6
for step in $(seq 1 $TOTAL_STEPS); do
  elapsed=$(( step * 1000 ))
  remaining=$(( (TOTAL_STEPS - step) * 1000 ))
  bins=$(build_bins "$step")
  echo "Tick $step/$TOTAL_STEPS (elapsed ${elapsed}ms)"
  post "{\"run_id\":\"$RUN_ID\",\"status\":\"running\",\"profile\":\"Mixed Components\",\"elapsed_ms\":$elapsed,\"est_remaining_ms\":$remaining,\"bins\":$bins}"
  sleep "$TICK_DELAY"
done

# ── complete tick (final counts, total must equal bin sum) ────────────────────
final_bins=$(build_bins "$TOTAL_STEPS")
# total = sum of all bin counts: 6 bins * (6*5) + 1 reject * (6*2) = 180 + 12 = 192
total=$(( 6 * (TOTAL_STEPS * 5) + (TOTAL_STEPS * 2) ))
duration=$(( TOTAL_STEPS * 1000 ))
started="$(date -u -v-${duration}S +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Complete (total=$total)"
post "{\"run_id\":\"$RUN_ID\",\"status\":\"complete\",\"profile\":\"Mixed Components\",\"total\":$total,\"duration_ms\":$duration,\"started_at\":\"$started\",\"bins\":$final_bins}"

echo
echo "Done. The dashboard should show the completed ring, and the run should now"
echo "exist in your runs/bins tables with inventory incremented (reject excluded)."
