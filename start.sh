#!/bin/bash
set -euo pipefail

# Navigate to script directory
cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${GREEN}Starting Invoicing System...${NC}"

# Clean stale PID files
rm -f .flask.pid .tailwind.pid

# Install JS deps if missing
if [ ! -d "node_modules" ]; then
    echo "${YELLOW}Installing npm dependencies...${NC}"
    npm install --quiet
fi

# Build Tailwind CSS once before starting
echo "${YELLOW}Building CSS...${NC}"
npm run build:css --silent

# Check if virtual environment exists, create if not
if [ ! -d "venv" ]; then
    echo "${YELLOW}Creating virtual environment...${NC}"
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install/update requirements
echo "${YELLOW}Installing Python dependencies...${NC}"
pip install -r backend/requirements.txt --quiet

# Set Flask environment variables
export FLASK_APP=backend/app.py
export FLASK_ENV=development

# Initialize database if doesn't exist
if [ ! -f "database/invoices.db" ]; then
    echo "${YELLOW}Initializing database...${NC}"
    python3 -c "from backend.app import create_app; create_app()"
fi

# Start Tailwind watch process in background (keeps CSS updated during session)
echo "${YELLOW}Starting Tailwind CSS watcher...${NC}"
npm run watch:css --silent > /dev/null 2>&1 &
TAILWIND_PID=$!
echo $TAILWIND_PID > .tailwind.pid

# Start Flask server in background
echo "${YELLOW}Starting Flask server...${NC}"
flask run --host=127.0.0.1 --port=5000 > /dev/null 2>&1 &
FLASK_PID=$!
echo $FLASK_PID > .flask.pid

# Wait briefly and verify Flask started
sleep 3
if ! ps -p $FLASK_PID > /dev/null; then
    echo "${RED}Flask server failed to start${NC}"
    kill $TAILWIND_PID 2>/dev/null || true
    rm -f .tailwind.pid .flask.pid
    exit 1
fi

echo "${GREEN}✓ Invoicing System is running!${NC}"
echo "${GREEN}✓ Access it at: http://localhost:5000${NC}"
echo "${YELLOW}Press Ctrl+C to stop${NC}"

# Optional: open browser
sleep 1
open http://localhost:5000 >/dev/null 2>&1 || true

# Handle Ctrl+C
trap "echo '\n${YELLOW}Stopping Invoicing System...${NC}'; kill $FLASK_PID $TAILWIND_PID 2>/dev/null || true; rm -f .flask.pid .tailwind.pid; echo '${GREEN}✓ System stopped${NC}'; exit" INT TERM

# Keep script running
wait $FLASK_PID


