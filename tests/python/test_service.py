import io
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest
from conftest import synthetic_payload

from _prospects.service import MAX_BODY_BYTES, handle_request, read_body


def body(payload) -> bytes:
    return json.dumps(payload).encode()


def test_ok_response_adds_timestamp():
    status, result = handle_request("POST", body(synthetic_payload(n=1500, seed=4)))
    assert status == 200
    assert result["status"] == "ok"
    assert result["model"]["analysed_at"].endswith("+00:00")


def test_insufficient_data_is_still_200():
    status, result = handle_request("POST", body(synthetic_payload(n=50, seed=1)))
    assert status == 200 and result["status"] == "insufficient_data"


@pytest.mark.parametrize(
    ("method", "raw", "expected"),
    [
        ("GET", None, 405),
        ("POST", b"", 400),
        ("POST", b"{not json", 400),
        ("POST", b"\xff\xfe", 400),
        ("POST", body({"as_of": "2026-11-24T00:00:00Z", "customers": []}), 400),
    ],
)
def test_error_statuses(method, raw, expected):
    status, result = handle_request(method, raw)
    assert status == expected
    assert "error" in result


def test_validation_message_is_returned():
    status, result = handle_request("POST", body({"as_of": "nope", "customers": []}))
    assert status == 400 and "as_of" in result["error"]


def test_rejects_oversized_bodies():
    assert handle_request("POST", b"x", content_length=MAX_BODY_BYTES + 1)[0] == 413
    headers = {"Content-Length": str(MAX_BODY_BYTES + 1)}
    assert read_body(headers, io.BytesIO(b"")) == (None, MAX_BODY_BYTES + 1)


def test_unexpected_errors_return_generic_500(monkeypatch):
    from _prospects import service

    def boom(_request):
        raise RuntimeError("secret detail")

    monkeypatch.setattr(service, "analyse", boom)
    status, result = handle_request("POST", body(synthetic_payload(n=100, seed=1)))
    assert status == 500
    assert result == {"error": "Prospect analysis failed"}


def test_vercel_handler_over_real_http():
    import dev_api

    server = ThreadingHTTPServer(("127.0.0.1", 0), dev_api.load_handler())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/api/prospect-analysis"
    try:
        request = urllib.request.Request(url, data=body(synthetic_payload(n=1500, seed=4)), method="POST")
        with urllib.request.urlopen(request) as response:
            assert response.status == 200
            assert response.headers["Content-Type"].startswith("application/json")
            assert response.headers["Cache-Control"] == "no-store"
            assert json.loads(response.read())["status"] == "ok"

        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url)
        assert error.value.code == 405
        assert error.value.headers["Allow"] == "POST"
    finally:
        server.shutdown()
