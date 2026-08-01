#!/usr/bin/env python3
"""Make Claude Code's tool schemas survive llama.cpp's grammar compiler.

The failure this exists for
---------------------------
Every Claude Code request that carries tools comes back as:

    parse: error parsing grammar: number of repetitions exceeds sane defaults
    failed to parse grammar
    Failed to initialize samplers: failed to parse grammar
    400 invalid_request_error

The same server answers fine when `tools` is empty, which is why Chat and
Cowork work and Code mode does not.

LM Studio compiles the tool JSON schemas into a GBNF grammar so the model can
only emit a well-formed tool call. llama.cpp turns a bounded string into a
counted repetition (common/json-schema-to-grammar.cpp:971):

    "maxLength": 524288   ->   tool-Workflow-schema-script ::= "\\"" char{0,524288} "\\""

and then refuses to compile it (src/llama-grammar.cpp:652, threshold 2000):

    if (min_times > MAX_REPETITION_THRESHOLD || (has_max && max_times > ...))
        throw std::runtime_error("number of repetitions exceeds sane defaults ...");

Claude Code's Workflow.script is capped at 512 KiB, so one tool poisons the
whole request. Sampler init happens after templating, so the chat template is
not involved and cannot fix it.

What this does
--------------
Sits between Claude Code and LM Studio and removes the bounds that llama.cpp
cannot compile, leaving everything else byte-identical.

It removes rather than clamps. Clamping `maxLength` to 2000 would let the
grammar compile and then truncate a 512 KiB script at 2000 characters, turning
a loud 400 into a silently corrupted tool call. Dropping the keyword makes the
grammar rule unbounded (`char*`), which is what the tool actually wants: the
bound was advisory, not a decoding constraint.

Usage
-----
    # see which tools would break, without running a proxy
    python3 scripts/regescore_schema_shim.py --inspect captured-request.json

    # run in front of LM Studio
    python3 scripts/regescore_schema_shim.py --listen 2127 --upstream http://127.0.0.1:2126

then point the client at the shim:

    setx ANTHROPIC_BASE_URL http://127.0.0.1:2127
    setx ANTHROPIC_AUTH_TOKEN lm-studio

Everything that is not a tool schema is proxied untouched, including streaming
responses, which are forwarded line by line so tokens still arrive live.

RegesCore // Fable 5 - brand and engineering by davidio.dev
"""
from __future__ import annotations

import argparse
import http.client
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

# src/llama-grammar.cpp:13 - #define MAX_REPETITION_THRESHOLD 2000.
# A bound equal to the threshold compiles; only a greater one throws.
REPETITION_THRESHOLD = 2000

# Keywords json-schema-to-grammar turns into a counted repetition.
COUNTED_KEYWORDS = ("maxLength", "minLength", "maxItems", "minItems")

# Integer bounds do not throw - they expand into an alternation of digit
# ranges - but a JS-safe-integer bound expands into hundreds of rules that
# constrain nothing. 2**53-1 is "no limit" expressed as a number.
INT_BOUND_KEYWORDS = ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum")
DEFAULT_INT_BOUND_LIMIT = 1_000_000_000

# Hop-by-hop headers are per-connection and must not be relayed (RFC 9110 7.6.1).
HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "trailers",
        "transfer-encoding",
        "upgrade",
    }
)


class Finding(dict):
    """One removed keyword, reported so the operator can see what changed."""


def sanitize(
    node,
    findings: list[Finding],
    path: str = "",
    threshold: int = REPETITION_THRESHOLD,
    int_bound_limit: int | None = DEFAULT_INT_BOUND_LIMIT,
) -> bool:
    """Strip uncompilable bounds from a JSON-schema tree, in place.

    Returns True if anything was removed. Walks every dict and list, because a
    tool schema nests these arbitrarily deep (Claude Code's ReportFindings puts
    the offending bound under properties.findings.items.properties.line).
    """
    changed = False

    if isinstance(node, list):
        for index, item in enumerate(node):
            changed |= sanitize(item, findings, f"{path}[{index}]", threshold, int_bound_limit)
        return changed

    if not isinstance(node, dict):
        return False

    for keyword in COUNTED_KEYWORDS:
        value = node.get(keyword)
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        if value > threshold:
            del node[keyword]
            findings.append(
                Finding(path=f"{path}.{keyword}".lstrip("."), keyword=keyword,
                        value=value, reason=f"exceeds llama.cpp repetition threshold {threshold}")
            )
            changed = True

    if int_bound_limit is not None:
        for keyword in INT_BOUND_KEYWORDS:
            value = node.get(keyword)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            if abs(value) > int_bound_limit:
                del node[keyword]
                findings.append(
                    Finding(path=f"{path}.{keyword}".lstrip("."), keyword=keyword,
                            value=value, reason="bound is larger than any real value; expands the grammar for nothing")
                )
                changed = True

    for key, value in list(node.items()):
        if isinstance(value, (dict, list)):
            child = f"{path}.{key}" if path else key
            changed |= sanitize(value, findings, child, threshold, int_bound_limit)

    return changed


