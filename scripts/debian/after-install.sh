#!/bin/bash
set -e

# Unconditionally configure SUID sandbox permissions for Chromium/Electron
if [ -f '/opt/soulm8te/chrome-sandbox' ]; then
    chown root:root '/opt/soulm8te/chrome-sandbox' 2>/dev/null || true
    chmod 4755 '/opt/soulm8te/chrome-sandbox' 2>/dev/null || true
fi

# dpkg owns the application executable. Remove only the legacy copy created
# by earlier maintainer scripts and keep the installed executable in place.
rm -f '/opt/soulm8te/soulm8te-bin'
chmod 0755 '/opt/soulm8te/soulm8te-launcher.sh'
case "$(readlink '/usr/bin/soulm8te' 2>/dev/null || true)" in
    /opt/soulm8te/soulm8te|/opt/soulm8te/soulm8te-launcher.sh)
        ln -sfn '/opt/soulm8te/soulm8te-launcher.sh' '/usr/bin/soulm8te'
        ;;
    *)
        if [ ! -e '/usr/bin/soulm8te' ] && [ ! -L '/usr/bin/soulm8te' ]; then
            ln -s '/opt/soulm8te/soulm8te-launcher.sh' '/usr/bin/soulm8te'
        fi
        ;;
esac

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
