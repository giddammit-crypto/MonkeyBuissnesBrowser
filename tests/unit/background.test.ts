import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeNewTabBackground } from '../../src/shared/background';
import { BrowserStores } from '../../src/main/persistence/BrowserStores';

const roots: string[] = [];
const root = () => { const directory=fs.mkdtempSync(path.join(os.tmpdir(),'soul-background-'));roots.push(directory);return directory; };
afterEach(()=>{for(const directory of roots.splice(0))fs.rmSync(directory,{recursive:true,force:true});});

describe('local new-tab background choices', () => {
  it('uses portrait by default and migrates legacy background names', () => {
    expect(new BrowserStores(root()).settings.get().newTabBackground).toBe('portrait');
    for(const legacy of ['mountain-lake','monkey-business-los-angeles','monkey','portrait',undefined,null]) {
      const directory=root();fs.mkdirSync(path.join(directory,'browser-data'));
      fs.writeFileSync(path.join(directory,'browser-data/settings.json'),JSON.stringify({newTabBackground:legacy}));
      expect(new BrowserStores(directory).settings.get().newTabBackground).toBe('portrait');
    }
  });
  it('preserves an explicit plain choice when saving unrelated settings and restarting', () => {
    const directory=root();const stores=new BrowserStores(directory);
    stores.settings.set({...stores.settings.get(),newTabBackground:'plain'});
    stores.settings.update(current=>({...current,theme:'dark'}));
    const restarted=new BrowserStores(directory);
    expect(restarted.settings.get()).toMatchObject({newTabBackground:'plain',theme:'dark'});
    restarted.settings.update(current=>({...current,newTabBackground:'portrait'}));
    expect(new BrowserStores(directory).settings.get().newTabBackground).toBe('portrait');
  });

  it('preserves Detroit appearance, accent and dimming across restart', () => {
    const directory = root();
    const stores = new BrowserStores(directory);
    stores.settings.set({
      ...stores.settings.get(),
      appearancePreset: 'detroit',
      accentColor: 'violet',
      wallpaperDim: 35,
    });
    expect(new BrowserStores(directory).settings.get()).toMatchObject({
      appearancePreset: 'detroit', accentColor: 'violet', wallpaperDim: 35,
    });
  });
  it('normalizes malformed persisted appearance settings', () => {
    const directory = root();
    fs.mkdirSync(path.join(directory, 'browser-data'));
    fs.writeFileSync(path.join(directory, 'browser-data/settings.json'), JSON.stringify({
      appearancePreset: 'unknown',
      accentColor: 'url(javascript:alert(1))',
      wallpaperDim: 500,
    }));
    expect(new BrowserStores(directory).settings.get()).toMatchObject({
      appearancePreset: 'classic', accentColor: 'blue', wallpaperDim: 75,
    });
  });

  it('never accepts arbitrary URLs, CSS fragments, objects or malformed values as background resources', () => {
    const directory=root();const stores=new BrowserStores(directory);
    const malicious=['https://external.test/track.png','file:///secret','data:image/svg+xml,<svg/>','url(https://external.test)','PLAIN','plain ',42,{toString:()=> 'plain'},true];
    for(const value of malicious) {
      expect(normalizeNewTabBackground(value)).toBe('portrait');
      stores.settings.set({...stores.settings.get(),newTabBackground:value} as never);
      expect(stores.settings.get().newTabBackground).toBe('portrait');
      expect(new BrowserStores(directory).settings.get().newTabBackground).toBe('portrait');
    }
    expect(normalizeNewTabBackground('plain')).toBe('plain');
  });
});
