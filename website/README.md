# soulm8te website

The supplied landing-page artwork, layout and interactive browser illustration are retained. Product copy and downloads refer to the public MonkeyBuissnesBrowser project.

## Build

Use Node.js 24 or later:

```sh
npm ci
npm run build
```

`build` checks TypeScript, runs the release-metadata boundary tests and produces a static `dist/` directory. GitHub Pages should deploy that directory. Vite uses `/MonkeyBuissnesBrowser/` as its base; the generated single-file HTML keeps the public hero image and favicon relative to the page.

The only added development host allowance is `terminal.local`, for the managed preview. There is no wildcard host allowance.

## Downloads

The site requests the public GitHub `releases/latest` API once per visit, with an eight-second deadline. Only stable, valid version metadata and HTTPS release links in the expected GitHub repository are accepted. Only x86_64/amd64 DEB and AppImage assets are offered.

If GitHub is unavailable or rate-limited, the verified public 1.0.1 links remain available with a stable-build fallback label. A missing asset in a valid newer release is shown as unavailable; it is not silently replaced by an older installer. Release notes, all releases and SHA256SUMS links are available.

## Content and privacy

Russian and English are supported. Language preference is stored locally when browser storage is available. There is no email collection, signup backend, Plus plan, invented testimonial or claimed Windows/macOS download. Voodoo's optional external API provider is described explicitly. The browser illustration is labeled as a design preview.

The original Google Fonts stylesheet remains a third-party font request. The release lookup contacts GitHub. No analytics code was added.
