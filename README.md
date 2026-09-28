# Portfolio Dashboard

Static pages, served by GitHub Pages, that read private Google Sheets in the browser.

This repo holds **no data and no secrets**. On "Sign in with Google", a page gets a short-lived, read-only token for the signed-in user and reads the Sheets directly from Google. Only accounts the Sheets are shared with can read them. Portfolio names, allocation limits and ISIN aliases all come from the Sheets at runtime.

| File | What it is |
|---|---|
| `index.html` | Holdings: Command Center, Positions, Rotation Engine (reads the Live sheet) |
| `gains.html` | Capital Gains report (reads the Portfolio Ledger) |
| `transactions.html` | Every transaction, with filters (reads the Portfolio Ledger) |
| `common.js` | Shared: sign-in, Sheets loading, FIFO engine, tax-date rules |
| `common.css` | Shared styles |

Tax rules live only in `common.js`, so every page applies them the same way.

**To publish a change:** edit the files here, commit, push. If `common.js` or `common.css` changed, bump the `?v=N` on their links in all three pages, so browsers don't keep an old copy.
