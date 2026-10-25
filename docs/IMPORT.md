# Browser profile import

The Settings page includes a local import wizard for detected profiles of:

- Google Chrome;
- Яндекс Браузер;
- Firefox.

The wizard imports history, bookmarks, cookies and passwords from a selected profile without uploading profile files or secrets to a server.

## Storage details

- Chromium history/bookmarks are read from the profile's SQLite/JSON files.
- Firefox history/bookmarks are read from `places.sqlite`.
- Firefox cookies are imported from `cookies.sqlite` when they are readable.
- Chromium cookies and passwords are decrypted only when the browser's Linux keyring entry is available through `secret-tool` and the value uses a supported `v10`/`v11` format.
- Imported passwords are stored only in an Electron `safeStorage`-encrypted local vault. Password values are never sent to the renderer or returned through IPC.
- Firefox NSS-encrypted passwords and platform-specific Windows/macOS browser secrets are reported as skipped until a native OS decryption adapter is added. The wizard does not guess or silently import unusable encrypted blobs.

The importer is intentionally local and conservative: locked databases, unavailable keyrings and unsupported encryption result in a warning rather than data loss or fake success.
