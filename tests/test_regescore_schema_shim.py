"""Coverage for scripts/regescore_schema_shim.py.

The shim exists to remove exactly the JSON-schema bounds that make llama.cpp
throw "number of repetitions exceeds sane defaults", and nothing else. Two
properties matter and both are tested here: the offending bounds go away, and
every other byte of the request survives - a proxy that quietly reshapes a
request is worse than the 400 it was meant to fix.
"""
import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "regescore_schema_shim", ROOT / "scripts/regescore_schema_shim.py"
)
shim = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(shim)


# The two schemas from the user's failing request, verbatim in shape.
WORKFLOW_TOOL = {
    "name": "Workflow",
    "description": "Run a workflow script",
    "input_schema": {
        "type": "object",
        "properties": {
            "script": {"type": "string", "maxLength": 524288},
            "label": {"type": "string", "maxLength": 60},
        },
        "required": ["script"],
    },
}

REPORT_FINDINGS_TOOL = {
    "name": "ReportFindings",
    "input_schema": {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "maxItems": 32,
                "items": {
                    "type": "object",
                    "properties": {
                        "line": {
                            "type": "integer",
                            "minimum": -9007199254740991,
                            "maximum": 9007199254740991,
                        },
                        "summary": {"type": "string"},
                    },
                },
            }
        },
    },
}


def sanitize(payload, **kwargs):
    findings = shim.sanitize_request(payload, **kwargs)
    return payload, {f["path"]: f["value"] for f in findings}


# -- what must be removed ---------------------------------------------------

def test_removes_the_bound_that_breaks_grammar_compilation():
    payload, found = sanitize({"tools": [json.loads(json.dumps(WORKFLOW_TOOL))]})
    assert found == {"Workflow.properties.script.maxLength": 524288}
    assert "maxLength" not in payload["tools"][0]["input_schema"]["properties"]["script"]


def test_bounds_at_or_below_the_threshold_survive():
    """2000 compiles; only a greater value throws (llama-grammar.cpp:652)."""
    payload, found = sanitize({"tools": [json.loads(json.dumps(WORKFLOW_TOOL))]})
    assert payload["tools"][0]["input_schema"]["properties"]["label"]["maxLength"] == 60
    assert "Workflow.properties.label.maxLength" not in found

    exactly_at = {"tools": [{"name": "T", "input_schema": {"maxLength": shim.REPETITION_THRESHOLD}}]}
    _, found = sanitize(exactly_at)
    assert found == {}

    one_over = {"tools": [{"name": "T", "input_schema": {"maxLength": shim.REPETITION_THRESHOLD + 1}}]}
    _, found = sanitize(one_over)
    assert found == {"T.maxLength": shim.REPETITION_THRESHOLD + 1}


@pytest.mark.parametrize("keyword", shim.COUNTED_KEYWORDS)
def test_every_counted_keyword_is_handled(keyword):
    """maxItems and the min* forms hit the same threshold check as maxLength."""
    _, found = sanitize({"tools": [{"name": "T", "input_schema": {keyword: 999_999}}]})
    assert found == {f"T.{keyword}": 999_999}


def test_reaches_bounds_nested_inside_array_items():
    payload, found = sanitize({"tools": [json.loads(json.dumps(REPORT_FINDINGS_TOOL))]})
    line = payload["tools"][0]["input_schema"]["properties"]["findings"]["items"]["properties"]["line"]
    assert "minimum" not in line and "maximum" not in line
    assert "ReportFindings.properties.findings.items.properties.line.maximum" in found
    # maxItems: 32 is small and constrains something real, so it stays.
    assert payload["tools"][0]["input_schema"]["properties"]["findings"]["maxItems"] == 32


def test_openai_tool_shape_is_handled_too():
    payload = {
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "Workflow",
                    "parameters": {"properties": {"script": {"maxLength": 524288}}},
                },
            }
        ]
    }
    payload, found = sanitize(payload)
    assert found == {"Workflow.properties.script.maxLength": 524288}
    assert "maxLength" not in payload["tools"][0]["function"]["parameters"]["properties"]["script"]


