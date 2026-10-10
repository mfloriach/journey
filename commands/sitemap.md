---
description: Create a sidemap of the application
---

Store the data in the root of the project by creating a folder called `sitemap`

- store `sidemap.html` and `sidemap-data.js`
- add folder inside called `shots` and add pictures there.

# Steps

1. Using BFS and playwright navigate the app.
2. Store every node as screenshots and the relationships in a file called `sidemap-data.js`
3. Create a `sidemap.html` to see the results in a canvas from left to right avoid overlapping between images.
4. Canvas must be able to zoom in and out and move the nodes.
5. Wallet: `WALLET=connect npx tsx .opencode/scripts/shoot.ts` — injects `e2e/wallet-stub.js` (`window.ethereum`) and clicks Connect wallet on each page before crawling, so wallet-gated buttons (create actions) are enabled and discovered. Records `node.auth` (public vs needs-wallet). `WALLET=full` adds real SIWE login + one `[crawler]`-marked form submit per form (writes test records).
6. Forms: on every page the crawler fills all inputs (read-only, no submit), and under `WALLET=full` submits each visible form once, screenshots the result (success panel, modal, or landing page) to `sitemap/shots/<page>-s<N>.png`, and refreshes `sitemap/sidemap-data.js` with the new `node.states` and edges.
7. View: open `sitemap/sidemap.html` directly (double-click works — data is inlined via `sitemap-data.js`) or serve the repo root (`python3 -m http.server 8321`) and open `http://127.0.0.1:8321/sitemap/sidemap.html`.