def sanitize_request(
    payload,
    threshold: int = REPETITION_THRESHOLD,
    int_bound_limit: int | None = DEFAULT_INT_BOUND_LIMIT,
) -> list[Finding]:
    """Sanitize the tool schemas of one request body, in place.

    Handles both wire formats the same client can use: Anthropic puts the
    schema at tools[].input_schema, OpenAI at tools[].function.parameters.
    Anything else in the body is left alone.
    """
    findings: list[Finding] = []
    if not isinstance(payload, dict):
        return findings

    tools = payload.get("tools")
    if not isinstance(tools, list):
        return findings

    for tool in tools:
        if not isinstance(tool, dict):
            continue
        name = tool.get("name")
        if not name and isinstance(tool.get("function"), dict):
            name = tool["function"].get("name")
        label = name if isinstance(name, str) else "<unnamed>"

        for schema in (tool.get("input_schema"), tool.get("parameters")):
            if isinstance(schema, dict):
                sanitize(schema, findings, label, threshold, int_bound_limit)

        function = tool.get("function")
        if isinstance(function, dict) and isinstance(function.get("parameters"), dict):
            sanitize(function["parameters"], findings, label, threshold, int_bound_limit)

    return findings


def make_handler(options):
    upstream = urlsplit(options.upstream)
    host = upstream.hostname or "127.0.0.1"
    port = upstream.port or (443 if upstream.scheme == "https" else 80)
    secure = upstream.scheme == "https"
    lock = threading.Lock()
    seen: set[str] = set()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "RegesCoreSchemaShim/1.0"

        def log_message(self, fmt, *args):  # quieter than the default access log
            if options.verbose:
                sys.stderr.write("  %s\n" % (fmt % args))

        def note(self, text: str) -> None:
            sys.stderr.write(text + "\n")
            sys.stderr.flush()

        def read_body(self) -> bytes:
            length = self.headers.get("Content-Length")
            if length is None:
                return b""
            try:
                return self.rfile.read(int(length))
            except (ValueError, OSError):
                return b""

        def rewrite(self, body: bytes) -> bytes:
            if not body:
                return body
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                return body  # not JSON; none of our business

            findings = sanitize_request(
                payload, options.threshold,
                None if options.keep_int_bounds else options.int_bound_limit,
            )
            if not findings:
                return body

            # One line per distinct bound, not per request: Claude Code resends
            # the same tool set on every turn and the log would drown.
            with lock:
                fresh = [f for f in findings if f["path"] + str(f["value"]) not in seen]
                for finding in fresh:
                    seen.add(finding["path"] + str(finding["value"]))
            for finding in fresh:
                self.note(f"  removed {finding['path']} = {finding['value']}  ({finding['reason']})")

            return json.dumps(payload, ensure_ascii=False).encode("utf-8")

        def proxy(self, body: bytes) -> None:
            connection = (
                http.client.HTTPSConnection(host, port, timeout=options.timeout)
                if secure
                else http.client.HTTPConnection(host, port, timeout=options.timeout)
            )
            headers = {
                key: value
                for key, value in self.headers.items()
                if key.lower() not in HOP_BY_HOP and key.lower() != "content-length"
            }
            headers["Host"] = f"{host}:{port}"
            if body:
                headers["Content-Length"] = str(len(body))

            try:
                connection.request(self.command, self.path, body=body or None, headers=headers)
                response = connection.getresponse()
            except OSError as error:
                self.note(f"  upstream {options.upstream} unreachable: {error}")
                self.send_error(502, "upstream unreachable", str(error))
                connection.close()
                return

            relayed = [
                (key, value)
                for key, value in response.getheaders()
                if key.lower() not in HOP_BY_HOP and key.lower() != "content-length"
            ]
            streaming = "text/event-stream" in (response.getheader("Content-Type") or "")

            try:
                if streaming:
                    # SSE has no length. Frame it ourselves and flush every line
                    # so tokens reach the client as the model produces them.
                    self.send_response(response.status)
                    for key, value in relayed:
                        self.send_header(key, value)
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    while True:
                        line = response.readline()
                        if not line:
                            break
                        self.wfile.write(b"%x\r\n" % len(line) + line + b"\r\n")
                        self.wfile.flush()
                    self.wfile.write(b"0\r\n\r\n")
                else:
                    payload = response.read()
                    self.send_response(response.status)
                    for key, value in relayed:
                        self.send_header(key, value)
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass  # the client hung up mid-stream; nothing to report
            finally:
                connection.close()

        def handle_any(self) -> None:
            self.proxy(self.rewrite(self.read_body()))

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = handle_any

    return Handler


