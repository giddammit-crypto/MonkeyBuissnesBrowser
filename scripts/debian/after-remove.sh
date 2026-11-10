#!/bin/bash
set -e

case "${1:-remove}" in
    remove|purge)
        case "$(readlink '/usr/bin/soulm8te' 2>/dev/null || true)" in
            /opt/soulm8te/soulm8te|/opt/soulm8te/soulm8te-launcher.sh)
                rm -f '/usr/bin/soulm8te'
                ;;
        esac
        rm -f '/opt/soulm8te/soulm8te-bin'
        rmdir '/opt/soulm8te' 2>/dev/null || true
        ;;
    *) exit 0 ;;
esac

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -q -t /usr/share/icons/hicolor 2>/dev/null || true
fi
