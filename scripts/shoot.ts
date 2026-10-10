import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium, type Locator } from "@playwright/test";
import { walletStubScript } from "../../e2e/wallet-stub.js";
import { loginViaSiwe } from "../../e2e/helpers.js";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WALLET = process.env.WALLET ?? ""; // "connect": stub + click; "full": + real SIWE login + form submits (writes!)
const walletOn = WALLET === "connect" || WALLET === "full";
const URLS_JSON = "sidemap.json";
const SHOTS_DIR = ".opencode/commands/shots";
const VIEW_DIR = ".opencode/commands/view";

const slug = (url: string) =>
  url
    .replace(/\[|\]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "") || "index";

async function main() {
  const parsed = JSON.parse(readFileSync(URLS_JSON, "utf8"));
  const raw: (string | { url: string })[] = Array.isArray(parsed)
    ? parsed
    : parsed.nodes;
  const urls = raw
    .map((e) => (typeof e === "string" ? e : e.url))
    .filter((u) => !u.includes("#")); // modal nodes are re-discovered, not visited
  // BFS visit order from "/", using the previous crawl's edges when present
  // (first run falls back to alphabetical)
  const bfsOrder = (list: string[]) => {
    const prev = Array.isArray(parsed) ? null : (parsed.edges ?? []);
    const adj = new Map(list.map((u) => [u, [] as string[]]));
    for (const e of prev) {
      if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from)!.push(e.to);
    }
    const order: string[] = [];
    const seenBfs = new Set<string>([list[0]]);
    const q = [list[0]];
    while (q.length) {
      const u = q.shift()!;
      order.push(u);
      for (const v of adj.get(u) ?? []) {
        if (!seenBfs.has(v)) {
          seenBfs.add(v);
          q.push(v);
        }
      }
    }
    for (const u of list) if (!seenBfs.has(u)) order.push(u);
    return order;
  };
  const ordered = bfsOrder(urls);

  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(VIEW_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ baseURL: BASE })
    .then((c) => c.newPage()); // baseURL: helpers call /api/* relatively
  // HTTP log per node: same-origin JSON endpoints only (no pages, images,
  // fonts, css), bodies truncated for readability.
  type HttpCall = {
    method: string;
    url: string;
    status: number;
    reqHeaders: Record<string, string>;
    reqBody: string | null;
    cookies: Record<string, string>; // jar state when sent (browser hides Cookie header)
    resHeaders: Record<string, string>;
    setCookies: string[]; // raw Set-Cookie values returned
    resBody: string;
  };
  const MAX_BODY = 4000;
  let recording = false;
  let traffic: HttpCall[] = [];
  const cookieJar = new Map<string, string>(); // persists across visits: one browser context
  let chain: Promise<void> = Promise.resolve(); // serialize: jar deltas stay ordered
  page.on("response", (res) => {
    if (!recording) return;
    const req = res.request();
    const rt = req.resourceType();
    if (rt !== "document" && rt !== "fetch" && rt !== "xhr") return;
    try {
      if (new URL(req.url()).origin !== new URL(BASE).origin) return;
    } catch {
      return;
    }
    chain = chain
      .then(async () => {
        if (!recording) return;
        let resBody = "";
        try {
          const ct = res.headers()["content-type"] ?? "";
          if (!ct.includes("json")) return; // endpoints only: skip HTML/pages
          const text = await res.text();
          resBody =
            text.length > MAX_BODY
              ? text.slice(0, MAX_BODY) +
                `\n…[truncated ${text.length - MAX_BODY} chars]`
              : text;
        } catch {
          resBody = "<unreadable>";
        }
        let reqBody: string | null = null;
        try {
          reqBody = req.postData();
        } catch {
          reqBody = null;
        }
        if (reqBody && reqBody.length > MAX_BODY)
          reqBody = reqBody.slice(0, MAX_BODY) + "…[truncated]";
        const cookies = Object.fromEntries(cookieJar);
        const setCookies = (await res.headersArray())
          .filter((h) => h.name.toLowerCase() === "set-cookie")
          .map((h) => h.value);
        for (const sc of setCookies) {
          const pair = sc.split(";")[0];
          const eq = pair.indexOf("=");
          if (eq > 0) {
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (value) cookieJar.set(name, value);
            else cookieJar.delete(name);
          }
        }
        traffic.push({
          method: req.method(),
          url: req.url(),
          status: res.status(),
          reqHeaders: req.headers(),
          reqBody,
          cookies,
          resHeaders: res.headers(),
          setCookies,
          resBody,
        });
      })
      .catch(() => {}); // never break the chain
  });
  if (walletOn) await page.addInitScript(walletStubScript); // ponytail: raw JS string — a TS closure breaks under tsx (emits in-page-undefined `__name`)
  const toPattern = (u: string) =>
    new RegExp("^" + u.replace(/\[.*?\]/g, "[^/]+") + "$");
  const patterns = urls.map((u) => ({ url: u, re: toPattern(u) }));
  const match = (path: string) => patterns.find((p) => p.re.test(path))?.url;
  const out = [];
  const edges: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  const addEdge = (from: string, to: string | undefined) => {
    if (!to || to === from) return;
    const key = `${from}->${to}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ from, to });
    }
  };
  let walletHits = 0;
  let jwt = false;
  let loginWarned = false;
  // read-only filler: text-like inputs, areas, dates, numbers (no checkboxes,
  // radios, selects — avoid destructive toggles; no submit)
  const fillForm = async (form: Locator) => {
    const put = async (sel: string, value: string) => {
      const loc = form.locator(sel);
      for (let k = 0; k < (await loc.count()); k++) {
        const el = loc.nth(k);
        if (await el.isEnabled().catch(() => false))
          await el.fill(value, { timeout: 3000 }).catch(() => {});
      }
    };
    await put(
      'input[type="text"], input:not([type]), input[type="search"], input[type="tel"]',
      "[crawler] field",
    );
    await put('input[type="email"]', "crawler@example.com");
    await put('input[type="url"]', "https://example.com");
    await put('input[type="number"]', "1");
    await put('input[type="date"]', "2026-10-10");
    await put("textarea", "[crawler] body.\n\nSecond paragraph.");
  };
  const states: { name: string; screenshot: string }[] = [];
  const shootState = async (s: string, name: string) => {
    if (states.length >= 12) return; // ponytail: cap states per page
    const f = `${SHOTS_DIR}/${s}-s${states.length}.png`;
    await page.screenshot({ path: f });
    states.push({ name, screenshot: f });
  };
  for (const url of ordered) {
    const visit = url.replace(/\[.*?\]/g, "1"); // ponytail: example id, real ids when seeded
    const file = `${SHOTS_DIR}/${slug(url)}.png`;
    const s = slug(url);
    states.length = 0;
    traffic = [];
    recording = true;
    await page.goto(BASE + visit, { waitUntil: "networkidle" });
    // wallet-gating signals: alert banner + disabled-button states, sampled
    // across the whole visit (tabs reveal more buttons over time)
    const btnLabel = async (b: Locator, fb: string) =>
      (
        ((await b.getAttribute("aria-label")) ??
          (await b.textContent()) ??
          fb) as string
      )
        .trim()
        .slice(0, 60);
    const btnStates = new Map<string, { before?: boolean; after?: boolean }>();
    const recordBtnStates = async (phase: "before" | "after") => {
      const loc = page.locator("button:visible");
      const n = await loc.count();
      for (let k = 0; k < n; k++) {
        const b = loc.nth(k);
        const label = await btnLabel(b, `${k}`);
        if (!label) continue;
        const dis = await b.isDisabled().catch(() => true);
        const cur = btnStates.get(label) ?? {};
        if (phase === "before") cur.before = dis;
        else cur.after = (cur.after ?? false) || !dis;
        btnStates.set(label, cur);
      }
    };
    const walletBanner = async () => {
      const loc = page.locator('[role="alert"]:visible');
      const n = await loc.count();
      for (let k = 0; k < n; k++) {
        const t = await loc.nth(k).textContent();
        if (t && /connect your wallet/i.test(t)) return t.trim().slice(0, 60);
      }
      return null;
    };
    const bannerBefore = walletOn ? await walletBanner() : null;
    if (walletOn) await recordBtnStates("before");
    if (walletOn) {
      const connectBtn = page.getByRole("button", { name: "Connect wallet" });
      if ((await connectBtn.count()) > 0) {
        await connectBtn.first().click();
        await page.waitForTimeout(500);
        walletHits++;
      }
      await recordBtnStates("after");
    }
    await page.screenshot({ path: file, fullPage: true });
    await chain; // let pending body reads land, in order
    recording = false; // button-phase navigations belong to other nodes
    // fill every input (read-only: no submit here) so later clicks see live states
    await fillForm(page.locator("body"));
    const hrefs: string[] = await page.$$eval("a[href]", (els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    for (const href of hrefs) {
      if (!href || href.startsWith("#")) continue;
      let path: string;
      try {
        path = new URL(href, BASE).pathname;
      } catch {
        continue;
      }
      if (new URL(href, BASE).origin !== new URL(BASE).origin) continue;
      addEdge(url, match(path));
    }
    // button-driven routes: the app navigates via router.push on <button>,
    // invisible to anchors. Click each visible, enabled, non-form button
    // once (form buttons could write to the DB); record node navigations.
    const clicked = new Set<string>();
    const shotKinds = new Set<string>();
    let modalCount = 0;
    for (let i = 0; i < 30; i++) {
      // NOTE: app tabs are CSS-only radio inputs (TabbedCard), no tab roles.
      const loc = page.locator(
        'button:visible:not([disabled]), input.tab[type="radio"]:visible',
      );
      const n = await loc.count();
      let did = false;
      for (let k = 0; k < n; k++) {
        const b = loc.nth(k);
        const key = (
          ((await b.getAttribute("aria-label")) ??
            (await b.textContent()) ??
            `${k}`) as string
        )
          .trim()
          .slice(0, 60);
        if (!key || clicked.has(key)) continue;
        if (/disconnect|log ?out|sign ?out/i.test(key)) continue;
        const inForm = await b
          .evaluate(
            (el) =>
              el.closest("form") !== null ||
              (el as HTMLButtonElement).type === "submit",
          )
          .catch(() => true);
        if (inForm) continue;
        clicked.add(key);
        // screenshot kind: aria-label, else tag+class — same-kind buttons
        // (label chips, icon repeats) share one picture; every button is
        // still clicked once for edge discovery
        const kind =
          (await b.getAttribute("aria-label"))?.trim() ||
          (await b
            .evaluate((el) => `${el.tagName}|${(el as HTMLElement).className}`)
            .catch(() => "")) ||
          key;
        const before = new URL(page.url()).pathname;
        await b.click().catch(() => {});
        await page.waitForTimeout(700);
        let after = "";
        try {
          after = new URL(page.url()).pathname;
        } catch {
          after = "";
        }
        if (after && after !== before) {
          addEdge(url, match(after));
          await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
          await page.waitForTimeout(400);
        } else if (after) {
          // a new modal becomes its own node + edge; other same-page
          // results (tabs, toasts) share one shot per kind
          const modal = page
            .locator(
              '[role="dialog"]:visible, [role="alertdialog"]:visible, dialog[open], .modal-box:visible',
            )
            .first();
          if ((await modal.count()) > 0) {
            const mname =
              (
                ((await modal.getAttribute("aria-label")) ??
                  (await modal.locator("h1, h2, h3").first().textContent()) ??
                  key) as string
              )
                .trim()
                .slice(0, 50) || key;
            const mid = `${url}#modal-${slug(mname)}`;
            if (!seen.has(`${url}->${mid}`)) {
              const mf = `${SHOTS_DIR}/${s}-modal-${modalCount++}.png`;
              await page.screenshot({ path: mf });
              out.push({
                url: mid,
                screenshot: mf,
                http: [],
                auth: [],
                states: [],
              });
              edges.push({ from: url, to: mid });
              seen.add(`${url}->${mid}`);
              console.log(`${url} modal -> ${mid}`);
            }
          } else if (!shotKinds.has(kind)) {
            shotKinds.add(kind);
            await shootState(s, key);
          }
          await page.keyboard.press("Escape").catch(() => {});
        }
        if (walletOn) await recordBtnStates("after");
        did = true;
        break; // re-scan: tabs reveal new buttons
      }
      if (!did) break;
    }
    // form submits (WALLET=full only): real SIWE login, then fill + submit
    // each visible form once with [crawler]-marked data to uncover
    // post-submit navigations. Writes test records — never default.
    if (WALLET === "full") {
      if (!jwt) {
        try {
          await loginViaSiwe(page);
          jwt = true;
        } catch {
          if (!loginWarned) {
            loginWarned = true;
            console.log(
              "SIWE login failed — submits skipped (needs seeded DB)",
            );
          }
          /* creators 401 without JWT; submits below become no-ops */
        }
      }
      if (jwt) {
        const mark = traffic.length;
        recording = true;
        const submitted = new Set<string>();
        const radios = page.locator('input.tab[type="radio"]:visible');
        const tabCount = await radios.count();
        for (let t = -1; t < tabCount; t++) {
          if (t >= 0) {
            await radios
              .nth(t)
              .click()
              .catch(() => {});
            await page.waitForTimeout(400);
          }
          const forms = page.locator("form:visible");
          for (let fi = 0; fi < (await forms.count()); fi++) {
            const key = `${t}:${fi}`;
            if (submitted.has(key)) continue;
            const form = forms.nth(fi);
            const anySubmit = 'button[type="submit"], input[type="submit"]';
            if ((await form.locator(anySubmit).count()) === 0) continue;
            submitted.add(key);
            await fillForm(form);
            const submitSel =
              'button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled])';
            const sbtn = form.locator(submitSel);
            if ((await sbtn.count()) === 0) continue; // still invalid — skip
            const before = new URL(page.url()).pathname;
            await sbtn
              .first()
              .click()
              .catch(() => {});
            await page.waitForTimeout(5000);
            let after = before;
            try {
              after = new URL(page.url()).pathname;
            } catch {
              after = before;
            }
            if (after !== before) {
              addEdge(url, match(after));
              console.log(`${url} submit -> ${after}`);
              await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
              await page.waitForTimeout(400);
            } else {
              await shootState(s, "submit"); // success panel, no navigation
            }
          }
        }
        await chain;
        recording = false;
        // submit window: keep writes, drop target-page refetches
        const fresh = traffic.slice(mark);
        traffic = traffic
          .slice(0, mark)
          .concat(fresh.filter((c) => c.method !== "GET"));
      }
    }
    // wallet-gated actions: disabled before connect, enabled at any point
    // after (tabs visited above, so hidden panels are covered too), plus
    // wallet alert banners (create forms gate on validity too, so their
    // save buttons alone can't prove wallet gating)
    const auth = [...btnStates]
      .filter(([, st]) => st.before && st.after)
      .map(([l]) => l);
    if (bannerBefore) auth.unshift(bannerBefore);
    out.push({
      url,
      screenshot: file,
      http: traffic,
      auth,
      states: [...states],
    });
    console.log(
      `${url} -> ${file} (${traffic.length} calls, ${states.length} states${auth.length ? `, wallet-gated: ${auth.join(", ")}` : ""})`,
    );
  }
  await browser.close();
  const graph = {
    nodes: out,
    edges: edges.sort((a, b) => (a.from + a.to > b.from + b.to ? 1 : -1)),
  };
  if (walletOn)
    console.log(`wallet connected on ${walletHits}/${urls.length} pages`);
  writeFileSync(URLS_JSON, JSON.stringify(graph, null, 2) + "\n");
  writeFileSync(
    `${VIEW_DIR}/sidemap-data.js`,
    `window.GRAPH = ${JSON.stringify(graph, null, 2)};\n`,
  );
}

main();
