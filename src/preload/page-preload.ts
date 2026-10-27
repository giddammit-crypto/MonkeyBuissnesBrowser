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

// In-page media downloader helper for VK and YouTube
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const initMediaHelper = () => {
    const host = window.location.hostname;
    const isHostOrSubdomain = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
    const isVkHost = isHostOrSubdomain('vk.com') || isHostOrSubdomain('vkvideo.ru');
    const injectors: Array<() => void> = [];
    let injectionTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleInjection = () => {
      if (injectionTimer) return;
      injectionTimer = setTimeout(() => {
        injectionTimer = undefined;
        for (const inject of injectors) inject();
      }, 350);
    };

    // VK video, music & photo downloader
    if (isVkHost) {
      const injectVkButton = () => {
        const pvBottom = document.getElementById('pv_bottom_info');
        if (pvBottom && !pvBottom.querySelector('.soul-vk-dl')) {
          const btn = document.createElement('a');
          btn.className = 'soul-vk-dl pv_bottom_action';
          btn.textContent = '⬇ Скачать оригинал';
          btn.style.cssText = 'color:#2563eb;margin-left:14px;cursor:pointer;font-weight:500;';
          btn.onclick = (e) => {
            e.preventDefault();
            const pvImg = document.querySelector('#pv_photo img') as HTMLImageElement | null;
            if (pvImg && pvImg.src) {
              ipcRenderer.send('page:download-media', { url: pvImg.src });
            }
          };
          pvBottom.appendChild(btn);
        }

        // VK Clip download button
        const vkClipActions = document.querySelector(
          '.ShortsOverlay, [class*="ShortsOverlay"], .ShortsItem__actions, [class*="ShortsItem__actions"], .ShortsSlide__actions, [class*="ClipViewer"]'
        );
        if (vkClipActions && !document.querySelector('.soul-vk-clip-btn')) {
          const clipBtn = document.createElement('a');
          clipBtn.className = 'soul-vk-clip-btn';
          clipBtn.textContent = '⬇ Скачать клип';
          clipBtn.style.cssText = 'color:#fff;background:#2563eb;margin:6px 0;cursor:pointer;font-weight:600;font-size:12px;display:inline-flex;align-items:center;justify-content:center;padding:6px 12px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3);text-decoration:none;z-index:9999;';
          clipBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            let targetVideoUrl = window.location.href;
            const pathname = window.location.pathname;
            const search = window.location.search;
            const pathClipMatch = pathname.match(/\/(?:clip)(-?\d+_\d+)/);
            const clipMatch = search.match(/(?:[?&#]|z=)clip(-?\d+_\d+)/);
            if (clipMatch) {
              targetVideoUrl = `https://vk.com/clip${clipMatch[1]}`;
            } else if (pathClipMatch) {
              targetVideoUrl = `https://vk.com/clip${pathClipMatch[1]}`;
            } else {
              const activeClipEl = document.querySelector('[class*="ShortsItem--active"] [data-clip-id], [class*="active"] [data-clip-id], [data-clip-id]:hover, [data-clip-id]');
              const clipId = activeClipEl?.getAttribute('data-clip-id') || activeClipEl?.getAttribute('data-id');
              if (clipId) {
                targetVideoUrl = `https://vk.com/clip${clipId.startsWith('-') || clipId.includes('_') ? clipId : '-' + clipId}`;
              }
            }
            ipcRenderer.send('page:download-media', {
              url: targetVideoUrl,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'vk-clip') + '.mp4',
              isAudio: false,
            });
            clipBtn.textContent = '✓ Загрузка...';
            setTimeout(() => { clipBtn.textContent = '⬇ Скачать клип'; }, 3000);
          };
          vkClipActions.appendChild(clipBtn);
        }

        // VK Video & Clip download button
        const vkVideoActions = document.querySelector('.videoplayer_controls, .VideoPage__actions, .mv_actions_block, .like_wrap, [data-video-id]');
        if (vkVideoActions && !document.querySelector('.soul-vk-vid-btn')) {
          const btn = document.createElement('a');
          btn.className = 'soul-vk-vid-btn';
          btn.textContent = '⬇ Скачать видео (MP4)';
          btn.style.cssText = 'color:#2563eb;margin-left:12px;cursor:pointer;font-weight:600;font-size:13px;display:inline-flex;align-items:center;background:rgba(37,99,235,0.12);padding:6px 12px;border-radius:12px;border:1px solid #2563eb;';
          btn.onclick = (e) => {
            e.preventDefault();
            let targetVideoUrl = window.location.href;
            const search = window.location.search;
            const pathname = window.location.pathname;
            const zMatch = search.match(/(?:[?&#]|z=)?video(-?\d+_\d+)/);
            const clipMatch = search.match(/(?:[?&#]|z=)?clip(-?\d+_\d+)/);
            const pathClipMatch = pathname.match(/\/clip(-?\d+_\d+)/);
            const pathVidMatch = pathname.match(/\/video(-?\d+_\d+)/);
            if (clipMatch) {
              targetVideoUrl = `https://vk.com/clip${clipMatch[1]}`;
            } else if (pathClipMatch) {
              targetVideoUrl = `https://vk.com/clip${pathClipMatch[1]}`;
            } else if (zMatch) {
              targetVideoUrl = `https://vk.com/video${zMatch[1]}`;
            } else if (pathVidMatch) {
              targetVideoUrl = `https://vk.com/video${pathVidMatch[1]}`;
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
          btn.style.cssText = 'background:rgba(37,99,235,0.12);color:#2563eb;border:1px solid #2563eb;border-radius:12px;padding:3px 9px;font-size:12px;font-weight:600;cursor:pointer;margin-left:10px;display:inline-flex;align-items:center;vertical-align:middle;';
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
          dl.style.cssText = 'background:rgba(37,99,235,0.12);color:#2563eb;border:none;border-radius:8px;padding:2px 6px;font-size:12px;font-weight:bold;cursor:pointer;margin-left:6px;vertical-align:middle;';
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
      injectors.push(injectVkButton);
      window.addEventListener('popstate', scheduleInjection);
    }

    // YouTube native stream downloader
    if (isHostOrSubdomain('youtube.com')) {
      const injectYtButton = () => {
        // Standard video target (action bar under video)
        const targetContainer = document.querySelector('#owner, #actions #top-level-buttons-computed, ytd-watch-metadata #actions, #actions.ytd-watch-metadata, #top-row');
        if (targetContainer && !document.querySelector('.soul-yt-dl-btn')) {
          const btn = document.createElement('button');
          btn.className = 'soul-yt-dl-btn';
          btn.textContent = '⬇ Скачать MP4';
          btn.title = 'Прямое скачивание видео в высоком качестве (MP4)';
          btn.style.cssText = 'background:#065fd4;color:#ffffff;border:none;border-radius:18px;padding:0 16px;height:36px;font-size:13px;font-weight:600;cursor:pointer;margin-left:8px;display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(6,95,212,0.3);transition:transform 0.2s ease;';
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
        if (targetContainer && !document.querySelector('.soul-yt-audio-dl-btn')) {
          const audioBtn = document.createElement('button');
          audioBtn.className = 'soul-yt-audio-dl-btn';
          audioBtn.textContent = '♫ MP3';
          audioBtn.title = 'Скачать аудиодорожку в MP3';
          audioBtn.style.cssText = 'background:#f1f3f4;color:#202124;border:1px solid #dadce0;border-radius:18px;padding:0 14px;height:36px;font-size:13px;font-weight:600;cursor:pointer;margin-left:8px;display:inline-flex;align-items:center;gap:6px;';
          audioBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-audio') + '.mp3',
              isAudio: true,
            });
            audioBtn.textContent = '✓ Скачивается';
            setTimeout(() => { audioBtn.textContent = '♫ MP3'; }, 3000);
          };
          targetContainer.appendChild(audioBtn);
        }

        // Floating player overlay badge for standard YouTube watch pages
        const playerContainer = document.querySelector('#movie_player, .html5-video-player');
        if (playerContainer && !playerContainer.querySelector('.soul-yt-player-float-badge') && (window.location.pathname.includes('/watch') || window.location.search.includes('v='))) {
          const floatBadge = document.createElement('div');
          floatBadge.className = 'soul-yt-player-float-badge';
          floatBadge.style.cssText = 'position:absolute;top:16px;right:16px;z-index:2147483647;display:flex;align-items:center;gap:6px;opacity:0.85;transition:opacity 0.2s ease;pointer-events:auto;';
          floatBadge.onmouseenter = () => { floatBadge.style.opacity = '1'; };
          floatBadge.onmouseleave = () => { floatBadge.style.opacity = '0.85'; };

          const fMp4 = document.createElement('button');
          fMp4.innerHTML = '<span style="font-size:12px;">⬇</span><span>MP4</span>';
          fMp4.title = 'Скачать видео (MP4)';
          fMp4.style.cssText = 'background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:14px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
          fMp4.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-video') + '.mp4',
            });
            fMp4.innerHTML = '<span>✓</span><span>Загрузка...</span>';
            setTimeout(() => { fMp4.innerHTML = '<span style="font-size:12px;">⬇</span><span>MP4</span>'; }, 2500);
          };

          const fMp3 = document.createElement('button');
          fMp3.innerHTML = '<span style="font-size:12px;">♫</span><span>MP3</span>';
          fMp3.title = 'Скачать аудио (MP3)';
          fMp3.style.cssText = 'background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#e2e8f0;border:1px solid rgba(255,255,255,0.25);border-radius:14px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
          fMp3.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-audio') + '.mp3',
              isAudio: true,
            });
            fMp3.innerHTML = '<span>✓</span><span>Загрузка...</span>';
            setTimeout(() => { fMp3.innerHTML = '<span style="font-size:12px;">♫</span><span>MP3</span>'; }, 2500);
          };

          floatBadge.appendChild(fMp4);
          floatBadge.appendChild(fMp3);
          playerContainer.appendChild(floatBadge);
        }

        // Shorts vertical target: dynamically inspect active reel renderers and shorts containers
        const reelRenderers = document.querySelectorAll('ytd-reel-video-renderer[is-active], ytd-reel-video-renderer, ytd-shorts [is-active]');
        const isShortsPage = window.location.pathname.includes('/shorts');

        if (reelRenderers.length > 0) {
          reelRenderers.forEach((reel) => {
            // A. Floating overlay bar on the shorts player (immune to #actions overflow:hidden)
            const playerOverlay = reel.querySelector('ytd-reel-player-overlay-renderer, #player-container, .html5-video-player') || reel;
            if (!reel.querySelector('.soul-yt-shorts-float-bar') && playerOverlay) {
              const floatBar = document.createElement('div');
              floatBar.className = 'soul-yt-shorts-float-bar';
              floatBar.style.cssText = 'position:absolute;top:16px;left:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;pointer-events:auto;';

              const mp4Btn = document.createElement('button');
              mp4Btn.className = 'soul-yt-shorts-float-btn soul-yt-shorts-mp4';
              mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>';
              mp4Btn.title = 'Скачать Shorts в высоком качестве (MP4)';
              mp4Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#ffffff;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);transition:all 0.15s ease;letter-spacing:0.3px;';
              mp4Btn.onmouseenter = () => { mp4Btn.style.background = '#2563eb'; mp4Btn.style.borderColor = '#60a5fa'; mp4Btn.style.transform = 'translateY(-1px) scale(1.03)'; };
              mp4Btn.onmouseleave = () => { mp4Btn.style.background = 'rgba(15,23,42,0.88)'; mp4Btn.style.borderColor = 'rgba(255,255,255,0.25)'; mp4Btn.style.transform = 'none'; };
              mp4Btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp4',
                  isAudio: false,
                });
                mp4Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
                setTimeout(() => { mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>'; }, 3000);
              };

              const mp3Btn = document.createElement('button');
              mp3Btn.className = 'soul-yt-shorts-float-btn soul-yt-shorts-mp3';
              mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>';
              mp3Btn.title = 'Скачать аудиодорожку Shorts (MP3)';
              mp3Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#e2e8f0;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);transition:all 0.15s ease;letter-spacing:0.3px;';
              mp3Btn.onmouseenter = () => { mp3Btn.style.background = 'rgba(255,255,255,0.25)'; mp3Btn.style.borderColor = '#ffffff'; mp3Btn.style.transform = 'translateY(-1px) scale(1.03)'; };
              mp3Btn.onmouseleave = () => { mp3Btn.style.background = 'rgba(15,23,42,0.88)'; mp3Btn.style.borderColor = 'rgba(255,255,255,0.25)'; mp3Btn.style.transform = 'none'; };
              mp3Btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp3',
                  isAudio: true,
                });
                mp3Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
                setTimeout(() => { mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>'; }, 3000);
              };

              floatBar.appendChild(mp4Btn);
              floatBar.appendChild(mp3Btn);
              playerOverlay.appendChild(floatBar);
            }

            // B. Also inject inside #actions if available
            const reelActions = reel.querySelector('#actions, ytd-reel-player-overlay-renderer #actions, #button-bar, #actions.ytd-reel-player-overlay-renderer') ||
              (reel.matches('[is-active]') ? document.querySelector('ytd-shorts #actions, ytd-reel-player-overlay-renderer #actions') : null);
            if (reelActions && !reelActions.querySelector('.soul-yt-shorts-dl-btn')) {
              const shortsBtn = document.createElement('button');
              shortsBtn.className = 'soul-yt-shorts-dl-btn';
              shortsBtn.textContent = '⬇ MP4';
              shortsBtn.title = 'Скачать Shorts в высоком качестве (MP4)';
              shortsBtn.style.cssText = 'background:#065fd4;color:#ffffff;border:none;border-radius:18px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;margin:4px 0;display:inline-flex;align-items:center;justify-content:center;gap:4px;box-shadow:0 2px 8px rgba(6,95,212,0.4);transition:transform 0.15s ease;';
              shortsBtn.onmouseenter = () => { shortsBtn.style.transform = 'scale(1.05)'; };
              shortsBtn.onmouseleave = () => { shortsBtn.style.transform = 'scale(1)'; };
              shortsBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp4',
                  isAudio: false,
                });
                shortsBtn.textContent = '✓ Загрузка';
                setTimeout(() => { shortsBtn.textContent = '⬇ MP4'; }, 3000);
              };
              reelActions.appendChild(shortsBtn);
            }

            if (reelActions && !reelActions.querySelector('.soul-yt-shorts-audio-btn')) {
              const shortsAudioBtn = document.createElement('button');
              shortsAudioBtn.className = 'soul-yt-shorts-audio-btn';
              shortsAudioBtn.textContent = '♫ MP3';
              shortsAudioBtn.title = 'Скачать звук Shorts в MP3';
              shortsAudioBtn.style.cssText = 'background:rgba(255,255,255,0.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#ffffff;border:1px solid rgba(255,255,255,0.3);border-radius:18px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;margin:4px 0;display:inline-flex;align-items:center;justify-content:center;gap:4px;transition:transform 0.15s ease;';
              shortsAudioBtn.onmouseenter = () => { shortsAudioBtn.style.transform = 'scale(1.05)'; };
              shortsAudioBtn.onmouseleave = () => { shortsAudioBtn.style.transform = 'scale(1)'; };
              shortsAudioBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const reelLink = reel.querySelector('a[href*="/shorts/"], a[href*="/watch?v="]') as HTMLAnchorElement | null;
                const targetUrl = reelLink?.href || window.location.href;
                const titleEl = reel.querySelector('h2.title, #headline, .title.ytd-reel-player-header-renderer, ytd-reel-player-header-renderer h2, #title-and-metadata');
                const shortTitle = (titleEl?.textContent?.trim() || document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts');
                ipcRenderer.send('page:download-media', {
                  url: targetUrl,
                  filename: shortTitle + '.mp3',
                  isAudio: true,
                });
                shortsAudioBtn.textContent = '✓ Загрузка';
                setTimeout(() => { shortsAudioBtn.textContent = '♫ MP3'; }, 3000);
              };
              reelActions.appendChild(shortsAudioBtn);
            }
          });
        } else if (isShortsPage && !document.querySelector('.soul-yt-shorts-float-bar')) {
          // Fallback if polymer reels have not rendered custom element names yet
          const shortsContainer = document.querySelector('ytd-shorts, #shorts-player, #player-container, #shorts-container');
          if (shortsContainer) {
            const floatBar = document.createElement('div');
            floatBar.className = 'soul-yt-shorts-float-bar';
            floatBar.style.cssText = 'position:fixed;top:70px;left:24px;z-index:2147483647;display:flex;align-items:center;gap:8px;pointer-events:auto;';

            const mp4Btn = document.createElement('button');
            mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>';
            mp4Btn.title = 'Скачать Shorts в высоком качестве (MP4)';
            mp4Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);color:#ffffff;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);';
            mp4Btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              ipcRenderer.send('page:download-media', {
                url: window.location.href,
                filename: (document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts') + '.mp4',
                isAudio: false,
              });
              mp4Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
              setTimeout(() => { mp4Btn.innerHTML = '<span style="font-size:13px;line-height:1;">⬇</span><span>MP4</span>'; }, 3000);
            };

            const mp3Btn = document.createElement('button');
            mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>';
            mp3Btn.title = 'Скачать аудио Shorts (MP3)';
            mp3Btn.style.cssText = 'background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);color:#e2e8f0;border:1px solid rgba(255,255,255,0.25);border-radius:18px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 4px 14px rgba(0,0,0,0.5);';
            mp3Btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              ipcRenderer.send('page:download-media', {
                url: window.location.href,
                filename: (document.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-shorts') + '.mp3',
                isAudio: true,
              });
              mp3Btn.innerHTML = '<span>✓</span><span>Загрузка...</span>';
              setTimeout(() => { mp3Btn.innerHTML = '<span style="font-size:13px;line-height:1;">♫</span><span>MP3</span>'; }, 3000);
            };

            floatBar.appendChild(mp4Btn);
            floatBar.appendChild(mp3Btn);
            shortsContainer.appendChild(floatBar);
          }
        }
      };
      injectors.push(injectYtButton);
      window.addEventListener('yt-navigate-finish', scheduleInjection);
      window.addEventListener('spfdone', scheduleInjection);
      window.addEventListener('yt-action', scheduleInjection);
      window.addEventListener('yt-visibility-refresh', scheduleInjection);
      window.addEventListener('yt-page-data-updated', scheduleInjection);
      window.addEventListener('popstate', scheduleInjection);
      window.addEventListener('scroll', scheduleInjection, { passive: true });
      setInterval(scheduleInjection, 1500);
    }

    // Rutube does not expose a stable action toolbar across its player layouts.
    // Add compact controls beside the player and let yt-dlp resolve the page.
    if (isHostOrSubdomain('rutube.ru')) {
      const injectRutubeButtons = () => {
        const player = document.querySelector('video, [class*="player"], [class*="Player"]');
        const container = player?.parentElement || document.body;
        if (!container) return;
        if (!document.querySelector('.soul-rutube-dl-btn')) {
          const button = document.createElement('button');
          button.className = 'soul-rutube-dl-btn';
          button.textContent = '⬇ Скачать MP4';
          button.title = 'Скачать видео Rutube в MP4';
          button.style.cssText = 'position:relative;z-index:2147483647;background:#f4511e;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:8px;';
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'rutube-video') + '.mp4',
              isAudio: false,
            });
            button.textContent = '✓ Скачивается';
            setTimeout(() => { button.textContent = '⬇ Скачать MP4'; }, 3000);
          };
          container.appendChild(button);
        }
        if (!document.querySelector('.soul-rutube-audio-dl-btn')) {
          const button = document.createElement('button');
          button.className = 'soul-rutube-audio-dl-btn';
          button.textContent = '♫ MP3';
          button.title = 'Скачать аудио Rutube в MP3';
          button.style.cssText = 'position:relative;z-index:2147483647;background:#fff;color:#f4511e;border:1px solid #f4511e;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;margin:8px 8px 8px 0;';
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'rutube-audio') + '.mp3',
              isAudio: true,
            });
            button.textContent = '✓ Скачивается';
            setTimeout(() => { button.textContent = '♫ MP3'; }, 3000);
          };
          container.appendChild(button);
        }
      };
      injectors.push(injectRutubeButtons);
      window.addEventListener('popstate', scheduleInjection);
    }

    if (injectors.length && typeof MutationObserver !== 'undefined' && document.body) {
      const observer = new MutationObserver(scheduleInjection);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    scheduleInjection();

    // 4. Video & Audio media detection for download button checkmark
    let lastMediaSignature = '';
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
        if (!hasVideo && (
          isHostOrSubdomain('youtube.com') ||
          isHostOrSubdomain('youtu.be') ||
          isHostOrSubdomain('rutube.ru') ||
          isVkHost ||
          isHostOrSubdomain('pinterest.com') ||
          isHostOrSubdomain('pinterest.ru')
        )) {
          hasVideo = true;
        }
        const signature = `${hasVideo ? '1' : '0'}:${hasAudio ? '1' : '0'}`;
        if (signature === lastMediaSignature) return;
        lastMediaSignature = signature;
        ipcRenderer.send('page:media-detected', { hasVideo, hasAudio });
      } catch {}
    };
    checkMedia();
    setInterval(checkMedia, 5000);

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
    if (isHostOrSubdomain('google.com') || isHostOrSubdomain('google.ru')) {
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
