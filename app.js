// Entry point. Loads shared helpers, every tool module (each wires itself up
// on import), and the nav layer last. No build step: native ES modules.
import "./js/lib.js";
import "./js/merge.js";
import "./js/split.js";
import "./js/compress.js";
import "./js/images.js";
import "./js/redact.js";
import "./js/base64.js";
import "./js/csvjson.js";
import "./js/diff.js";
import "./js/exif.js";
import "./js/bgremove.js";
import "./js/sign.js";
import "./js/nav.js";
