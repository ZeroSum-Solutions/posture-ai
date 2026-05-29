#!/bin/bash
set -e
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  npm install
fi

# Kill any existing dev servers on port 3000
EXISTING_PID=$(lsof -ti :3000 -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$EXISTING_PID" ]; then
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 2
fi

# Remove stale lock file if process is dead
if [ -f ".next/dev/lock" ]; then
  LOCK_PID=$(node -e "try{var l=require('./.next/dev/lock');process.stdout.write(String(l.pid))}catch(e){}" 2>/dev/null)
  if [ -n "$LOCK_PID" ]; then
    kill -0 "$LOCK_PID" 2>/dev/null || rm -f .next/dev/lock
  fi
fi

npm run dev
