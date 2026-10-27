#!/bin/bash
# soulm8te intelligent Linux launcher wrapper
# Enables out-of-the-box execution on Astra Linux, Debian, Ubuntu, and RedOS
# without requiring manual chmod, chown, or sandbox reconfiguration.

set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
CHROME_SANDBOX="${SCRIPT_DIR}/chrome-sandbox"

if [ -f "${SCRIPT_DIR}/soulm8te-bin" ]; then
  SOULM8TE_BIN="${SCRIPT_DIR}/soulm8te-bin"
else
  SOULM8TE_BIN="${SCRIPT_DIR}/soulm8te"
fi

EXTRA_ARGS=()

# 1. SUID Sandbox validation
SUID_FUNCTIONAL=0
if [ -f "$CHROME_SANDBOX" ]; then
  OWNER_UID=$(stat -c "%u" "$CHROME_SANDBOX" 2>/dev/null || echo "1")
  MODE_OCTAL=$(stat -c "%a" "$CHROME_SANDBOX" 2>/dev/null || echo "0")
  if [ "$OWNER_UID" = "0" ] && [ "$MODE_OCTAL" = "4755" ]; then
    SUID_FUNCTIONAL=1
  fi
fi

# 2. Unprivileged user namespaces validation
USERNS_FUNCTIONAL=0
if [ -L /proc/self/ns/user ]; then
  if unshare --user true 2>/dev/null; then
    USERNS_FUNCTIONAL=1
  fi
fi

# 3. Transparent fallback: if neither user namespaces nor SUID sandbox is available,
# inject --no-sandbox so the browser launches seamlessly.
if [ "$SUID_FUNCTIONAL" -eq 0 ] && [ "$USERNS_FUNCTIONAL" -eq 0 ]; then
  EXTRA_ARGS+=("--no-sandbox")
fi

# 4. Wayland / X11 Ozone auto-detection hint
EXTRA_ARGS+=("--ozone-platform-hint=auto")

exec "$SOULM8TE_BIN" "${EXTRA_ARGS[@]}" "$@"
