# Windows desktop shell

This directory is an intentionally thin Electron host. The root Web source remains the only product authority:

`root source -> root dist/ -> electron-builder extraResources/web -> app://knowledge-ball`

The shell adds no UI or product APIs. It uses an isolated, sandboxed renderer with Node integration disabled, blocks in-window navigation away from its private origin, and sends intentional HTTP(S)/mailto links to the operating system.

## Reproduce

From the repository root, run `npm ci && npm run build`. Then run `npm ci` and `npm run package` here on Windows. `npm run test:assets` compares sorted paths, byte lengths, and SHA-256 hashes for every root `dist/` and packaged `resources/web` file. `npm run test:runtime` launches the unpacked executable, exercises the real controls/WebGL shell, and compares a fixed 1440×900 frame with a second Chromium renderer of the same packaged build. More than 0.5% differing pixels fails.

Generated installers, executables, and screenshots live under ignored `windows/release/` and `windows/artifacts/`; CI publishes them instead of committing binaries.
