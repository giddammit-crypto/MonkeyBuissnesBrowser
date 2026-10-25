import { ipcRenderer } from 'electron';

// No bridge is exposed to websites. A dirty form conservatively prevents discarding
// unsaved input; a completed main-frame navigation resets this in the controller.
let dirty = false;
window.addEventListener('input', (event) => {
  if (!event.isTrusted || dirty) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
    dirty = true;
    ipcRenderer.send('page:form-state', true);
  }
}, true);
// Submitting a form does not guarantee data was saved (SPA handlers may cancel
// navigation or receive a server error). Keep the guard until document navigation.
