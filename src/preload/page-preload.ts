import { ipcRenderer, webFrame } from 'electron';
import type { ReaderArticle } from '../shared/types';

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
        // Inject native adaptive stylesheet once
        if (!document.getElementById('soul-yt-adaptive-styles')) {
          const style = document.createElement('style');
          style.id = 'soul-yt-adaptive-styles';
          style.textContent = `
            .soul-yt-chip-btn {
              display: inline-flex !important;
              align-items: center !important;
              justify-content: center !important;
              gap: 6px !important;
              height: 36px !important;
              padding: 0 14px !important;
              border-radius: 18px !important;
              border: none !important;
              font-family: "Roboto", "Arial", sans-serif !important;
              font-size: 14px !important;
              font-weight: 500 !important;
              line-height: 36px !important;
              cursor: pointer !important;
              margin-left: 8px !important;
              user-select: none !important;
              box-sizing: border-box !important;
              background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.1)) !important;
              color: var(--yt-spec-text-primary, #f1f1f1) !important;
              transition: background-color 0.2s cubic-bezier(0.05, 0, 0, 1), transform 0.1s ease !important;
              white-space: nowrap !important;
              flex-shrink: 0 !important;
              text-decoration: none !important;
              vertical-align: middle !important;
            }
            .soul-yt-chip-btn:hover {
              background: var(--yt-spec-button-chip-background-hover, rgba(255, 255, 255, 0.2)) !important;
            }
            .soul-yt-chip-btn:active {
              transform: scale(0.97) !important;
            }
            .soul-yt-chip-btn svg {
              display: inline-block !important;
              vertical-align: middle !important;
              flex-shrink: 0 !important;
              width: 18px !important;
              height: 18px !important;
              fill: currentColor !important;
            }
            .soul-yt-shorts-dl-btn,
            .soul-yt-shorts-audio-btn {
              display: inline-flex !important;
              align-items: center !important;
              justify-content: center !important;
              gap: 5px !important;
              min-height: 36px !important;
              padding: 6px 14px !important;
              border-radius: 18px !important;
              border: 1px solid rgba(255, 255, 255, 0.2) !important;
              font-family: "Roboto", "Arial", sans-serif !important;
              font-size: 13px !important;
              font-weight: 500 !important;
              cursor: pointer !important;
              margin: 4px 0 !important;
              user-select: none !important;
              box-sizing: border-box !important;
              background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.15)) !important;
              backdrop-filter: blur(8px) !important;
              -webkit-backdrop-filter: blur(8px) !important;
              color: var(--yt-spec-text-primary, #ffffff) !important;
              transition: background-color 0.15s ease, transform 0.1s ease !important;
            }
            .soul-yt-shorts-dl-btn:hover,
            .soul-yt-shorts-audio-btn:hover {
              background: var(--yt-spec-button-chip-background-hover, rgba(255, 255, 255, 0.25)) !important;
              transform: scale(1.03) !important;
            }
            .soul-yt-shorts-dl-btn svg,
            .soul-yt-shorts-audio-btn svg {
              display: inline-block !important;
              vertical-align: middle !important;
              flex-shrink: 0 !important;
              width: 16px !important;
              height: 16px !important;
              fill: currentColor !important;
            }
          `;
          (document.head || document.documentElement).appendChild(style);
        }

        // Standard video target (action bar under video)
        const targetContainer = document.querySelector(
          '#actions #top-level-buttons-computed, #top-level-buttons-computed, ytd-watch-metadata #actions, #actions.ytd-watch-metadata, #actions, #top-row, #owner'
        );
        if (targetContainer && !document.querySelector('.soul-yt-dl-btn')) {
          const btn = document.createElement('button');
          btn.className = 'soul-yt-chip-btn soul-yt-dl-btn';
          btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>Скачать MP4</span>';
          btn.title = 'Скачать видео в MP4 (высокое качество)';
          btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-video') + '.mp4',
            });
            btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Скачивается</span>';
            setTimeout(() => {
              btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>Скачать MP4</span>';
            }, 3000);
          };
          targetContainer.appendChild(btn);
        }
        if (targetContainer && !document.querySelector('.soul-yt-audio-dl-btn')) {
          const audioBtn = document.createElement('button');
          audioBtn.className = 'soul-yt-chip-btn soul-yt-audio-dl-btn';
          audioBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
          audioBtn.title = 'Скачать аудиодорожку в MP3';
          audioBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('page:download-media', {
              url: window.location.href,
              filename: (document.title.replace(/[\\/:*?"<>|]/g, '') || 'youtube-audio') + '.mp3',
              isAudio: true,
            });
            audioBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Скачивается</span>';
            setTimeout(() => {
              audioBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
            }, 3000);
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
              shortsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>MP4</span>';
              shortsBtn.title = 'Скачать Shorts в высоком качестве (MP4)';
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
                shortsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Загрузка</span>';
                setTimeout(() => {
                  shortsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5.1z"/></svg><span>MP4</span>';
                }, 3000);
              };
              reelActions.appendChild(shortsBtn);
            }

            if (reelActions && !reelActions.querySelector('.soul-yt-shorts-audio-btn')) {
              const shortsAudioBtn = document.createElement('button');
              shortsAudioBtn.className = 'soul-yt-shorts-audio-btn';
              shortsAudioBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
              shortsAudioBtn.title = 'Скачать звук Shorts в MP3';
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
                shortsAudioBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>Загрузка</span>';
                setTimeout(() => {
                  shortsAudioBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg><span>MP3</span>';
                }, 3000);
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
    const hasValidVideoSource = (v: HTMLVideoElement): boolean => {
      try {
        if (v.src && v.src.trim() !== '' && !v.src.startsWith('blob:null')) return true;
        if (v.currentSrc && v.currentSrc.trim() !== '') return true;
        if (v.querySelector('source[src], source[srcset]')) return true;
        if (v.readyState > 0 || v.duration > 0 || !v.paused) return true;
        return false;
      } catch {
        return false;
      }
    };

    let lastMediaSignature = '';
    const checkMedia = () => {
      try {
        const videos = document.getElementsByTagName('video');
        let hasVideo = false;
        for (let i = 0; i < videos.length; i++) {
          const v = videos[i];
          if (v && hasValidVideoSource(v)) {
            hasVideo = true;
            break;
          }
        }
        const audios = document.getElementsByTagName('audio');
        let hasAudio = false;
        for (let i = 0; i < audios.length; i++) {
          const a = audios[i];
          if (a && (a.src || a.currentSrc || !a.paused || a.duration > 0 || a.readyState > 0)) {
            hasAudio = true;
            break;
          }
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

    // 6. Native Video, Picture-in-Picture & Speed Controller (Chrome & Yandex Flagship)
    let lastVideoPresence: boolean | undefined;

    const findVideos = (root: Document | ShadowRoot | Element): HTMLVideoElement[] => {
      const list: HTMLVideoElement[] = [];
      if (!root) return list;
      try {
        if ('querySelectorAll' in root) {
          list.push(...Array.from(root.querySelectorAll('video')));
          const all = root.querySelectorAll('*');
          for (let i = 0; i < all.length; i++) {
            const sr = all[i].shadowRoot;
            if (sr) list.push(...findVideos(sr));
          }
        }
      } catch {}
      return list;
    };

    const checkVideo = () => {
      try {
        const videos = findVideos(document);
        const hasVideo = videos.some(hasValidVideoSource);
        if (hasVideo !== lastVideoPresence) {
          lastVideoPresence = hasVideo;
          ipcRenderer.send('page:video-detected', { hasVideo });
        }
      } catch {}
    };

    checkVideo();
    setInterval(checkVideo, 2500);
    document.addEventListener('play', checkVideo, true);
    document.addEventListener('playing', checkVideo, true);
    document.addEventListener('loadeddata', checkVideo, true);
    document.addEventListener('pause', checkVideo, true);
    document.addEventListener('ended', checkVideo, true);
    document.addEventListener('emptied', checkVideo, true);
    document.addEventListener('suspend', checkVideo, true);
    try {
      const observer = new MutationObserver(() => checkVideo());
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch {}

    const togglePip = async (): Promise<{ success: boolean; isPip: boolean }> => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          ipcRenderer.send('page:pip-changed', { isPip: false });
          return { success: true, isPip: false };
        }
        const videos = findVideos(document);
        if (!videos.length) return { success: false, isPip: false };
        const playing = videos.filter((v) => !v.paused && v.readyState > 0);
        let target = playing.find((v) => v.currentTime > 0) || playing[0];
        if (!target) {
          videos.sort((a, b) => {
            const rA = a.getBoundingClientRect();
            const rB = b.getBoundingClientRect();
            return (rB.width * rB.height) - (rA.width * rA.height);
          });
          target = videos[0];
        }
        if (target && typeof target.requestPictureInPicture === 'function') {
          try {
            target.removeAttribute('disablePictureInPicture');
            target.disablePictureInPicture = false;
          } catch {}
          await target.requestPictureInPicture();
          ipcRenderer.send('page:pip-changed', { isPip: true });
          return { success: true, isPip: true };
        }
        return { success: false, isPip: false };
      } catch {
        return { success: false, isPip: Boolean(document.pictureInPictureElement) };
      }
    };

    if (typeof ipcRenderer?.on === 'function') {
      ipcRenderer.on('tab:toggle-pip', async () => {
        await togglePip();
      });
    }

    document.addEventListener('enterpictureinpicture', () => {
      ipcRenderer.send('page:pip-changed', { isPip: true });
    }, true);
    document.addEventListener('leavepictureinpicture', () => {
      ipcRenderer.send('page:pip-changed', { isPip: false });
    }, true);

    // In-page Floating PiP Overlay (Яндекс.Браузер стиль)
    const setupVideoHoverOverlay = () => {
      let pipButton: HTMLButtonElement | null = null;
      let activeVideo: HTMLVideoElement | null = null;
      let hideTimer: any = null;

      const createPipButton = () => {
        if (pipButton && pipButton.isConnected) return pipButton;
        const btn = document.createElement('button');
        btn.id = 'soulm8te-video-pip-btn';
        btn.setAttribute('aria-label', 'Смотреть в отдельном окне (PiP)');
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;">
            <rect width="18" height="14" x="3" y="5" rx="2"/>
            <path d="M21 9v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9"/>
            <rect width="8" height="6" x="11" y="11" rx="1" fill="currentColor"/>
          </svg>
          <span>Вынести видео</span>
        `;
        Object.assign(btn.style, {
          position: 'fixed',
          zIndex: '2147483647',
          display: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 14px',
          background: 'rgba(15, 23, 42, 0.90)',
          color: '#ffffff',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '12px',
          fontWeight: '600',
          letterSpacing: '0.02em',
          border: '1px solid rgba(255, 255, 255, 0.22)',
          borderRadius: '9999px',
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45), 0 0 12px rgba(56, 189, 248, 0.3)',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          transition: 'all 0.16s ease',
          pointerEvents: 'auto',
          userSelect: 'none',
        });

        btn.onmouseenter = () => {
          clearTimeout(hideTimer);
          btn.style.background = '#2563eb';
          btn.style.borderColor = '#38bdf8';
          btn.style.transform = 'translateX(-50%) scale(1.05)';
        };

        btn.onmouseleave = () => {
          btn.style.background = 'rgba(15, 23, 42, 0.90)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.22)';
          btn.style.transform = 'translateX(-50%) scale(1)';
          scheduleHide();
        };

        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!activeVideo) return;
          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
              ipcRenderer.send('page:pip-changed', { isPip: false });
            } else {
              activeVideo.removeAttribute('disablePictureInPicture');
              activeVideo.disablePictureInPicture = false;
              await activeVideo.requestPictureInPicture();
              ipcRenderer.send('page:pip-changed', { isPip: true });
            }
          } catch (err) {
            console.error('PiP error:', err);
          }
        };

        (document.fullscreenElement || document.body || document.documentElement).appendChild(btn);
        pipButton = btn;
        return btn;
      };

      const positionButton = (video: HTMLVideoElement) => {
        const btn = createPipButton();
        const rect = video.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 90 || rect.bottom < 0 || rect.top > window.innerHeight) {
          btn.style.display = 'none';
          return;
        }

        const top = Math.max(12, rect.top + 14);
        const left = rect.left + (rect.width / 2);
        btn.style.top = `${top}px`;
        btn.style.left = `${left}px`;
        btn.style.transform = 'translateX(-50%)';
        btn.style.display = 'inline-flex';
      };

      const scheduleHide = () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (pipButton) pipButton.style.display = 'none';
        }, 1200);
      };

      document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target instanceof HTMLVideoElement) {
          activeVideo = target;
          clearTimeout(hideTimer);
          positionButton(target);
        } else if (target instanceof Element && target.closest('#soulm8te-video-pip-btn')) {
          clearTimeout(hideTimer);
        } else if (activeVideo) {
          scheduleHide();
        }
      }, true);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupVideoHoverOverlay, { once: true });
    } else {
      setupVideoHoverOverlay();
    }

    // Video Speed Controller Hotkeys (Chrome Extension Standard: [, ], \, z, x)
    document.addEventListener('keydown', (e) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const videos = findVideos(document);
      const playing = videos.find((v) => !v.paused && v.readyState > 0) || videos[0];
      if (!playing) return;

      const showToast = (text: string) => {
        let toast = document.getElementById('soulm8te-video-hud');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'soulm8te-video-hud';
          Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: '2147483647',
            padding: '6px 14px',
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#38bdf8',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '13px',
            fontWeight: '700',
            borderRadius: '8px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'none',
            transition: 'opacity 0.2s ease',
          });
          document.body.appendChild(toast);
        }
        toast.textContent = text;
        toast.style.opacity = '1';
        clearTimeout((toast as any).__timer);
        (toast as any).__timer = setTimeout(() => {
          if (toast) toast.style.opacity = '0';
        }, 1200);
      };

      if (e.key === ']') {
        playing.playbackRate = Math.min(4.0, Math.round((playing.playbackRate + 0.25) * 100) / 100);
        showToast(`Скорость: ${playing.playbackRate}x`);
      } else if (e.key === '[') {
        playing.playbackRate = Math.max(0.25, Math.round((playing.playbackRate - 0.25) * 100) / 100);
        showToast(`Скорость: ${playing.playbackRate}x`);
      } else if (e.key === '\\') {
        playing.playbackRate = 1.0;
        showToast('Скорость: 1.0x');
      } else if (e.key === 'z' || e.key === 'я') {
        playing.currentTime = Math.max(0, playing.currentTime - 10);
        showToast('-10 сек');
      } else if (e.key === 'x' || e.key === 'ч') {
        playing.currentTime = Math.min(playing.duration || Infinity, playing.currentTime + 10);
        showToast('+10 сек');
      }
    });

    // 7. Reader Mode Availability Detector
    let lastReaderAvailable: boolean | undefined;

    const isExcludedFromReader = (urlStr: string): boolean => {
      try {
        if (!urlStr) return true;
        const url = new URL(urlStr);
        if (['browser:', 'about:', 'chrome:', 'data:', 'javascript:'].includes(url.protocol)) return true;
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        // Search engines
        if (
          host === 'google.com' || host.endsWith('.google.com') ||
          host === 'google.ru' || host.endsWith('.google.ru') ||
          host === 'yandex.ru' || host.endsWith('.yandex.ru') ||
          host === 'yandex.com' || host.endsWith('.yandex.com') ||
          host === 'ya.ru' ||
          host === 'bing.com' || host.endsWith('.bing.com') ||
          host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com') ||
          host === 'baidu.com' || host.endsWith('.baidu.com') ||
          host === 'yahoo.com' || host.endsWith('.yahoo.com')
        ) {
          return true;
        }
        // Social networks & feeds & media sharing
        if (
          host === 'vk.com' || host.endsWith('.vk.com') || host === 'vkvideo.ru' ||
          host === 'twitter.com' || host === 'x.com' ||
          host === 'facebook.com' || host.endsWith('.facebook.com') ||
          host === 'instagram.com' || host.endsWith('.instagram.com') ||
          host === 'reddit.com' || host.endsWith('.reddit.com') ||
          host === 'tiktok.com' || host.endsWith('.tiktok.com') ||
          host.includes('pinterest.')
        ) {
          return true;
        }
        // Video hostings & streaming
        if (
          host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' ||
          host === 'rutube.ru' || host.endsWith('.rutube.ru') ||
          host === 'twitch.tv' || host.endsWith('.twitch.tv') ||
          host === 'vimeo.com' || host.endsWith('.vimeo.com') ||
          host === 'dailymotion.com' || host.endsWith('.dailymotion.com')
        ) {
          return true;
        }
        // Webmail & messengers
        if (
          host === 'mail.google.com' || host === 'mail.ru' || host.endsWith('.mail.ru') ||
          host === 'mail.yandex.ru' || host === 'outlook.live.com' || host === 'outlook.office.com' ||
          host === 'web.telegram.org' || host === 'web.whatsapp.com'
        ) {
          return true;
        }
        // Homepages / root URLs without article path
        if ((url.pathname === '/' || url.pathname === '') && !url.search) {
          return true;
        }
        return false;
      } catch {
        return true;
      }
    };

    const checkReaderStatus = () => {
      try {
        const href = window.location.href;
        if (isExcludedFromReader(href)) {
          if (lastReaderAvailable !== false) {
            lastReaderAvailable = false;
            ipcRenderer.send('page:reader-status', { available: false });
          }
          return;
        }

        let available = false;
        const article = document.querySelector('article');
        const articleText = (article?.textContent || '').trim();
        if (article && articleText.length > 500) {
          available = true;
        } else {
          const main = document.querySelector('main, [role="main"]');
          const mainText = (main?.textContent || '').trim();
          if (main && mainText.length > 500) {
            available = true;
          } else {
            const paragraphs = document.querySelectorAll('p');
            let totalLength = 0;
            let longParagraphCount = 0;
            for (let i = 0; i < paragraphs.length; i++) {
              const text = (paragraphs[i].textContent || '').trim();
              if (text.length > 50) {
                longParagraphCount++;
                totalLength += text.length;
              }
              if (longParagraphCount >= 3 && totalLength > 500) {
                available = true;
                break;
              }
            }
          }
        }

        if (available !== lastReaderAvailable) {
          lastReaderAvailable = available;
          ipcRenderer.send('page:reader-status', { available });
        }
      } catch {}
    };
    checkReaderStatus();
    setInterval(checkReaderStatus, 4000);
    window.addEventListener('popstate', checkReaderStatus);

    // 8. Reader Article Extractor
    const extractReaderArticle = (): ReaderArticle | null => {
      try {
        const title =
          document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
          document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')?.trim() ||
          document.querySelector('h1')?.textContent?.trim() ||
          document.title ||
          'Статья';

        const byline =
          document.querySelector('meta[name="author"]')?.getAttribute('content')?.trim() ||
          document.querySelector('meta[property="article:author"]')?.getAttribute('content')?.trim() ||
          document.querySelector('[rel="author"], .byline, .author, .entry-author')?.textContent?.trim() ||
          undefined;

        const publishedTime =
          document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.trim() ||
          document.querySelector('time')?.getAttribute('datetime')?.trim() ||
          document.querySelector('time')?.textContent?.trim() ||
          undefined;

        const siteName =
          document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
          window.location.hostname ||
          undefined;

        const excerpt =
          document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
          document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
          undefined;

        let rootEl: Element | null = document.querySelector('article');
        if (!rootEl || (rootEl.textContent || '').trim().length < 200) {
          rootEl = document.querySelector('main, [role="main"], .post-content, .article-body, .entry-content');
        }
        if (!rootEl) {
          const candidates = Array.from(document.querySelectorAll('div, section'));
          let maxScore = 0;
          let bestCandidate: Element | null = null;
          for (const el of candidates) {
            const ps = el.querySelectorAll('p');
            if (ps.length >= 2) {
              let score = 0;
              for (const p of Array.from(ps)) score += (p.textContent || '').trim().length;
              if (score > maxScore) {
                maxScore = score;
                bestCandidate = el;
              }
            }
          }
          rootEl = bestCandidate || document.body;
        }

        if (!rootEl) return null;

        const clone = rootEl.cloneNode(true) as HTMLElement;
        const removeSelectors = [
          'script', 'style', 'noscript', 'iframe', 'frame', 'object', 'embed',
          'form', 'input', 'button', 'select', 'textarea',
          'nav', 'header', 'footer', 'aside',
          '.ad', '.ads', '.advertisement', '.banner', '.social-share',
          '[aria-hidden="true"]', 'svg'
        ];
        for (const sel of removeSelectors) {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        }

        const allEls = clone.querySelectorAll('*');
        for (const el of Array.from(allEls)) {
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith('on') || attr.name === 'style') {
              el.removeAttribute(attr.name);
            }
          }
          if (el instanceof HTMLImageElement) {
            const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-original');
            if (dataSrc) el.src = dataSrc;
            if (el.src) el.setAttribute('src', el.src);
            el.removeAttribute('srcset');
          }
          if (el instanceof HTMLAnchorElement && el.href) {
            el.setAttribute('href', el.href);
          }
        }

        const cleanedHtml = clone.innerHTML.trim();
        const textContent = clone.textContent?.trim() || '';
        const words = textContent ? textContent.split(/\s+/).filter(Boolean).length : 0;
        const readingTimeMinutes = Math.max(1, Math.round(words / 200));
        const lang =
          document.documentElement.lang?.trim() ||
          document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content')?.trim() ||
          'ru';

        return {
          title,
          byline,
          publishedTime,
          siteName,
          excerpt,
          content: cleanedHtml,
          textContent,
          length: textContent.length,
          readingTimeMinutes,
          lang,
        };
      } catch {
        return null;
      }
    };

    if (typeof ipcRenderer?.on === 'function') {
      ipcRenderer.on('tab:extract-reader-article', (_event, replyChannel?: string) => {
        const article = extractReaderArticle();
        if (replyChannel) {
          ipcRenderer.send(replyChannel, article);
        } else {
          ipcRenderer.send('page:reader-article-extracted', article);
        }
      });
    }

    (window as unknown as { __extractReaderArticle?: () => ReaderArticle | null }).__extractReaderArticle = extractReaderArticle;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMediaHelper, { once: true });
  } else {
    initMediaHelper();
  }
}
