#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${YELLOW}Stopping Invoicing System...${NC}"
STOPPED=0

stop_pid_file() {
  local file=$1
  local name=$2
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file")
    if ps -p "$pid" > /dev/null 2>&1; then
      kill "$pid" 2>/dev/null || true
      echo "${GREEN}✓ $name stopped${NC}"
      STOPPED=1
    fi
    rm -f "$file"
  fi
}

stop_pid_file ".flask.pid" "Flask server"
stop_pid_file ".tailwind.pid" "Tailwind watcher"

if [ $STOPPED -eq 0 ]; then
  echo "${YELLOW}No running instance found${NC}"
else
  echo "${GREEN}✓ Invoicing System stopped successfully${NC}"
fi
