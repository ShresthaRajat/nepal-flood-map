#!/usr/bin/env python3
"""Static server for the Nepal Flood 2026 map on port 1111, with HTTP Range
support (PMTiles archives are read by byte range) and no caching.

    python3 tools/serve.py            # http://127.0.0.1:1111/index.html
    python3 tools/serve.py 8080       # another port
"""
import http.server, os, re, sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 1111

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or os.path.isdir(path) or not os.path.exists(path):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        size = os.path.getsize(path)
        if not m:
            return super().send_head()
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        if m.group(1) == "":                       # suffix range: bytes=-N
            start = max(0, size - int(m.group(2))); end = size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return None
        f = open(path, "rb"); f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_len = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        n = getattr(self, "_range_len", None)
        if n is None:
            return super().copyfile(source, outputfile)
        self._range_len = None
        while n > 0:
            chunk = source.read(min(n, 1 << 16))
            if not chunk: break
            outputfile.write(chunk); n -= len(chunk)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        if self.path.startswith("/log"):
            with open(os.path.join(ROOT, "work", "client.log"), "ab") as fh: fh.write(body + b"\n")
            self.send_response(204); self.end_headers(); return
        self.send_error(404)

    def log_message(self, fmt, *args):
        # Keep the log quiet for tile traffic.  Imagery pyramids are sparse, so
        # 404s are normal; inspect self.requestline rather than args, which on
        # the error path holds an HTTPStatus, not the request line.
        super().log_message(fmt, *args)

if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=ROOT))
    print(f"serving {ROOT} at http://127.0.0.1:{PORT}/index.html", flush=True)
    srv.serve_forever()
