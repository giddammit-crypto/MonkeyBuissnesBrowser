# Acceptance matrix (October 25, 2026)

| Criterion | Status | Evidence |
|---|---|---|
| App source exists and TypeScript compiles | PASS | `npm run typecheck` |
| Main/preload/renderer separation | PASS | `src/main`, `src/preload`, `src/renderer` |
| Real WebContentsView browser tabs | PASS (smoke) | `npm run test:e2e:smoke` against packaged Linux app |
| URL/search omnibox and navigation policy | PASS | `tests/unit/omnibox.test.ts` |
| Back/forward/reload/stop | PARTIAL | Implemented with `navigationHistory`; packaged smoke covers navigation, manual controls still needed |
| History/bookmarks/settings persistence | PASS (unit scope) | `tests/unit/persistence.test.ts` |
| Download flow | PARTIAL | Native `will-download`, persistence, progress UI and open/show actions implemented; interactive save-dialog run still needed |
| Private session isolation | PASS (implementation scope) | Non-persistent per-tab partition, data clearing on close, WebRTC restriction; live leak fixture still pending |
| AdBlock request interception | PASS (unit scope) | `FilterEngine` unit coverage; production list coverage is not claimed |
| EasyList/EasyPrivacy update pipeline | NOT TESTED | Not implemented |
| Memory metrics | PASS (implementation scope) | `MemoryManager` uses `app.getAppMetrics()`; no benchmark result yet |
| Hard hibernate / restore | NOT TESTED | Lifecycle registry exists; full restore path is not yet exposed |
| Real WireGuard tunnel | NOT TESTED | Parser only; no privileged backend or peer config |
| VPN settings import/validation | PASS (settings scope) | `.conf` import UI, secure-storage boundary, parser tests; no tunnel start |
| DNS/IPv6/WebRTC leak protection | NOT TESTED | Requires native tunnel and live network fixture |
| Kill switch | NOT TESTED | No platform helper installed |
| Linux packaging | PASS | `npm run dist:linux` produced AppImage and DEB |
| Windows/macOS installers and signing | NOT TESTED | Native runners and signing credentials unavailable |
| Unit suite | PASS | `npm test` — 21 tests passed |
