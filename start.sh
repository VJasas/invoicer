#!/bin/bash

# Navigate to script directory
cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${GREEN}Starting Invoicing System...${NC}"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "${YELLOW}Installing npm dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo "${RED}Failed to install npm dependencies${NC}"
        exit 1
    fi
fi

# Build Tailwind CSS
echo "${YELLOW}Building CSS...${NC}"
npm run build:css
if [ $? -ne 0 ]; then
    echo "${RED}Failed to build CSS${NC}"
    exit 1
fi

# Check if virtual environment exists, create if not
if [ ! -d "venv" ]; then
    echo "${YELLOW}Creating virtual environment...${NC}"
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "${RED}Failed to create virtual environment${NC}"
        exit 1
    fi
fi

# Activate virtual environment
source venv/bin/activate

# Install/update requirements
echo "${YELLOW}Installing Python dependencies...${NC}"
pip install -r backend/requirements.txt --quiet
if [ $? -ne 0 ]; then
    echo "${RED}Failed to install Python dependencies${NC}"
    exit 1
fi

# Set Flask environment variables
export FLASK_APP=backend/app.py
export FLASK_ENV=development

# Initialize database if doesn't exist
if [ ! -f "database/invoices.db" ]; then
    echo "${YELLOW}Initializing database...${NC}"
    # Use the Flask factory so init_db gets the app instance
    python3 -c "from backend.app import create_app; create_app()"
    if [ $? -ne 0 ]; then
        echo "${RED}Failed to initialize database${NC}"
        exit 1
    fi
fi

# Start Tailwind watch process in background
echo "${YELLOW}Starting Tailwind CSS watcher...${NC}"
npm run watch:css > /dev/null 2>&1 &
TAILWIND_PID=$!
echo $TAILWIND_PID > .tailwind.pid

# Start Flask server in background
echo "${YELLOW}Starting Flask server...${NC}"
flask run --host=127.0.0.1 --port=5000 > /dev/null 2>&1 &
# Store PID
FLASK_PID=$!
echo $FLASK_PID > .flask.pid

# Wait for server to start
sleep 3

# Check if Flask is running
if ! ps -p $FLASK_PID > /dev/null; then
    echo "${RED}Flask server failed to start${NC}"
    kill $TAILWIND_PID 2>/dev/null
    rm .tailwind.pid .flask.pid 2>/dev/null
    exit 1
fi

echo "${GREEN}✓ Invoicing System is running!${NC}"
echo "${GREEN}✓ Access it at: http://localhost:5000${NC}"
echo "${YELLOW}Press Ctrl+C to stop${NC}"

# Open browser
sleep 1
open http://localhost:5000

# Wait for Ctrl+C
trap "echo '\n${YELLOW}Stopping Invoicing System...${NC}'; kill $FLASK_PID $TAILWIND_PID 2>/dev/null; rm .flask.pid .tailwind.pid 2>/dev/null; echo '${GREEN}✓ System stopped${NC}'; exit" INT TERM

# Keep script running
wait $FLASK_PID


