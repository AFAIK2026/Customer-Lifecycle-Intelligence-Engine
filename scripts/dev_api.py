#!/usr/bin/env python3
"""Local server for POST /api/prospect-analysis, for use with `npm run dev`.

`vite dev` doesn't run Vercel functions, so vite.config.ts proxies
/api/prospect-analysis to this server. It loads the same handler the Vercel
function uses.

Usage:
    npm run dev:api          (or: python3 scripts/dev_api.py --port 5174)
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
from http.server import ThreadingHTTPServer
from pathlib import Path

HANDLER_PATH = Path(__file__).resolve().parent.parent / "api" / "prospect-analysis.py"


def load_handler():
    # The file name contains a hyphen (it is the URL path), so import it by location.
    spec = importlib.util.spec_from_file_location("prospect_analysis_function", HANDLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=5174)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    server = ThreadingHTTPServer((args.host, args.port), load_handler())
    print(f"Prospect analysis API on http://{args.host}:{args.port}/api/prospect-analysis (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
