/** Bind an asynchronous permission decision to the document that requested it. */
export function permissionRequestGuard(contents: Electron.WebContents, requestingUrl: string, isMainFrame = true) {
  let valid = true;
  const topUrl = contents.getURL();
  let frame: Electron.WebFrameMain | undefined;
  let frameUrl: string | undefined;
  try {
    if (isMainFrame) frame = contents.mainFrame;
    else {
      const candidates = contents.mainFrame.framesInSubtree.filter(candidate => candidate !== contents.mainFrame && candidate.url === requestingUrl);
      if (candidates.length === 1) frame = candidates[0];
      else valid = false;
    }
    frameUrl = frame?.url;
    if (frame && new URL(frame.url).origin !== new URL(requestingUrl).origin) valid = false;
  } catch { valid = false; }
  const invalidate = () => { valid = false; };
  const onNavigation = (_event: unknown, _url: string, inPlace: boolean, main: boolean, processId?: number, routingId?: number) => {
    if (inPlace) return;
    try { if (main || frame && processId === frame.processId && routingId === frame.routingId) invalidate(); }
    catch { invalidate(); }
  };
  contents.on?.('did-start-navigation', onNavigation);
  contents.on?.('render-process-gone', invalidate);
  contents.on?.('destroyed', invalidate);
  return {
    current(): boolean {
      try { return valid && !contents.isDestroyed() && contents.getURL() === topUrl && (!frame || !frame.detached && frame.url === frameUrl); }
      catch { return false; }
    },
    dispose(): void {
      contents.removeListener?.('did-start-navigation', onNavigation);
      contents.removeListener?.('render-process-gone', invalidate);
      contents.removeListener?.('destroyed', invalidate);
    },
  };
}
