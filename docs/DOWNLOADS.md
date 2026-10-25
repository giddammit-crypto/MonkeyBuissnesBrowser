# Media downloads

SOUL-M8TE uses Electron's native download pipeline for user-initiated saves.

## How to use

1. Open a page with a publicly addressable image or HTML5 media element.
2. Right-click the image/video/audio.
3. Choose `Сохранить изображение`, `Сохранить видео` or `Сохранить аудио`.
4. Select a destination in the native save dialog.

The Downloads panel shows an item when the native download starts, reports received bytes and available total size, and keeps its final state after completion. If the server does not provide a total size, the percentage is unknown. Completed images receive a small local thumbnail; video and audio entries keep a media-type icon. A Downloads button is also available in the toolbar.

## Supported behavior

- For an image, video or audio element already identified by Chromium, its HTTP(S) source can be saved even when the URL has no filename extension, for example `/image?id=123`.
- Direct HTTP(S) image URLs: JPEG, PNG, GIF, WebP, AVIF, SVG and APNG.
- Direct HTTP(S) media URLs: MP4, WebM, OGV, M4V, MOV, MKV, AVI, MP3, OGG and WAV.
- For an arbitrary link, the save-media action is offered only when its URL points to a recognized media extension.
- The same flow can be used on Pinterest, YouTube, Rutube and VK when the page exposes a public direct media URL to Chromium.

## Managing downloads

Current downloads can be paused, resumed when supported by the server, or cancelled. A temporary interruption can remain resumable while its native DownloadItem is alive; a completed or terminally interrupted download is not restarted by the pause button.

Search filters by file name or source URL. `Очистить список` removes terminal entries for the currently selected ordinary/private mode and leaves files on disk. Live downloads are preserved. Opening a completed file and showing it in the system file manager depend on the destination still existing and the target operating system having the appropriate application.

Private download records are not written to the persistent download list. Files explicitly saved from private tabs remain on disk.

## Deliberate limits

A reachable HTTP(S) source does not guarantee that the server will allow downloading: authentication, response headers, expiry and network availability still apply. The browser does not extract or reconstruct media from platform pages, bypass DRM, defeat access controls, or merge segmented adaptive streams. YouTube/Rutube/VK players frequently expose a `blob:` URL, encrypted media, or segmented resources rather than a direct file; in that case the context menu reports that no direct file is available. Users should use the platform's own download/export controls or save content they are authorized to keep.
