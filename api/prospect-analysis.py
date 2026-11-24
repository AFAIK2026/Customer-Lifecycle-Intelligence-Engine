"""Vercel Python function: POST /api/prospect-analysis.

Thin HTTP wrapper; all logic lives in api/_prospects (see service.handle_request).
The underscore folder is not exposed as a route by Vercel.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _prospects.service import encode, handle_request, read_body  # noqa: E402


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self):
        body, length = read_body(self.headers, self.rfile)
        self._respond(*handle_request("POST", body, length))

    def do_GET(self):
        self._respond(*handle_request("GET", None))

    do_PUT = do_DELETE = do_PATCH = do_GET

    def _respond(self, status, payload):
        data = encode(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        if status == 405:
            self.send_header("Allow", "POST")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):  # noqa: A002 - BaseHTTPRequestHandler signature
        # Default logging prints request lines only; keep it, never bodies.
        sys.stderr.write("prospect-analysis: " + (format % args) + "\n")
