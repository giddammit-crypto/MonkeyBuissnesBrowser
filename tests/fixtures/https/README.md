# Local HTTPS test fixture

`scripts/youtube-cookies-smoke.mjs` requires OpenSSL on PATH (provided by the Linux
CI runner). Each run generates a new disposable localhost key/certificate inside
its temporary profile and deletes both after completion. No key or certificate
is distributed in this repository or installed into a trust store.

Exact Google/YouTube fixture hostnames map to the local ephemeral HTTPS port via
Chromium test-only resolver rules; unmatched DNS fails. Certificate bypass applies
only to this isolated test process. Production never disables TLS validation.
No request is made to Google and no real account credentials are used.
