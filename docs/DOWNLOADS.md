# Media downloads

MonkeyBuissnesBrowser uses Electron's native download pipeline for user-initiated saves.

## How to use

1. Open a page with a publicly addressable image or HTML5 media element.
2. Right-click the image/video/audio.
3. Choose `Сохранить изображение`, `Сохранить видео` or `Сохранить аудио`.
4. Select a destination in the native save dialog.

The Downloads panel shows each item immediately, animates the progress while the file is being written, and keeps the final state after completion. Completed images receive a small local thumbnail; video and audio entries keep a media-type icon. A Downloads button is also available in the toolbar.

## Supported behavior

- Direct HTTP(S) image URLs: JPEG, PNG, GIF, WebP, AVIF, SVG and APNG.
- Direct HTTP(S) media URLs: MP4, WebM, OGV, M4V, MOV, MKV, AVI, MP3, OGG and WAV.
- Link saves for links that point directly to a recognized media extension.
- The same flow can be used on Pinterest, YouTube, Rutube and VK when the page exposes a public direct media URL to Chromium.

## Deliberate limits

The browser does not extract or reconstruct media from platform pages, bypass DRM, defeat access controls, or merge segmented adaptive streams. YouTube/Rutube/VK players frequently expose a `blob:` URL, encrypted media, or segmented resources rather than a direct file; in that case the context menu reports that no direct file is available. Users should use the platform's own download/export controls or save content they are authorized to keep.
