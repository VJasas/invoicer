# Sąskaitininkas

Local invoicing system.

## Features

- 📊 Dashboard with statistics and charts
- 📄 Invoice creation and management (Lithuanian format)
- 👥 Client management
- 💰 Financial tracking
- 📈 Performance analytics
- 🎨 Modern UI with Tailwind CSS

## Requirements

- Python 3.8+
- Node.js 16+
- macOS (tested on macOS 11+)

## First-Time Setup

1. Clone/download this project
2. Open Terminal and navigate to the project folder
3. Make scripts executable:
```bash
   chmod +x start.sh stop.sh
```

## Starting the Application

Simply run:
```bash
./start.sh
```

The application will:
- Install all dependencies (first time only)
- Build the CSS
- Initialize the database (first time only)
- Start the server
- Open your browser automatically

Access at: http://localhost:5000

## Stopping the Application

Press `Ctrl+C` in the terminal where start.sh is running

Or in a new terminal:
```bash
./stop.sh
```

## Manual Development Mode

### Backend only:
```bash
source venv/bin/activate
export FLASK_APP=backend/app.py
flask run
```

### CSS watch mode (for development):
```bash
npm run watch:css
```

## Database Location

`database/invoices.db`

## Backup Instructions

1. Stop the application
2. Copy `database/invoices.db` to a safe location
3. To restore: replace the file and restart

## Troubleshooting

**Port 5000 already in use:**
```bash
lsof -ti:5000 | xargs kill -9
```

**CSS not updating:**
```bash
npm run build:css
```

**Database errors:**
```bash
rm database/invoices.db
python3 -c "from backend.database import init_db; init_db()"
```

**Reset everything:**
```bash
./stop.sh
rm -rf venv node_modules database/invoices.db
./start.sh
```

## Color Palette

- Structural White: `#F4F6F8` - Backgrounds
- Graphite Steel: `#2C3E50` - Text and structure
- Ordinn Red: `#CD1C18` - Primary actions and accents
- Ghost Concrete: `#E0E5EC` - Cards and containers

## Tech Stack

- **Backend:** Python Flask + SQLAlchemy
- **Frontend:** HTML + Tailwind CSS
- **Database:** SQLite
- **PDF Generation:** ReportLab
- **Charts:** Chart.js

## Lithuanian Localization

All UI text is in Lithuanian. Invoice format follows Lithuanian standards.

---

© 2025 Sąskaitininkas
