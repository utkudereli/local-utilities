"""Loopback static server for the app (stdlib only).

Why not plain `python3 -m http.server`: its listen backlog is 5. The app loads
~13 ES modules in parallel; behind a reverse proxy (tailscale serve, HTTP/2 ->
one upstream connection per request) the burst overflows the backlog, the
kernel resets the extra connections, the proxy answers 502, one failed module
import kills the whole app (no nav, dead drop zones) and the service worker's
precache fails so the installed PWA never works offline.
"""
import http.server
import posixpath
import sys
import urllib.parse


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128


# Serve only the app, not the repo (.git, service/, tests/, ...); no directory listings.
APP = {"", "index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest", "icons", "js", "vendor"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = posixpath.normpath(urllib.parse.unquote(self.path.split("?", 1)[0].split("#", 1)[0]))
        top = path.lstrip("/").split("/", 1)[0]
        if top not in APP:
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.test(
    HandlerClass=Handler,
    ServerClass=Server,
    protocol="HTTP/1.1",  # keep-alive: fewer new connections per page load
    port=port,
    bind="127.0.0.1",
)
