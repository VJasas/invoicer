#!/bin/bash

# Create .app bundle structure
mkdir -p "Invoicing System.app/Contents/MacOS"
mkdir -p "Invoicing System.app/Contents/Resources"

# Create launch script
cat > "Invoicing System.app/Contents/MacOS/launch" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/../../.."
./start.sh
EOF

chmod +x "Invoicing System.app/Contents/MacOS/launch"

# Create Info.plist
cat > "Invoicing System.app/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launch</string>
    <key>CFBundleName</key>
    <string>Invoicing System</string>
    <key>CFBundleIdentifier</key>
    <string>com.valdas.invoicing</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
</dict>
</plist>
EOF

echo "✓ App bundle created: Invoicing System.app"
echo "Double-click to launch!"

