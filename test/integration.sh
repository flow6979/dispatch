#!/usr/bin/env bash
# Dispatch end-to-end integration test (STUB mode — no real repos touched).
# Starts backend + runner, creates a task, polls it through the state machine,
# asserts it reaches PR_OPEN with a prUrl. Cleans up on exit.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
RUNNER_DIR="$ROOT/runner"
BASE="http://localhost:4000"
PIDS=()
cleanup(){ echo "--- cleanup ---"; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT

pass(){ echo "✅ $1"; }
fail(){ echo "❌ $1"; exit 1; }

echo "=== 1. start backend ==="
( cd "$BACKEND_DIR" && node server.js >/tmp/dispatch-backend.log 2>&1 ) &
PIDS+=($!)

echo "=== 2. wait for backend health ==="
for i in $(seq 1 30); do
  if curl -sf "$BASE/api/health" >/dev/null 2>&1; then pass "backend up"; break; fi
  sleep 0.5
  [ "$i" = "30" ] && { cat /tmp/dispatch-backend.log; fail "backend did not start"; }
done

echo "=== 3. start runner (STUB) ==="
( cd "$RUNNER_DIR" && DISPATCH_STUB=1 node runner.js >/tmp/dispatch-runner.log 2>&1 ) &
PIDS+=($!)
sleep 2
H=$(curl -s "$BASE/api/health")
echo "health: $H"
echo "$H" | grep -q '"runners":1' && pass "runner connected" || echo "⚠ runner count not 1 yet (may be timing)"

echo "=== 4. create a task ==="
T=$(curl -s -X POST "$BASE/api/tasks" -H 'content-type: application/json' \
  -d '{"promptText":"Add retry logic to the payment webhook","repo":"acme/payment-service","baseBranch":"main","workBranch":"fix/webhook-retry"}')
echo "created: $T"
TID=$(echo "$T" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$TID" ] && pass "task id = $TID" || fail "no task id returned"

echo "=== 5. poll through state machine (auto-proceed after spec) ==="
LAST=""
for i in $(seq 1 40); do
  TASK=$(curl -s "$BASE/api/tasks/$TID")
  STATE=$(echo "$TASK" | sed -n 's/.*"state":"\([^"]*\)".*/\1/p')
  if [ "$STATE" != "$LAST" ]; then echo "  → state: $STATE"; LAST="$STATE"; fi
  case "$STATE" in
    PR_OPEN|AWAITING_REVIEW) pass "reached $STATE"; echo "$TASK"; \
      echo "$TASK" | grep -q '"prUrl":"http' && pass "prUrl present" || fail "no prUrl"; \
      echo "$TASK" | grep -q '"summary":"' && pass "summary present" || echo "⚠ no summary"; \
      exit 0 ;;
    FAILED|BLOCKED) fail "task ended in $STATE: $TASK" ;;
  esac
  sleep 0.5
done
fail "task did not reach PR_OPEN within timeout (last=$LAST)"
