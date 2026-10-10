---
description: Create a sitemap of the application
---

Build and run a Playwright-based crawler that explores the application, captures screenshots, records page states and navigation relationships, and generates an interactive left-to-right sitemap.

Goals
Discover reachable application pages using breadth-first search (BFS).
Explore navigation links, buttons, wallet-gated actions, and forms.
Capture screenshots for pages and meaningful interaction results.
Record nodes, edges, authentication requirements, and form states.
Generate a standalone HTML canvas visualization with zoom, pan, node dragging, and readable relationships.
Make crawling reproducible, resumable where practical, and safe for development environments.
Output structure

Create the following directory structure at the project root:

sitemap/
├── sitemap.html
├── sitemap-data.js
└── shots/
├── <page-id>.png
├── <page-id>-s1.png
└── ...

Use the existing sitemap/ directory if it already exists. Do not delete unrelated files.

sitemap.html: interactive visualization.
sitemap-data.js: graph data consumed by the visualization.
shots/: screenshots referenced by graph nodes and states.

The HTML must load the graph data from the correct relative path. Support both opening the HTML directly with file:// and serving the repository over HTTP, without requiring a backend service.

Workflow

1. Inspect the project

Before crawling:

Identify the application framework, package manager, start command, base URL, and available test configuration.
Inspect existing Playwright setup, wallet mocks, and .opencode/commands/scripts/shoot.ts.
Reuse existing helpers and conventions where possible.
Determine whether the application is already running. Start it only if necessary and practical.
Verify that the configured base URL is reachable before beginning.
Establish an allowed origin and restrict crawling to the application and explicitly approved local origins.

Do not assume a framework, port, route structure, or package manager without checking the repository.

2. Crawl pages using BFS

Maintain a queue of discovered URLs and a visited set. Process pages breadth-first.

For each page:

Navigate to the URL and wait for the application to reach a stable state.
Record the normalized URL, page title, visible headings, and relevant page metadata.
Capture a screenshot in sitemap/shots/.
Discover internal navigation links and actionable controls.
Record relationships between the current page and discovered destinations.
Identify visible forms and wallet-gated controls.
Explore permitted interactions and enqueue newly discovered destinations.
Deduplicate pages using normalized URLs and, when necessary, interaction state.

Ignore external links, logout actions, destructive actions, and irrelevant tracking or asset URLs unless explicitly requested.

Handle redirects, query parameters, hash routes, dynamic routes, loading states, and navigation failures. Avoid infinite loops caused by repeated query parameters or controls that navigate back to the same page.

Use stable node IDs independent of discovery order when practical.

3. Wallet modes

Support the following environment variable:

WALLET=connect

Inject e2e/wallet-stub.js through the existing Playwright setup so window.ethereum is available.
Detect and click visible Connect Wallet controls when appropriate.
Explore wallet-gated UI that becomes available after connecting.
Discover and record wallet-gated actions without submitting application forms.
Mark each node with its authentication requirements.

WALLET=full

Perform the wallet connection flow required by the existing test environment.
Use the project's existing SIWE test-login mechanism, if configured.
Fill visible form fields and submit each eligible form at most once per distinct page/form combination.
Capture the resulting success panel, modal, error state, or destination page.
Record resulting states and edges.
Use test accounts, test data, and an explicitly configured development or test environment only.

If no wallet mode is provided, default to public crawling without authenticated submissions.

Never request, print, or persist real private keys, seed phrases, session tokens, or production credentials. Do not silently switch to a real wallet or production environment. If SIWE configuration is missing, report the limitation and continue with the safe portion of the crawl.

4. Form discovery and interaction

For every page, identify visible forms and classify their controls.

In default and WALLET=connect modes:

Record form structure, labels, field types, required fields, and available actions.
Fill eligible fields with safe synthetic values when useful for discovering client-side validation.
Do not submit forms.
Do not fill password, payment, signing, destructive, or other sensitive controls without an explicitly configured test strategy.

In WALLET=full mode:

Submit each eligible form once, using a clear [crawler] marker in supported test data.
Use valid synthetic values based on field types and validation rules.
Avoid duplicate submissions caused by retries, rerenders, or navigation.
Never submit financial transactions, blockchain writes, irreversible operations, account deletion, or external communications unless an isolated test environment and explicit safe test mechanism are verified.
Record validation failures as states rather than repeatedly retrying them.

After each permitted submission:

Capture the resulting screenshot.
Record the visible outcome and resulting URL.
Add a state to the originating node or create a separate node when a distinct destination page is reached.
Add an edge describing the action and outcome.
Continue BFS from newly discovered destinations.

5. Interactive visualization

Generate sitemap/sitemap.html as a self-contained visualization using HTML, CSS, and JavaScript. Prefer native Canvas or an already installed graph library; avoid adding dependencies without a clear need.

Layout:

Arrange pages from left to right, following navigation progression.
Group related routes into columns or clusters.
Display screenshot thumbnails inside page nodes.
Show page titles, route paths, authentication badges, and state counts.
Draw directional edges with labels describing navigation or actions.
Use a deterministic layout so repeated crawls remain easy to compare.
Minimize overlapping nodes, screenshots, and edge labels. Add spacing and route around nodes where practical.
Provide a legend and a search/filter interface.

Interactions:

Mouse wheel or controls to zoom in and out.
Click-and-drag on the background to pan.
Drag individual nodes to reposition them.
Fit-to-view and reset-layout controls.
Click a node to inspect its screenshot, URL, forms, authentication requirements, and states.
Click an edge to inspect the action and transition.
Toggle visibility of public pages, wallet-gated pages, form states, and errors.
Support useful keyboard navigation and readable contrast.

The graph must remain usable with large node counts. Do not redraw the entire graph unnecessarily on every pointer movement.
