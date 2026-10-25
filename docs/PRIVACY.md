# Private and anonymous browsing mode

The browser's **anonymous tab** is an ephemeral Chromium session:

- it uses a non-persistent session partition;
- its history is not written to the browser history store;
- cookies, local storage, IndexedDB, service workers and cache data are cleared when the tab closes;
- WebRTC is configured with `disable_non_proxied_udp` for the private tab;
- camera, microphone, geolocation and notification permission requests remain denied by default.

This is local privacy protection, not network anonymity. The tab does not hide the IP address from a website or the network provider, does not provide Tor routing, and does not replace a real VPN. The UI intentionally says this explicitly so that private mode is not mistaken for an anonymous network.

Shortcut: `Ctrl+Shift+P` on Linux/Windows, or `Cmd+Shift+P` on macOS.