def test_integer_bounds_can_be_kept():
    payload, found = sanitize(
        {"tools": [json.loads(json.dumps(REPORT_FINDINGS_TOOL))]}, int_bound_limit=None
    )
    line = payload["tools"][0]["input_schema"]["properties"]["findings"]["items"]["properties"]["line"]
    assert line["maximum"] == 9007199254740991
    assert found == {}


# -- what must not be touched -----------------------------------------------

def test_everything_outside_tool_schemas_is_untouched():
    payload = {
        "model": "regescore-1.0-35b",
        "max_tokens": 32000,
        "stream": True,
        "system": [{"type": "text", "text": "You are Claude Code.", "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": [{"type": "text", "text": "x" * 600000}]}],
        "metadata": {"user_id": "abc"},
        "tools": [json.loads(json.dumps(WORKFLOW_TOOL))],
    }
    before = json.dumps({k: v for k, v in payload.items() if k != "tools"}, sort_keys=True)
    sanitize(payload)
    after = json.dumps({k: v for k, v in payload.items() if k != "tools"}, sort_keys=True)
    assert before == after


def test_request_without_tools_is_a_no_op():
    """The one request that succeeded in the user's log had "tools": []."""
    for payload in ({"messages": []}, {"tools": []}, {"tools": "nonsense"}, []):
        assert shim.sanitize_request(payload) == []


def test_booleans_are_not_mistaken_for_bounds():
    """bool is a subclass of int; True must not read as a bound of 1."""
    payload, found = sanitize({"tools": [{"name": "T", "input_schema": {"maxLength": True}}]})
    assert found == {}
    assert payload["tools"][0]["input_schema"]["maxLength"] is True


def test_malformed_tools_do_not_raise():
    payload = {"tools": [None, "text", 7, {}, {"input_schema": None}, {"function": "no"}]}
    assert shim.sanitize_request(payload) == []


# -- the proxy path ---------------------------------------------------------

