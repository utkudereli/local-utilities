# Local Utilities

A tiny, **fully local** utility toolkit that runs entirely in your browser — nothing is ever uploaded to a server. Merge/split/compress PDFs, convert images, strip EXIF, redact documents, convert CSV↔JSON, encode Base64, and more.

**Why this exists:** most "free online PDF/image tools" upload your files to someone else's server. This one physically can't — a strict Content-Security-Policy blocks all network access, so your documents never leave your machine. It's open source (MIT) so you can read every line and run it yourself, safely, forever.

A sidebar groups the tools into sections:

### PDF
- **Merge** — upload multiple PDFs, drag to reorder, see a live total-size estimate, then merge and download.
- **Split** — upload one PDF, see a thumbnail of every page, click the scissors between pages to set where it breaks (or use *Burst* / *Every N pages*), then download all parts as a `.zip`. Each colored "Part" becomes its own file.
- **Compress** — shrink a PDF by re-rendering pages as optimized images (High/Medium/Low). Great for scans; note that text becomes non-selectable.
- **Images → PDF** — drop images (JPG/PNG/WebP/GIF), reorder them, choose page size (Fit / A4 / Letter), and export one PDF.
- **Redact** — draw black boxes over sensitive areas. On export the document is flattened to images, so the underlying text/images are **permanently removed**, not just hidden.
- **Sign** — drop a PDF, upload a signature/stamp PNG, drag it into place over any page, then export. The image is embedded and the document's text **stays selectable** (no flattening).

### Image
- **Strip EXIF** — drop photos (JPG/PNG/WebP) to remove embedded metadata (GPS location, camera make/model, timestamps) by re-encoding, then download the clean image.
- **Background Remover** — drop an image and remove a solid-color background (with an adjustable tolerance), exporting a transparent PNG.

### Data
- **CSV ↔ JSON** — paste CSV or JSON and convert in either direction; quoting/commas are handled and round-trip safely.
- **Text Diff** — paste two texts to see a line-level diff with added/removed/unchanged lines highlighted.

### Base64
- **Encode** — type/paste text or CSV, or drop/paste an image or any file, to get its Base64 (files become a `data:` URL, directly usable in `<img src>`/CSS). UTF-8 safe.
- **Decode** — paste raw Base64 or a `data:` URL to get the text back, or preview/download the original image or file (type detected from the `data:` prefix or magic bytes).

## Why it's private & secure

- **No backend, no database, no accounts.** Just one HTML file plus local libraries.
- **No network egress.** A strict `Content-Security-Policy` blocks all outbound connections (`default-src 'none'`). Your PDFs physically cannot leave your machine.
- **Libraries are vendored** in `vendor/` — no CDN calls at runtime.
- All processing (thumbnails + merge) happens in your browser via WebAssembly/JS.

## How to run

### Get it

```bash
git clone https://github.com/utkudereli/local-utilities.git
cd local-utilities
```

No build step, no `npm install` needed to *use* it — the app has zero runtime dependencies (libraries are vendored). You only need Python 3 (preinstalled on macOS) to serve it locally.

### Install as an app (recommended)
The app is a PWA. Run it once over the local server, then use your browser's **Install** action (Chrome: the install icon in the address bar) to add **Utilities** to your Dock/Launchpad. It then opens in its own window and works offline (a service worker caches everything).

### Always-on background server (macOS)
So the installed app launches instantly without keeping a Terminal window open, a LaunchAgent runs the loopback server in the background and starts it at login:

```bash
# install / start (auto-starts at login, restarts if it stops)
service/install-service.command

# stop & remove
service/uninstall-service.command
```

This serves `http://127.0.0.1:8765` (loopback only — nothing is reachable from other devices). Logs: `/tmp/pdf-tools.log`, `/tmp/pdf-tools.err`.

### Or run it manually
From this folder:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://localhost:8765/index.html . (Opening `index.html` directly via `file://` also works, but a local server is recommended — some browsers restrict web workers and the service worker on `file://`.)

## Using it

Pick a section in the left sidebar (**PDF**, **Image**, **Data**, or **Base64**); the sub-tabs along the top switch tools within that section.

**Merge**
1. Drop PDFs onto the page (or click to browse). Add as many as you like.
2. Reorder by dragging the handle, or with the ▲ ▼ buttons. Files merge **top → bottom**.
3. Remove any file with the ✕ button, or **Clear all** to reset.
4. Click **Merge** → **Download**.

**Split**
1. Drop a single PDF. Every page renders as a thumbnail.
2. Click a scissors slot between two pages to add/remove a cut — each colored **Part** becomes one output PDF. Or use **Burst** (every page) / **Every N pages**.
3. Click **Split into N files** → **Download .zip**.

**Compress**
1. Drop a PDF, pick a quality (Medium is a good start; Low for the smallest file).
2. Click **Compress** → **Download**. The result shows the before/after size.

**Images → PDF**
1. Drop images, reorder with the handle or ▲ ▼ buttons.
2. Choose page size, then **Create PDF** → **Download**.

**Redact**
1. Drop a PDF. Click-and-drag on the page to draw a black box; click a box to remove it. Use ‹ › to change pages.
2. Click **Apply & download**. The exported PDF is flattened to images so redacted content is unrecoverable.

**Base64**
1. **Encode → Base64:** type/paste text or CSV, or drop/paste/browse a file, then **Copy** the Base64 output.
2. **Base64 → Decode:** paste Base64 (or a `data:` URL), click **Decode**, then copy the text or preview/download the file.

## Testing

A Playwright end-to-end suite drives the real UI in headless Chrome (uses your installed Chrome — no browser download) and validates the actual merged/split output:

```bash
npm install        # dev-only: pdf-lib + playwright (the app itself has no deps)
npm run test:e2e   # 88 checks across all tools, incl. zip/PDF output + Base64 round-trip validation
```

## Stack

- [pdf-lib](https://pdf-lib.js.org) — merging & splitting
- [pdf.js](https://mozilla.github.io/pdf.js) — page thumbnails + page counts
- [SortableJS](https://sortablejs.github.io/Sortable) — drag-and-drop reordering
- [JSZip](https://stuk.github.io/jszip) — bundling split parts into a `.zip`

All libraries are vendored in `vendor/`. The app has **no build step and no runtime dependencies**.

## License

[MIT](LICENSE) © Utku Dereli. Free to use, modify, and share. No warranty — it runs entirely on your own machine.
