# WireGuard integration boundary

## Current state

The browser now has a real VPN settings surface. A user can import a `.conf` file, validate keys/addresses/MTU/endpoint/hooks, inspect redacted profile metadata, replace the profile, or remove it. Private key material never enters the React snapshot. When Electron reports a usable OS-backed `safeStorage`, the raw configuration is encrypted before persistence; otherwise the UI explicitly reports that the profile is session-only.

The repository also contains a platform-neutral WireGuard configuration parser. It validates keys, addresses, peers, allowed IPs, MTU and endpoints, and rejects `PostUp`, `PostDown`, `PreUp`, and `PreDown` hooks so an imported profile cannot execute arbitrary commands.

No tunnel is started by the Electron app today. There is no provider endpoint, peer credential, privileged helper, route operation, DNS operation, kill switch, or public-IP verification in this workspace.

## Required production shape

```text
React UI
  -> trusted preload + typed IPC
  -> unprivileged coordinator
  -> platform backend
      Linux: root-owned helper / D-Bus or controlled netlink integration
      Windows: signed WireGuard embeddable service
      macOS: signed Network Extension Packet Tunnel Provider
```

Private keys must stay in the OS-backed secure store or the native backend. The renderer must only receive redacted status and non-secret metrics.

## Verification gates

Before any UI can say `Connected`, the backend must provide evidence for:

1. Interface and handshake state.
2. Actual traffic transfer.
3. Route selection and endpoint exception route.
4. DNS behavior, including browser secure-DNS policy.
5. IPv4 and IPv6 behavior.
6. WebRTC ICE candidate exposure.
7. Tunnel stop/crash behavior and direct-traffic policy.
8. Reconnect after network transitions.

The product must distinguish routing-only, DNS-protected, best-effort kill switch, and verified kill switch. This project currently claims none of those states.