class Upstream(BaseHTTPRequestHandler):
    """Stands in for LM Studio; records what actually arrived."""

    received: list = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        # Keep the HTTPMessage rather than a dict: header lookup is
        # case-insensitive, and urllib re-cases names on the way out.
        Upstream.received.append((self.path, self.headers, body))

        if self.path.endswith("/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for index in range(3):
                self.wfile.write(f"data: {index}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            return

        payload = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST


@pytest.fixture
def proxy():
    Upstream.received = []
    origin = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=origin.serve_forever, daemon=True).start()

    options = shim.argparse.Namespace(
        upstream=f"http://127.0.0.1:{origin.server_address[1]}",
        timeout=30, threshold=shim.REPETITION_THRESHOLD,
        int_bound_limit=shim.DEFAULT_INT_BOUND_LIMIT,
        keep_int_bounds=False, verbose=False,
    )
    front = ThreadingHTTPServer(("127.0.0.1", 0), shim.make_handler(options))
    threading.Thread(target=front.serve_forever, daemon=True).start()

    yield f"http://127.0.0.1:{front.server_address[1]}"

    front.shutdown(); front.server_close()
    origin.shutdown(); origin.server_close()


def post(url, path, payload):
    import urllib.request

    request = urllib.request.Request(
        url + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "anthropic-version": "2023-06-01"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, response.read()


def test_proxy_strips_the_bound_before_upstream_sees_it(proxy):
    status, body = post(proxy, "/v1/messages", {"model": "m", "tools": [WORKFLOW_TOOL]})
    assert status == 200 and json.loads(body) == {"ok": True}

    path, headers, forwarded = Upstream.received[0]
    assert path == "/v1/messages"
    assert headers["anthropic-version"] == "2023-06-01"
    schema = json.loads(forwarded)["tools"][0]["input_schema"]
    assert "maxLength" not in schema["properties"]["script"]
    assert int(headers["Content-Length"]) == len(forwarded)


def test_proxy_forwards_a_clean_request_byte_for_byte(proxy):
    payload = {"model": "m", "messages": [{"role": "user", "content": "hi"}]}
    raw = json.dumps(payload).encode()
    post(proxy, "/v1/messages", payload)
    assert Upstream.received[0][2] == raw


def test_proxy_relays_a_streaming_response(proxy):
    import urllib.request

    request = urllib.request.Request(
        proxy + "/v1/stream", data=json.dumps({"tools": [WORKFLOW_TOOL]}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.headers["Content-Type"] == "text/event-stream"
        assert response.read() == b"data: 0\n\ndata: 1\n\ndata: 2\n\ndata: [DONE]\n\n"


def test_proxy_reports_a_dead_upstream_as_502():
    import urllib.error
    import urllib.request

    options = shim.argparse.Namespace(
        upstream="http://127.0.0.1:1", timeout=5, threshold=shim.REPETITION_THRESHOLD,
        int_bound_limit=shim.DEFAULT_INT_BOUND_LIMIT, keep_int_bounds=False, verbose=False,
    )
    front = ThreadingHTTPServer(("127.0.0.1", 0), shim.make_handler(options))
    threading.Thread(target=front.serve_forever, daemon=True).start()
    try:
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(
                urllib.request.Request(
                    f"http://127.0.0.1:{front.server_address[1]}/v1/messages", data=b"{}"
                ),
                timeout=15,
            )
        assert caught.value.code == 502
    finally:
        front.shutdown(); front.server_close()


# -- tool_result flattening -------------------------------------------------
# LM Studio's /v1/messages returns 400 "Only text tool_result blocks are
# supported when tool_result.content is an array" for anything else. Claude
# Code legitimately produces image results, and the block persists in history,
# so one screenshot breaks every later turn until it is flattened.

IMAGE_TOOL_RESULT = {
    "messages": [
        {"role": "assistant", "content": [
            {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "/a.png"}}]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": [
                {"type": "text", "text": "read 1 image"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBOR"}},
            ]},
        ]},
    ]
}


def test_image_tool_result_becomes_text():
    payload = json.loads(json.dumps(IMAGE_TOOL_RESULT))
    findings = shim.sanitize_request(payload)
    inner = payload["messages"][1]["content"][0]["content"]
    assert all(b["type"] == "text" for b in inner), inner
    assert inner[0]["text"] == "read 1 image"
    # The placeholder names what was dropped, so the model is not left guessing.
    assert "image/png" in inner[-1]["text"]
    assert any("tool_result" in f["path"] for f in findings)


def test_the_dropped_block_is_replaced_not_deleted():
    """A tool_use with no visible result makes the model re-run the tool."""
    payload = json.loads(json.dumps(IMAGE_TOOL_RESULT))
    payload["messages"][1]["content"][0]["content"] = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "x"}}
    ]
    shim.sanitize_request(payload)
    inner = payload["messages"][1]["content"][0]["content"]
    assert len(inner) == 1 and inner[0]["type"] == "text"
    assert "omitted" in inner[0]["text"]


def test_all_text_tool_results_are_left_alone():
    payload = {"messages": [{"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t", "content": [{"type": "text", "text": "ok"}]}]}]}
    before = json.dumps(payload)
    assert shim.sanitize_request(payload) == []
    assert json.dumps(payload) == before


def test_a_string_tool_result_content_is_untouched():
    """content as a plain string is already valid; the error is array-only."""
    payload = {"messages": [{"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t", "content": "plain text"}]}]}
    assert shim.sanitize_request(payload) == []
    assert payload["messages"][0]["content"][0]["content"] == "plain text"


def test_flattening_does_not_disturb_other_blocks():
    payload = json.loads(json.dumps(IMAGE_TOOL_RESULT))
    shim.sanitize_request(payload)
    assert payload["messages"][0]["content"][0]["type"] == "tool_use"
    assert payload["messages"][0]["content"][0]["input"] == {"file_path": "/a.png"}


def test_malformed_message_shapes_do_not_raise():
    for payload in ({"messages": "no"}, {"messages": [None, 7, {"content": None}]},
                    {"messages": [{"content": [{"type": "tool_result", "content": 5}]}]}):
        assert shim.sanitize_request(payload) == []
