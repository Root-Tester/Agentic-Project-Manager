
#!/usr/bin/env bash

set -uo pipefail

echo "========================================"
echo "   Agentic Project Manager Deployment"
echo "========================================"

# Render's assigned public frontend port
export PORT="${PORT:-10000}"

# Backend configuration
export HOST="127.0.0.1"
export API_PROXY_TARGET="http://127.0.0.1:4000"

# Start backend privately
echo "[1/2] Starting backend on 127.0.0.1:4000..."

PORT=4000 HOST=127.0.0.1 npm run dev &
BACKEND_PID=$!

# Start frontend publicly
echo "[2/2] Starting frontend on 0.0.0.0:${PORT}..."

npm run start:web &
FRONTEND_PID=$!

cleanup() {
    echo "Shutting down application services..."

    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true

    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM

# Monitor both services
if wait -n "$BACKEND_PID" "$FRONTEND_PID"; then
    STATUS=0
else
    STATUS=$?
fi

echo "One of the application services has stopped."

cleanup
exit "$STATUS"
