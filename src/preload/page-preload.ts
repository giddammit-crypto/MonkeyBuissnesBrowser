import { ipcRenderer, webFrame } from 'electron';

// Chromium 134 native Chrome stealth injection for sandboxed preloads
const STEALTH_SCRIPT = `(function() {
  try {
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => false,
        configurable: true,
        enumerable: true,
      });
    } catch {}
    try {
      if (typeof navigator !== 'undefined') {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
          configurable: true,
          enumerable: true,
        });
      }
    } catch {}

    const isWin = navigator.platform && navigator.platform.toLowerCase().includes('win');
    const isMac = navigator.platform && navigator.platform.toLowerCase().includes('mac');
    const ua = isWin
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
      : isMac
        ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
    const appVer = ua.replace(/^Mozilla\\//, '');
    const plat = isWin ? 'Win32' : isMac ? 'MacIntel' : 'Linux x86_64';
    const brandPlatform = isWin ? 'Windows' : isMac ? 'macOS' : 'Linux';
    const platformVersion = isWin ? '10.0.0' : isMac ? '15.0.0' : '6.6.0';

    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => ua,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: () => appVer,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => plat,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(Navigator.prototype, 'vendor', {
      get: () => 'Google Inc.',
      configurable: true,
      enumerable: true,
    });

    const brands = [
      { brand: 'Chromium', version: '134' },
      { brand: 'Google Chrome', version: '134' },
      { brand: 'Not:A-Brand', version: '24' },
    ];
    const fullVersionList = [
      { brand: 'Chromium', version: '134.0.0.0' },
      { brand: 'Google Chrome', version: '134.0.0.0' },
      { brand: 'Not:A-Brand', version: '24.0.0.0' },
    ];

    class NavigatorUAData {
      get brands() { return brands; }
      get mobile() { return false; }
      get platform() { return brandPlatform; }
      getHighEntropyValues(hints) {
        const result = {
          brands: brands,
          mobile: false,
          platform: brandPlatform,
        };
        if (!Array.isArray(hints)) return Promise.resolve(result);
        if (hints.includes('architecture')) result.architecture = 'x86';
        if (hints.includes('bitness')) result.bitness = '64';
        if (hints.includes('model')) result.model = '';
        if (hints.includes('platformVersion')) result.platformVersion = platformVersion;
        if (hints.includes('uaFullVersion')) result.uaFullVersion = '134.0.0.0';
        if (hints.includes('fullVersionList')) result.fullVersionList = fullVersionList;
        return Promise.resolve(result);
      }
      toJSON() {
        return {
          brands: brands,
          mobile: false,
          platform: brandPlatform,
        };
      }
    }

    try {
      Object.defineProperty(NavigatorUAData.prototype, Symbol.toStringTag, {
        value: 'NavigatorUAData',
        configurable: true,
      });
    } catch {}

    const uaDataInstance = new NavigatorUAData();
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => uaDataInstance,
      configurable: true,
      enumerable: true,
    });

    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function() { return null; },
        getIsInstalled: function() { return false; },
        installState: function(cb) { if (typeof cb === 'function') cb('not_installed'); },
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          startE: performance.timeOrigin,
          onloadT: performance.timeOrigin,
          pageT: performance.now(),
          tran: 15,
        };
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          requestTime: performance.timeOrigin / 1000,
          startLoadTime: performance.timeOrigin / 1000,
          commitLoadTime: performance.timeOrigin / 1000,
          finishDocumentLoadTime: performance.timeOrigin / 1000,
          firstPaintTime: performance.timeOrigin / 1000,
          finishLoadTime: performance.timeOrigin / 1000,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
    }
  } catch {}
})();`;

// Apply Chromium stealth injection in main world before page scripts run
try {
  if (typeof webFrame !== 'undefined' && typeof webFrame.executeJavaScript === 'function') {
    void webFrame.executeJavaScript(STEALTH_SCRIPT);
  }
} catch {
  // Environments without webFrame (e.g. unit tests) gracefully ignore this
}

