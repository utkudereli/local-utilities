"""Loopback static server for the app (stdlib only).

Why not plain `python3 -m http.server`: its listen backlog is 5. The app loads
~13 ES modules in parallel; behind a reverse proxy (tailscale serve, HTTP/2 ->
one upstream connection per request) the burst overflows the backlog, the
kernel resets the extra connections, the proxy answers 502, one failed module
import kills the whole app (no nav, dead drop zones) and the service worker's
precache fails so the installed PWA never works offline.
"""
import http.server
import sys


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.test(
    HandlerClass=http.server.SimpleHTTPRequestHandler,
    ServerClass=Server,
    protocol="HTTP/1.1",  # keep-alive: fewer new connections per page load
    port=port,
    bind="127.0.0.1",
)
