# Local Utilities

Everyday file tools that run in your browser and never upload anything. Merge, split, compress and sign PDFs, convert images, strip EXIF, redact documents, convert CSV and JSON, encode and decode Base64.

Most "free online PDF tools" send your files to someone else's server. This one can't: a strict Content-Security-Policy blocks all network access, so your files stay on your machine. It's open source (MIT), so you can read the code and run it yourself.

A sidebar groups the tools into sections.

### PDF
- **Merge**: add multiple PDFs, drag to reorder, see a live total-size estimate, then merge and download.
- **Split**: load one PDF, see a thumbnail of every page, click the scissors between pages to set the breaks (or use *Burst* / *Every N pages*), then download all parts as a `.zip`. Each colored "Part" becomes its own file.
- **Compress**: shrink a PDF by re-rendering pages as optimized images (High/Medium/Low). Good for scans. Text becomes non-selectable.
- **Images to PDF**: add images (JPG/PNG/WebP/GIF), reorder them, pick a page size (Fit / A4 / Letter), and export one PDF.
- **Redact**: draw black boxes over sensitive areas. On export the document is flattened to images, so what's under a box is removed, not just hidden.
- **Sign**: load a PDF, upload a signature or stamp PNG, drag it into place on any page, then export. The image is embedded and the text stays selectable.

### Image
- **Strip EXIF**: remove embedded metadata (GPS location, camera model, timestamps) from JPG/PNG/WebP by re-encoding, then download the clean image.
- **Background Remover**: remove a solid-color background (with adjustable tolerance) and export a transparent PNG.

### Data
- **CSV / JSON**: paste text or upload a `.csv` / `.json` file, then convert in either direction. Quoting and commas are handled and round-trip safely.
- **Text Diff**: paste two blocks of text to see a line-by-line diff.

### Base64
- **Encode**: type or paste text, or drop a file, to get its Base64. Files become a `data:` URL you can drop straight into `<img src>` or CSS. UTF-8 safe.
- **Decode**: paste raw Base64 or a `data:` URL to get the text back, or preview and download the original file (type detected from the prefix or magic bytes).

## Why it stays private

- No backend, no database, no accounts. One HTML file plus local libraries.
- No network access. A strict `Content-Security-Policy` (`default-src 'none'`) blocks outbound connections, so files never leave your machine.
- Libraries are vendored in `vendor/`, so there are no CDN calls at runtime.
- All processing happens in your browser.

## How to run

Clone it:

```bash
git clone https://github.com/utkudereli/local-utilities.git
cd local-utilities
```

There's no build step and no `npm install` needed to use it. You only need Python 3 (preinstalled on macOS) to serve it locally.

### Install as an app (recommended)

The app is a PWA. Run it once over the local server, then use your browser's **Install** action (in Chrome, the install icon in the address bar) to add Local Utilities to your Dock or Launchpad. It opens in its own window and works offline.

### Always-on background server (macOS)

So the app launches without keeping a Terminal window open, a LaunchAgent runs the loopback server in the background and starts it at login:

```bash
service/install-service.command    # install and start (auto-starts at login)
service/uninstall-service.command  # stop and remove
```

This serves `http://127.0.0.1:8765` on loopback only, so nothing is reachable from other devices. Logs go to `/tmp/local-utilities.log` and `/tmp/local-utilities.err`.

### Or run it manually

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://localhost:8765/index.html . Opening `index.html` directly with `file://` mostly works too, but a local server is more reliable because some browsers restrict web workers and service workers on `file://`.

## Testing

A Playwright suite drives the real UI in headless Chrome (using your installed Chrome, no download) and checks the actual output:

```bash
npm install
npm run test:e2e
```

## Stack

- [pdf-lib](https://pdf-lib.js.org): merging and splitting
- [pdf.js](https://mozilla.github.io/pdf.js): page thumbnails and counts
- [SortableJS](https://sortablejs.github.io/Sortable): drag-to-reorder
- [JSZip](https://stuk.github.io/jszip): bundling split parts into a `.zip`

All libraries are vendored in `vendor/`. No build step, no runtime dependencies.

## License

[MIT](LICENSE), Utku Dereli. Free to use, modify, and share. No warranty; it runs on your own machine.
