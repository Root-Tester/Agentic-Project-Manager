
#!/usr/bin/env bash

echo "=================================="
echo " Starting Application Services"
echo "=================================="

# Start both services concurrently
npm run dev &
DEV_PID=$!

npm run start:web &
WEB_PID=$!

# Stop both services if either one exits
cleanup() {
    echo "Shutting down application services..."
    kill "$DEV_PID" "$WEB_PID" 2>/dev/null || true
    wait 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

# Monitor both processes
wait -n "$DEV_PID" "$WEB_PID"