// No bridge is exposed to websites. A dirty form conservatively prevents discarding
// unsaved input; a completed main-frame navigation resets this in the controller.
let dirty = false;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('input', (event) => {
    if (!event.isTrusted || dirty) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
      dirty = true;
      ipcRenderer.send('page:form-state', true);
    }
  }, true);
}
// Submitting a form does not guarantee data was saved (SPA handlers may cancel
// navigation or receive a server error). Keep the guard until document navigation.

// In-page media downloader helper for Pinterest, VK, and YouTube
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const initMediaHelper = () => {
    const host = window.location.hostname;

    // 1. Pinterest photo & video downloader
    if (host.includes('pinterest.')) {
      document.addEventListener('mouseover', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const pin = target.closest('[data-test-id="pin"], [data-test-id="pin-visual-wrapper"], .pinWrapper') as HTMLElement | null;
        if (!pin || pin.querySelector('.soul-pin-dl')) return;

        const btn = document.createElement('button');
        btn.className = 'soul-pin-dl';
        btn.textContent = '⬇ Скачать';
        btn.title = 'Скачать в оригинальном качестве';
        btn.style.cssText = 'position:absolute;top:10px;right:10px;z-index:9999;background:rgba(230,0,35,0.92);color:#fff;border:none;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.35);transition:transform 0.15s ease,opacity 0.15s ease;';
        btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; };
        btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };
        btn.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const img = pin.querySelector('img[src*="pinimg.com"]') as HTMLImageElement | null;
          if (img && img.src) {
            const orig = img.src.replace(/\/(?:236|474|736)x\//, '/originals/');
            ipcRenderer.send('page:download-media', { url: orig, filename: 'pinterest-photo.jpg' });
            btn.textContent = '✓ Скачивается';
            setTimeout(() => { btn.textContent = '⬇ Скачать'; }, 2000);
            return;
          }
          const vid = pin.querySelector('video') as HTMLVideoElement | null;
          if (vid && vid.src && vid.src.startsWith('http')) {
            ipcRenderer.send('page:download-media', { url: vid.src, filename: 'pinterest-video.mp4' });
            btn.textContent = '✓ Скачивается';
            setTimeout(() => { btn.textContent = '⬇ Скачать'; }, 2000);
          }
        };
        const pos = window.getComputedStyle(pin).position;
        if (pos === 'static') pin.style.position = 'relative';
        pin.appendChild(btn);
      }, { passive: true });
    }

    // Dynamic theme colors matching soulm8te browser wallpaper & appearance
    let currentThemeInfo = {
      theme: 'dark',
      wallpaper: 'portrait',
      appearance: 'detroit',
      accent: 'blue',
    };
    try {
      const resp = ipcRenderer.sendSync('page:get-theme');
      if (resp && typeof resp === 'object') {
        currentThemeInfo = resp;
      }
    } catch {}

    const getThemeColors = () => {
      const app = currentThemeInfo.appearance;
      const wall = currentThemeInfo.wallpaper;
      if (app === 'cyberpink' || wall === 'cyberpink') {
        return {
          accent: '#ff4081',
          signal: '#ff2a85',
          soft: 'rgba(255, 64, 129, 0.16)',
          bg: '#0a0b10',
          surface: '#12131b',
          subtle: '#191b26',
          border: '#2c2538',
          borderStrong: '#ff4081',
        };
      } else if (app === 'cyberpink-fuji' || wall === 'cyberpink-fuji') {
        return {
          accent: '#c084fc',
          signal: '#d946ef',
          soft: 'rgba(192, 132, 252, 0.18)',
          bg: '#0b0914',
          surface: '#130f24',
          subtle: '#1c1635',
          border: '#31214d',
          borderStrong: '#c084fc',
        };
      } else if (app === 'cyber-butterfly' || wall === 'cyber-butterfly') {
        return {
          accent: '#818cf8',
          signal: '#a78bfa',
          soft: 'rgba(129, 140, 248, 0.18)',
          bg: '#0b0d18',
          surface: '#121526',
          subtle: '#191c33',
          border: '#272c4e',
          borderStrong: '#818cf8',
        };
      } else if (app === 'tokyo-night' || wall === 'tokyo-night') {
        return {
          accent: '#00f0ff',
          signal: '#38bdf8',
          soft: 'rgba(0, 240, 255, 0.18)',
          bg: '#06070a',
          surface: '#0c0e15',
          subtle: '#131622',
          border: '#1c2233',
          borderStrong: '#00f0ff',
        };
      } else if (app === 'celestial-palace' || wall === 'celestial-palace') {
        return {
          accent: '#38bdf8',
          signal: '#60a5fa',
          soft: 'rgba(56, 189, 248, 0.18)',
          bg: '#0a0e17',
          surface: '#101624',
          subtle: '#182033',
          border: '#222d45',
          borderStrong: '#38bdf8',
        };
      } else if (app === 'detroit' || wall === 'portrait') {
        return {
          accent: '#00d2ff',
          signal: '#38bdf8',
          soft: 'rgba(0, 210, 255, 0.15)',
          bg: '#0c1017',
          surface: '#121824',
          subtle: '#192233',
          border: '#233145',
          borderStrong: '#00d2ff',
        };
      }
      return {
        accent: '#8cbce8',
        signal: '#35678f',
        soft: 'rgba(140, 188, 232, 0.15)',
        bg: '#171b20',
        surface: '#20262d',
        subtle: '#252d35',
        border: '#39434d',
        borderStrong: '#8cbce8',
      };
    };

    let updateVkTheme: ((force?: boolean) => void) | undefined;
    let updateYtTheme: ((force?: boolean) => void) | undefined;

    ipcRenderer.on('page:theme-updated', (_event, payload) => {
      if (payload && typeof payload === 'object') {
        currentThemeInfo = payload;
        updateVkTheme?.(true);
        updateYtTheme?.(true);
      }
    });

    // 2. VK video, music & photo downloader & Soulm8te Theme
    if (host.includes('vk.com') || host.includes('vkvideo.ru')) {
      const injectVkButton = () => {
        const colors = getThemeColors();
        const pvBottom = document.getElementById('pv_bottom_info');
        if (pvBottom && !pvBottom.querySelector('.soul-vk-dl')) {
          const btn = document.createElement('a');
          btn.className = 'soul-vk-dl pv_bottom_action';
          btn.textContent = '⬇ Скачать оригинал';
          btn.style.cssText = `color:${colors.accent};margin-left:14px;cursor:pointer;font-weight:500;`;
          btn.onclick = (e) => {
            e.preventDefault();
            const pvImg = document.querySelector('#pv_photo img') as HTMLImageElement | null;
            if (pvImg && pvImg.src) {
              ipcRenderer.send('page:download-media', { url: pvImg.src });
            }
          };
          pvBottom.appendChild(btn);
        }

        // VK Video & Clip download button
        const vkVideoActions = document.querySelector('.videoplayer_controls, .VideoPage__actions, .mv_actions_block, .like_wrap, [data-video-id]');
        if (vkVideoActions && !document.querySelector('.soul-vk-vid-btn')) {
          const btn = document.createElement('a');
          btn.className = 'soul-vk-vid-btn';
          btn.textContent = '⬇ Скачать видео (MP4)';
          btn.style.cssText = `color:${colors.accent};margin-left:12px;cursor:pointer;font-weight:600;font-size:13px;display:inline-flex;align-items:center;background:${colors.soft};padding:6px 12px;border-radius:12px;border:1px solid ${colors.accent};`;
          btn.onclick = (e) => {
            e.preventDefault();
            let targetVideoUrl = window.location.href;
            const search = window.location.search;
            const zMatch = search.match(/(?:z=)?video(-?\d+_\d+)/);
            const clipMatch = search.match(/(?:z=)?clip(-?\d+_\d+)/);
            if (zMatch) {
              targetVideoUrl = `https://vk.com/video${zMatch[1]}`;
            } else if (clipMatch) {
              targetVideoUrl = `https://vk.com/clip${clipMatch[1]}`;
            } else {
              const modalEl = document.querySelector('#mv_box, [data-video-id]');
              const vidId = modalEl?.getAttribute('data-video-id');
              if (vidId) {
                targetVideoUrl = `https://vk.com/video${vidId}`;
              }
            }
            ipcRenderer.send('page:download-media', {
              url: targetVideoUrl,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'vk-video') + '.mp4',
              isAudio: false,
            });
            btn.textContent = '✓ Скачивается';
            setTimeout(() => { btn.textContent = '⬇ Скачать видео (MP4)'; }, 3000);
          };
          vkVideoActions.appendChild(btn);
        }

        // VK Music Top Player download button
        const topPlayer = document.querySelector('#top_audio_player, .top_audio_player, .AudioPlayer, .TopAudioPlayer');
        if (topPlayer && !topPlayer.querySelector('.soul-vk-top-audio-dl')) {
          const btn = document.createElement('button');
          btn.className = 'soul-vk-top-audio-dl';
          btn.textContent = '⬇ MP3';
          btn.title = 'Скачать текущий трек MP3';
          btn.style.cssText = `background:${colors.soft};color:${colors.accent};border:1px solid ${colors.accent};border-radius:12px;padding:3px 9px;font-size:12px;font-weight:600;cursor:pointer;margin-left:10px;display:inline-flex;align-items:center;vertical-align:middle;`;
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const artist = document.querySelector('.top_audio_player_artist, .AudioPlayer__performer, .audio_page_player_performer')?.textContent?.trim() || '';
            const title = document.querySelector('.top_audio_player_title, .AudioPlayer__title, .audio_page_player_title')?.textContent?.trim() || 'Track';
            const filename = (artist ? `${artist} - ${title}.mp3` : `${title}.mp3`).replace(/[\\/:*?"<>|]/g, '');
            const audioEl = document.querySelector('audio');
            const src = audioEl?.src || audioEl?.currentSrc;
            ipcRenderer.send('page:download-media', {
              url: src && src.startsWith('http') ? src : window.location.href,
              filename,
              isAudio: true,
            });
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '⬇ MP3'; }, 2500);
          };
          topPlayer.appendChild(btn);
        }

        // VK Music Track Rows - inject download buttons on audio rows
        const audioRows = document.querySelectorAll('.audio_row, .AudioRow, .vkuiAudioRow');
        for (let i = 0; i < Math.min(audioRows.length, 50); i++) {
          const row = audioRows[i];
          if (row.querySelector('.soul-vk-row-dl')) continue;
          const actions = row.querySelector('.audio_row__actions, .AudioRow__actions, .audio_row__inner') || row;
          const dl = document.createElement('button');
          dl.className = 'soul-vk-row-dl';
          dl.textContent = '⬇';
          dl.title = 'Скачать MP3';
          dl.style.cssText = `background:${colors.soft};color:${colors.accent};border:none;border-radius:8px;padding:2px 6px;font-size:12px;font-weight:bold;cursor:pointer;margin-left:6px;vertical-align:middle;`;
          dl.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const artist = row.querySelector('.audio_row__performers, .AudioRow__performer')?.textContent?.trim() || '';
            const title = row.querySelector('.audio_row__title_inner, .AudioRow__title')?.textContent?.trim() || 'Track';
            const filename = (artist ? `${artist} - ${title}.mp3` : `${title}.mp3`).replace(/[\\/:*?"<>|]/g, '');

            const audioEl = document.querySelector('audio');
            const src = audioEl?.src || audioEl?.currentSrc;
            if (src && (src.includes('vkuseraudio.net') || src.includes('.mp3') || src.includes('.m3u8'))) {
              ipcRenderer.send('page:download-media', { url: src, filename, isAudio: true });
              dl.textContent = '✓';
              setTimeout(() => { dl.textContent = '⬇'; }, 2000);
            } else {
              const play = row.querySelector('.audio_row__play_btn, .AudioRow__play, button[aria-label*="Воспроизвести"], [data-action="play"]') as HTMLElement | null;
              if (play) play.click();
              dl.textContent = '⏳';
              setTimeout(() => {
                const updatedAudio = document.querySelector('audio');
                const updatedSrc = updatedAudio?.src || updatedAudio?.currentSrc;
                ipcRenderer.send('page:download-media', {
                  url: updatedSrc && updatedSrc.startsWith('http') ? updatedSrc : window.location.href,
                  filename,
                  isAudio: true,
                });
                dl.textContent = '✓';
                setTimeout(() => { dl.textContent = '⬇'; }, 2000);
              }, 400);
            }
          };
          actions.appendChild(dl);
        }
      };
      setInterval(injectVkButton, 1000);
      window.addEventListener('popstate', () => setTimeout(injectVkButton, 300));

      // Inject Soulm8te theme for VK matching browser wallpaper
      function injectVkTheme(forceUpdate = false) {
        let style = document.getElementById('soulm8te-vk-theme') as HTMLStyleElement | null;
        if (!style) {
          style = document.createElement('style');
          style.id = 'soulm8te-vk-theme';
          document.head?.appendChild(style);
        } else if (!forceUpdate) {
          return;
        }
        const colors = getThemeColors();
        style.textContent = `
          body, #page_wrap, #page_body {
            background: ${colors.bg} !important;
            color: #f7f8fa !important;
          }
          #page_header_wrap, #page_header {
            background: ${colors.surface} !important;
            border-bottom: 1px solid ${colors.border} !important;
          }
          .page_block, .post, .feed_row, .im-page {
            background: ${colors.surface} !important;
            border: 1px solid ${colors.border} !important;
            border-radius: 14px !important;
            color: #f7f8fa !important;
            box-shadow: 0 4px 18px rgba(0, 0, 0, 0.22) !important;
          }
          .side_bar_inner .left_row {
            border-radius: 10px !important;
            color: #bdc6d0 !important;
            transition: all 0.15s ease !important;
          }
          .side_bar_inner .left_row:hover {
            background: ${colors.subtle} !important;
            color: ${colors.accent} !important;
          }
          a {
            color: ${colors.accent} !important;
          }
          .submit_post_box, .post_field {
            background: ${colors.subtle} !important;
            border: 1px solid ${colors.border} !important;
            border-radius: 12px !important;
            color: #f7f8fa !important;
          }
        `;
      };
      updateVkTheme = injectVkTheme;
      injectVkTheme();
      setInterval(() => injectVkTheme(false), 2000);
    }

    // 3. YouTube native stream downloader & Soulm8te Theme
    if (host.includes('youtube.com')) {
      const injectYtButton = () => {
        const colors = getThemeColors();
        const targetContainer = document.querySelector('#owner, #actions #top-level-buttons-computed, ytd-watch-metadata #actions');
        if (targetContainer && !document.querySelector('.soul-yt-dl-btn')) {
          const btn = document.createElement('button');
          btn.className = 'soul-yt-dl-btn';
          btn.textContent = '⬇ Скачать MP4';
          btn.title = 'Прямое скачивание видео в высоком качестве';
          btn.style.cssText = `background:linear-gradient(135deg, ${colors.surface} 0%, ${colors.bg} 100%);color:${colors.accent};border:1px solid ${colors.accent};border-radius:18px;padding:0 16px;height:36px;font-size:13px;font-weight:600;cursor:pointer;margin-left:8px;display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 12px ${colors.soft};transition:all 0.2s ease;`;
          btn.onmouseenter = () => { btn.style.transform = 'scale(1.04)'; };
          btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-video') + '.mp4',
            });
            btn.textContent = '✓ Скачивается';
            setTimeout(() => { btn.textContent = '⬇ Скачать MP4'; }, 3000);
          };
          targetContainer.appendChild(btn);
        }
      };
      setInterval(injectYtButton, 1200);
      window.addEventListener('yt-navigate-finish', () => setTimeout(injectYtButton, 400));
      window.addEventListener('spfdone', () => setTimeout(injectYtButton, 400));

      // Inject Soulm8te Theme for YouTube matching browser wallpaper
      function injectYtTheme(forceUpdate = false) {
        let style = document.getElementById('soulm8te-yt-theme') as HTMLStyleElement | null;
        if (!style) {
          style = document.createElement('style');
          style.id = 'soulm8te-yt-theme';
          document.head?.appendChild(style);
        } else if (!forceUpdate) {
          return;
        }
        const colors = getThemeColors();
        style.textContent = `
          :root {
            --yt-spec-base-background: ${colors.bg} !important;
            --yt-spec-raised-background: ${colors.surface} !important;
            --yt-spec-menu-background: ${colors.surface} !important;
            --yt-spec-brand-background-primary: ${colors.bg} !important;
            --yt-spec-general-background-a: ${colors.bg} !important;
            --yt-spec-general-background-b: ${colors.surface} !important;
            --yt-spec-badge-chip-background: ${colors.subtle} !important;
            --yt-spec-button-chip-background-hover: ${colors.soft} !important;
            --yt-spec-touch-response: ${colors.signal} !important;
            --yt-spec-text-primary: #f7f8fa !important;
            --yt-spec-text-secondary: #bdc6d0 !important;
            --yt-spec-icon-active-other: ${colors.accent} !important;
          }
          html[dark], [dark] {
            background-color: ${colors.bg} !important;
          }
          #page-manager.ytd-app,
          ytd-app,
          ytd-watch-flexy,
          #primary.ytd-watch-flexy,
          #secondary.ytd-watch-flexy,
          #columns.ytd-watch-flexy {
            background: ${colors.bg} !important;
          }
          #masthead-container.ytd-app,
          ytd-masthead {
            background: ${colors.surface} !important;
            border-bottom: 1px solid ${colors.border} !important;
          }
          #container.ytd-searchbox {
            background: ${colors.subtle} !important;
            border: 1px solid ${colors.border} !important;
            border-radius: 20px 0 0 20px !important;
          }
          #search-icon-legacy.ytd-searchbox {
            background: ${colors.surface} !important;
            border: 1px solid ${colors.border} !important;
            border-left: 0 !important;
            border-radius: 0 20px 20px 0 !important;
          }
          ytd-rich-item-renderer,
          ytd-compact-video-renderer {
            background: ${colors.surface} !important;
            border: 1px solid ${colors.border} !important;
            border-radius: 12px !important;
            padding: 8px !important;
            transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease !important;
          }
          ytd-rich-item-renderer:hover,
          ytd-compact-video-renderer:hover {
            border-color: ${colors.accent} !important;
            transform: translateY(-2px) !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4) !important;
          }
          ytd-thumbnail img,
          #thumbnail.ytd-thumbnail {
            border-radius: 9px !important;
          }
          yt-chip-cloud-chip-renderer {
            background: ${colors.subtle} !important;
            border: 1px solid ${colors.border} !important;
            border-radius: 16px !important;
          }
          yt-chip-cloud-chip-renderer[selected] {
            background: ${colors.soft} !important;
            border-color: ${colors.accent} !important;
            color: ${colors.accent} !important;
          }
          ytd-guide-renderer,
          ytd-mini-guide-renderer {
            background: ${colors.surface} !important;
            border-right: 1px solid ${colors.border} !important;
          }
        `;
      };
      updateYtTheme = injectYtTheme;
      injectYtTheme();
      setInterval(() => injectYtTheme(false), 2000);
    }

    // 4. Video & Audio media detection for download button checkmark
    const checkMedia = () => {
      try {
        const videos = document.getElementsByTagName('video');
        let hasVideo = false;
        for (let i = 0; i < videos.length; i++) {
          const v = videos[i];
          if (v && (v.src || v.currentSrc || v.querySelector('source') || v.duration > 0 || !v.paused)) {
            hasVideo = true;
            break;
          }
        }
        const audios = document.getElementsByTagName('audio');
        let hasAudio = false;
        for (let i = 0; i < audios.length; i++) {
          const a = audios[i];
          if (a && (a.src || a.currentSrc || !a.paused || a.duration > 0)) {
            hasAudio = true;
            break;
          }
        }
        if (!hasVideo && (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('rutube.ru') || host.includes('vk.com') || host.includes('vkvideo.ru') || host.includes('pinterest.'))) {
          hasVideo = true;
        }
        ipcRenderer.send('page:media-detected', { hasVideo, hasAudio });
      } catch {}
    };
    checkMedia();
    setInterval(checkMedia, 3000);

    // Audio stream auto-capture on playback
    document.addEventListener('play', (e) => {
      const target = e.target;
      if (target instanceof HTMLAudioElement || (target instanceof HTMLElement && target.tagName === 'AUDIO')) {
        const audio = target as HTMLAudioElement;
        const src = audio.src || audio.currentSrc;
        if (src && (src.includes('vkuseraudio.net') || src.includes('.mp3') || src.includes('.m3u8') || src.startsWith('http'))) {
          const artist = document.querySelector('.top_audio_player_artist, .AudioPlayer__performer, .audio_page_player_performer, .audio_row_current .audio_row__performers')?.textContent?.trim() || '';
          const title = document.querySelector('.top_audio_player_title, .AudioPlayer__title, .audio_page_player_title, .audio_row_current .audio_row__title_inner')?.textContent?.trim() || '';
          const filename = (artist && title ? `${artist} - ${title}.mp3` : title ? `${title}.mp3` : undefined)?.replace(/[\\/:*?"<>|]/g, '');
          ipcRenderer.send('page:audio-stream-captured', { url: src, title, artist, filename });
        }
      }
    }, true);

    // 5. Google Account Detection & SSO Auto-sync
    if (host.includes('google.')) {
      const checkGoogleAccount = () => {
        try {
          const ariaEl = document.querySelector('a[aria-label*="@"], div[aria-label*="@"], [data-email*="@"]');
          let email = '';
          let name = '';
          let avatar = '';

          if (ariaEl) {
            const label = ariaEl.getAttribute('aria-label') || '';
            const emailMatch = label.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
              email = emailMatch[1];
              const nameMatch = label.match(/(?:Google Account|Аккаунт Google):\s*([^\n(]+)/i);
              if (nameMatch) name = nameMatch[1].trim();
            }
            const dataEmail = ariaEl.getAttribute('data-email');
            if (dataEmail && dataEmail.includes('@')) email = dataEmail;
            const img = ariaEl.querySelector('img') || ariaEl.closest('header, nav, #gb')?.querySelector('img[src*="googleusercontent.com"]');
            if (img && img instanceof HTMLImageElement && img.src) avatar = img.src;
          }

          if (!email) {
            const gbImg = document.querySelector('img.gb_p, img.gb_q, #gb img[src*="googleusercontent.com"], a[href*="SignOutOptions"] img');
            if (gbImg && gbImg instanceof HTMLImageElement) {
              avatar = gbImg.src;
              const parentLabel = gbImg.parentElement?.getAttribute('aria-label') || gbImg.getAttribute('aria-label') || '';
              const emMatch = parentLabel.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
              if (emMatch) email = emMatch[1];
            }
          }

          if (email) {
            ipcRenderer.send('page:google-account-detected', { email, name, avatar });
          }
        } catch {}
      };
      checkGoogleAccount();
      setInterval(checkGoogleAccount, 4000);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMediaHelper, { once: true });
  } else {
    initMediaHelper();
  }
}
