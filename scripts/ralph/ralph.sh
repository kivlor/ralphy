#!/bin/bash
set -e

MAX_ITERATIONS=${2:-10}

SCRIPT_DIR="$(cd "$(dirname \
  "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Ralph"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo "Iteration $i"

  OUTPUT=$(cat "scripts/ralph/prompt.md" \
    | codex exec --dangerously-bypass-approvals-and-sandbox 2>&1 \
    | tee /dev/stderr) || true

  if echo "$OUTPUT" | \
    tail -n 10 | \
    grep -q "<promise>COMPLETE</promise>"
  then
    echo "Done!"
    exit 0
  fi

  sleep 2
done

echo "Max iterations reached"
exit 1