def inspect(path: Path, options) -> int:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return fail(f"cannot read {path}: {error}")

    findings = sanitize_request(
        payload, options.threshold,
        None if options.keep_int_bounds else options.int_bound_limit,
    )

    print(f"\nRegesCore schema inspection - davidio.dev\n  file: {path}")
    tools = payload.get("tools") if isinstance(payload, dict) else None
    print(f"  tools in request: {len(tools) if isinstance(tools, list) else 0}")

    fatal = [f for f in findings if f["keyword"] in COUNTED_KEYWORDS]
    noisy = [f for f in findings if f["keyword"] in INT_BOUND_KEYWORDS]

    print("\nBounds llama.cpp cannot compile:")
    for finding in fatal or ():
        print(f"  {finding['path']} = {finding['value']}")
    if not fatal:
        print("  (none) - this request is not what is failing grammar compilation")

    print("\nBounds that only bloat the grammar:")
    for finding in noisy or ():
        print(f"  {finding['path']} = {finding['value']}")
    if not noisy:
        print("  (none)")

    if fatal:
        print(
            f"\nEach of those becomes a counted repetition above llama.cpp's limit of "
            f"{options.threshold},\nso sampler init throws and the whole request returns 400."
            "\nRun this script as a proxy to strip them, or drop the tool with "
            "--disallowedTools."
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Strip tool-schema bounds llama.cpp cannot compile into a grammar",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--listen", type=int, default=2127, help="local port to serve on")
    parser.add_argument("--bind", default="127.0.0.1", help="address to bind")
    parser.add_argument("--upstream", default="http://127.0.0.1:2126", help="LM Studio server root")
    parser.add_argument("--timeout", type=int, default=900, help="upstream socket timeout, seconds")
    parser.add_argument(
        "--threshold", type=int, default=REPETITION_THRESHOLD,
        help=f"remove counted bounds above this (llama.cpp uses {REPETITION_THRESHOLD})",
    )
    parser.add_argument(
        "--int-bound-limit", type=int, default=DEFAULT_INT_BOUND_LIMIT,
        help="remove integer minimum/maximum whose magnitude exceeds this",
    )
    parser.add_argument(
        "--keep-int-bounds", action="store_true",
        help="leave integer bounds alone; they bloat the grammar but do not break it",
    )
    parser.add_argument("--inspect", type=Path, help="report on a saved request body and exit")
    parser.add_argument("-v", "--verbose", action="store_true", help="log every proxied request")
    options = parser.parse_args()

    if options.inspect:
        return inspect(options.inspect, options)

    handler = make_handler(options)
    try:
        server = ThreadingHTTPServer((options.bind, options.listen), handler)
    except OSError as error:
        return fail(f"cannot bind {options.bind}:{options.listen}: {error}")
    server.daemon_threads = True

    print("\nRegesCore schema shim - davidio.dev")
    print(f"  listening : http://{options.bind}:{options.listen}")
    print(f"  upstream  : {options.upstream}")
    print(f"  removing  : {', '.join(COUNTED_KEYWORDS)} above {options.threshold}")
    if not options.keep_int_bounds:
        print(f"              integer bounds above {options.int_bound_limit:,} in magnitude")
    print("\nPoint the client here:")
    print(f"  setx ANTHROPIC_BASE_URL http://{options.bind}:{options.listen}")
    print("  setx ANTHROPIC_AUTH_TOKEN lm-studio")
    print("\nRemovals are reported once each. Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
    return 0


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
