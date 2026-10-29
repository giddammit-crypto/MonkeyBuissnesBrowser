# Restricted-runner Electron fixture

Ordinary CI and desktop smoke runs use the real Electron executable and native
single-instance lock. Do not use this fixture for release acceptance of profile
ownership or multi-process behavior.

Some isolated Linux runners prohibit AF_UNIX sockets. Chromium then aborts in
`requestSingleInstanceLock()` before a window opens. To exercise other UI/IPC
behavior in that environment, explicitly opt into a test-only lock stub:

```sh
npm run check
npm run build
export SOUL_TEST_MOCK_SINGLE_INSTANCE=1
export SOUL_EXECUTABLE="$PWD/scripts/fixtures/electron-restricted-runner.sh"
npm run test:e2e:features
npm run test:e2e:voodoo
npm run test:e2e:smoke
node scripts/renderer-actions-smoke.mjs
```

The wrapper preloads `mock-single-instance.cjs` into the test Electron process.
It replaces only `app.requestSingleInstanceLock` and requires the explicit
environment opt-in. It is not included in the packaged production files and no
production entry point imports it. Every such test report must state that the
native profile lock was mocked. Unit tests verify lock acceptance/rejection and
activation wiring; they do not replace a desktop multi-process test.
