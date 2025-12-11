#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${YELLOW}Stopping Invoicing System...${NC}"
STOPPED=0

# Kill Flask
if [ -f .flask.pid ]; then
    FLASK_PID=$(cat .flask.pid)
    if ps -p $FLASK_PID > /dev/null 2>&1; then
        kill $FLASK_PID
        echo "${GREEN}✓ Flask server stopped${NC}"
        STOPPED=1
    fi
    rm .flask.pid
fi

# Kill Tailwind
if [ -f .tailwind.pid ]; then
    TAILWIND_PID=$(cat .tailwind.pid)
    if ps -p $TAILWIND_PID > /dev/null 2>&1; then
        kill $TAILWIND_PID
        echo "${GREEN}✓ Tailwind watcher stopped${NC}"
        STOPPED=1
    fi
    rm .tailwind.pid
fi

if [ $STOPPED -eq 0 ]; then
    echo "${YELLOW}No running instance found${NC}"
else
    echo "${GREEN}✓ Invoicing System stopped successfully${NC}"
fi

