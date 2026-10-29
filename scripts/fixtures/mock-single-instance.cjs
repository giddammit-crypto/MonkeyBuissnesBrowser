// TEST ONLY: restricted Linux runners may prohibit the Unix socket used by
// Chromium's process singleton. This fixture does not test profile locking.
// Production entry points never import this file.
if (process.env.SOUL_TEST_MOCK_SINGLE_INSTANCE !== '1') {
  throw new Error('Singleton test fixture requires SOUL_TEST_MOCK_SINGLE_INSTANCE=1');
}
const { app } = require('electron');
app.requestSingleInstanceLock = () => true;
console.error('TEST FIXTURE: native single-instance lock mocked; multi-process locking is NOT covered');
