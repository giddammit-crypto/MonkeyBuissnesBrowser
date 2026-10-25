# Acceptance matrix (October 25, 2026)

| Criterion | Status | Evidence |
|---|---|---|
| App source exists and TypeScript compiles | PASS | `npm run typecheck` |
| Main/preload/renderer separation | PASS | `src/main`, `src/preload`, `src/renderer` |
| Real WebContentsView browser tabs | PASS (local fixture scope) | `npm run test:e2e:smoke` launches Electron against the built application source; this is not a native installer test |
| URL/search omnibox and navigation policy | PASS | `tests/unit/omnibox.test.ts` |
| Back/forward/reload/stop | Automated fixture coverage | `scripts/electron-smoke.mjs`; external websites and platform-specific interaction still require manual checks |
| History/bookmarks/settings persistence | PASS (unit scope) | `tests/unit/persistence.test.ts` |
| Download flow | Automated fixture coverage; native desktop checks pending | Local tests cover save/progress, pause/resume/cancel and mode-scoped list clearing; real save dialogs, opening files and file-manager integration need target-OS checks |
| Private session isolation | PASS (local fixture scope) | Private tabs share a non-persistent session, cleared after its last tab closes. Tests cover mode isolation and persistence boundaries; full network anonymity is not claimed |
| AdBlock request interception | PASS (unit scope) | `FilterEngine` unit coverage; production list coverage is not claimed |
| EasyList/EasyPrivacy update pipeline | NOT TESTED | Not implemented |
| Memory metrics | PASS (implementation scope) | `MemoryManager` uses `app.getAppMetrics()`; no benchmark result yet |
| Hibernate / session restore | Automated fixture coverage | Memory exclusions, tab lifecycle and ordinary-session restoration are exercised by unit/Electron tests; no production memory benchmark is claimed |
| Real WireGuard tunnel | NOT IMPLEMENTED | Configuration import/validation only; no privileged tunnel backend |
| VPN settings import/validation | PASS (settings scope) | `.conf` import UI, secure-storage boundary, parser tests; no tunnel start |
| DNS/IPv6/WebRTC leak protection | NOT TESTED | Requires native tunnel and live network fixture |
| Kill switch | NOT IMPLEMENTED | No platform helper installed |
| Linux packaging | CI checks unpacked application | `npm run package` in GitHub Actions; AppImage/DEB installation and desktop integration require a separate manual target-OS run |
| Windows/macOS packaging and signing | CI checks unpacked applications; signing not implemented | GitHub Actions uses native runners for `npm run package`; installer behavior and real desktop integration are not established by compilation |
| Unit suite | Automated | Run `npm test` for the current test count and result; CI logs are the evidence for a specific commit |

## Verification boundaries

The current application is SOUL-M8TE Browser. Run `npm run check`, `npm run build` and `npm run test:e2e:smoke` against the commit under review. Local Electron tests use temporary profiles and synthetic HTTP/HTTPS pages; keyring and native dialog responses may be substituted inside those test processes. They do not verify real Google account sign-in, every website, a real system keyring on every OS, or signed installers.

Current UI checks also cover bookmark editing/deletion/undo, history-only clearing, tab search, the password-manager states and responsive light/dark layouts at 1440×900 and 920×640. Screenshot review supports visual findings for those captured states, not a claim of complete accessibility compliance or defect-free behavior.
