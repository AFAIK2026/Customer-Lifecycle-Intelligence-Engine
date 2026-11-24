"""HTTP handling for POST /api/prospect-analysis (design §10), independent of any server.

The Vercel function and the local dev server both call handle_request, so
the status codes and error messages are identical in both and are unit-tested.
Request bodies are never logged: they contain customer figures.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

from .engine import analyse
from .schema import ValidationError, parse_request

MAX_BODY_BYTES = 4 * 1024 * 1024

logger = logging.getLogger("prospect-analysis")


def handle_request(method: str, body: bytes | None, content_length: int | None = None) -> tuple[int, dict]:
    """Returns (HTTP status, JSON body)."""
    if method != "POST":
        return 405, {"error": "Method not allowed"}
    if content_length is not None and content_length > MAX_BODY_BYTES:
        return 413, {"error": f"Request body must be at most {MAX_BODY_BYTES // (1024 * 1024)} MB"}
    if not body:
        return 400, {"error": "Request body is empty"}
    if len(body) > MAX_BODY_BYTES:
        return 413, {"error": f"Request body must be at most {MAX_BODY_BYTES // (1024 * 1024)} MB"}

    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 400, {"error": "Request body must be valid JSON"}

    started = time.perf_counter()
    try:
        request = parse_request(payload)
        result = analyse(request)
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - last-resort guard; details go to logs only
        logger.exception("Prospect analysis failed (%s)", type(exc).__name__)
        return 500, {"error": "Prospect analysis failed"}

    result["model"]["analysed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    logger.info(
        "Prospect analysis %s: %d customers in %.0f ms",
        result["status"],
        len(request.customers),
        (time.perf_counter() - started) * 1000,
    )
    return 200, result


def read_body(headers, stream) -> tuple[bytes | None, int | None]:
    """Reads a request body from a BaseHTTPRequestHandler's headers and rfile, honouring the size cap."""
    try:
        length = int(headers.get("Content-Length") or 0)
    except ValueError:
        return None, None
    if length > MAX_BODY_BYTES:
        return None, length
    return (stream.read(length) if length > 0 else b""), length


def encode(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
