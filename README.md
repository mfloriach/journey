# journey-sitemap

One-shot installer for the `/sitemap` opencode command. Scaffolds a Playwright crawler + interactive viewer in any app.

## Use

```sh
npm i -D journey-sitemap
```

Installing as a devDependency auto-installs via `postinstall` (no extra
command). If your npm blocks install scripts, approve once then rebuild:

```sh
npm install-scripts approve journey-sitemap && npm rebuild journey-sitemap
```

Fallback (any npm, no install needed):

```sh
npx journey-sitemap          # install (skips existing files)
npx journey-sitemap --force  # overwrite
```

Installs into the app you run it in (cwd):

- `.opencode/commands/sitemap.md` — opencode command
- `.opencode/scripts/shoot.ts` — crawler (needs `playwright`/`@playwright/test` + `tsx` in target app)
- `.opencode/templates/sitemap.html` — viewer template
- `sitemap/` — crawl output dir

Then in opencode: `/sitemap`. Or headless:

```sh
BASE_URL=http://localhost:3000 npx tsx .opencode/scripts/shoot.ts
WALLET=connect|full BASE_URL=... npx tsx .opencode/scripts/shoot.ts
```

Output: `sitemap/sitemap.html`, `sitemap/sitemap-data.js`, `sitemap/sitemap.json`, `sitemap/shots/*.png`. Open the HTML via `file://` or any static server.
