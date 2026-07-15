#!/bin/bash
# LiveStreak E2E — the keynote loop as one batch script, step by step:
#   1. boot the whole protocol via dev.sh (owns anvil/host/app/role consoles)
#   2. wait for the observer role console session
#   3. drive the full loop through the REAL remote relay (`remote drive`):
#      observe configure+register → bookmaker createVault → options configure+mint+fund
#      → steward configure+resolve — every step asserted
#   4. tear the stack down (unless KEEP_UP=1)
#
# Lean CI shape: `WITH_SUI=0 ./scripts/e2e.sh` (EVM only). bash 3.2 compatible.
set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROLES_DIR="/tmp/livestreak-roles"
DEV_LOG="/tmp/livestreak-e2e-dev.log"
DRIVE_LOG="/tmp/livestreak-e2e-drive.log"
KEEP_UP="${KEEP_UP:-0}"
WITH_SUI="${WITH_SUI:-0}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-240}"

G='\033[0;32m'; R='\033[0;31m'; N='\033[0m'
step() { echo -e "${G}[e2e]${N} $1"; }
fail() { echo -e "${R}[e2e] FAIL${N} $1"; exit 1; }

DEV_PID=""
teardown() {
  if [ "$KEEP_UP" = "1" ]; then
    step "KEEP_UP=1 — leaving the stack running (dev.sh PID $DEV_PID)"
    return
  fi
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    step "Tearing down (SIGINT dev.sh $DEV_PID — its trap stops the children)"
    kill -INT "$DEV_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$DEV_PID" 2>/dev/null || break; sleep 1; done
    kill -0 "$DEV_PID" 2>/dev/null && kill -TERM "$DEV_PID" 2>/dev/null || true
  fi
}
trap teardown EXIT

# --- 1. boot ---
step "Booting the protocol (dev.sh, WITH_SUI=$WITH_SUI) — log: $DEV_LOG"
( cd "$ROOT" && WITH_SUI="$WITH_SUI" ./dev.sh ) > "$DEV_LOG" 2>&1 &
DEV_PID=$!

# --- 2. wait for the observer console session ---
step "Waiting for the observer role console (up to ${BOOT_TIMEOUT}s)..."
URL_FILE="$ROLES_DIR/observe/url"
ready=0
for _ in $(seq 1 "$BOOT_TIMEOUT"); do
  if [ -s "$URL_FILE" ] && grep -q "/remote/" "$URL_FILE" 2>/dev/null; then ready=1; break; fi
  kill -0 "$DEV_PID" 2>/dev/null || fail "dev.sh exited during boot — see $DEV_LOG"
  sleep 1
done
[ "$ready" = 1 ] || fail "observer console never came up — see $DEV_LOG and $ROLES_DIR/observe/console.log"

SESSION="$(sed 's|.*/remote/||' "$URL_FILE" | tr -d '[:space:]')"
[ -n "$SESSION" ] || fail "could not parse session id from $URL_FILE"
step "Observer session: $SESSION"

# --- 3. drive the keynote loop over the real relay ---
step "Driving: observe configure+register → createVault → mint+fund → resolve..."
set +e
( cd "$ROOT/cli" && npm run dev -- remote drive \
    --session "$SESSION" \
    --pair-password "demo-pass-observe" \
    --resolve-outcome yes ) > "$DRIVE_LOG" 2>&1
DRIVE_EXIT=$?
set -e

echo "--- drive output ---"
grep -E "remote drive complete|marketId|=ok|=fail|Error" "$DRIVE_LOG" | tail -12 || true
echo "--------------------"

# --- 4. assert ---
[ "$DRIVE_EXIT" = 0 ] || fail "remote drive exited $DRIVE_EXIT — see $DRIVE_LOG"
grep -q "remote drive complete" "$DRIVE_LOG" || fail "no completion line — see $DRIVE_LOG"
grep -q "=fail" "$DRIVE_LOG" && fail "a drive step failed — see $DRIVE_LOG"

SUMMARY="$(grep "remote drive complete" "$DRIVE_LOG" | tail -1)"
step "PASS — $SUMMARY"
