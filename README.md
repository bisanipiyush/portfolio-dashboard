# Portfolio Dashboard

A static page, served by GitHub Pages, that reads a private Google Sheet in the browser.

This repo holds **no data and no secrets**. On "Sign in with Google", the page gets a short-lived, read-only token for the signed-in user and reads the Sheet directly from Google. Only accounts the Sheet is shared with can read it. Portfolio names, allocation limits and ISIN aliases all come from the Sheet at runtime.

`index.html` is a copy of `Portfolio_App.html` from the main project folder. Edit that file, then copy it here to publish.
