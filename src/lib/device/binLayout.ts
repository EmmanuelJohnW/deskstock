// Fixed by firmware: bin 0 is the reject/unknown chute, bins 1..BIN_COUNT-1
// are known components. Not configurable — do not derive this dynamically
// (e.g. "highest idx wins"); both server and dashboard must agree on this
// constant.
export const BIN_COUNT = 6
export const REJECT_BIN_IDX = 0
