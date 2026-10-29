#!/bin/sh
# Opt-in test executable for Linux runners prohibiting AF_UNIX sockets.
# Usage (after npm run build):
# SOUL_TEST_MOCK_SINGLE_INSTANCE=1 SOUL_EXECUTABLE="$PWD/scripts/fixtures/electron-restricted-runner.sh" npm run test:e2e:smoke
set -eu
if [ "${SOUL_TEST_MOCK_SINGLE_INSTANCE:-}" != "1" ]; then
  echo 'This test runner requires SOUL_TEST_MOCK_SINGLE_INSTANCE=1' >&2
  exit 1
fi
fixture_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$fixture_dir/../../node_modules/electron/dist/electron" -r "$fixture_dir/mock-single-instance.cjs" "$@"
