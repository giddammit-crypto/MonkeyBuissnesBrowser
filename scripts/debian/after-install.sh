#!/bin/bash
set -e

# Unconditionally configure SUID sandbox permissions for Chromium/Electron
if [ -f '/opt/soulm8te/chrome-sandbox' ]; then
    chown root:root '/opt/soulm8te/chrome-sandbox' 2>/dev/null || true
    chmod 4755 '/opt/soulm8te/chrome-sandbox' 2>/dev/null || true
fi

# Set up smart launcher wrapper
if [ -f '/opt/soulm8te/soulm8te' ] && [ -f '/opt/soulm8te/soulm8te-launcher.sh' ]; then
    if [ ! -f '/opt/soulm8te/soulm8te-bin' ]; then
        mv '/opt/soulm8te/soulm8te' '/opt/soulm8te/soulm8te-bin'
        cp '/opt/soulm8te/soulm8te-launcher.sh' '/opt/soulm8te/soulm8te'
    fi
fi

# Ensure executable permissions for binaries and wrapper
chmod 0755 '/opt/soulm8te/soulm8te' 2>/dev/null || true
if [ -f '/opt/soulm8te/soulm8te-bin' ]; then
    chmod 0755 '/opt/soulm8te/soulm8te-bin' 2>/dev/null || true
fi
if [ -f '/opt/soulm8te/soulm8te-launcher.sh' ]; then
    chmod 0755 '/opt/soulm8te/soulm8te-launcher.sh' 2>/dev/null || true
fi

# Ensure /usr/bin/soulm8te exists and points to /opt/soulm8te/soulm8te
ln -sf '/opt/soulm8te/soulm8te' '/usr/bin/soulm8te' 2>/dev/null || true

# Update desktop and MIME databases
if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -q -t /usr/share/icons/hicolor 2>/dev/null || true
fi
