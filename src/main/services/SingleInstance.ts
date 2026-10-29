/** Own the profile before creating stores or Chromium sessions. */
export function registerSingleInstance(
  application: Pick<Electron.App, 'requestSingleInstanceLock' | 'quit' | 'on'>,
  activate: () => Promise<void>,
): boolean {
  if (!application.requestSingleInstanceLock()) {
    application.quit();
    return false;
  }
  application.on('second-instance', () => {
    void activate().catch((error) => console.error('Unable to activate existing browser:', error));
  });
  return true;
}
