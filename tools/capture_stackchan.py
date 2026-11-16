"""mitmproxy add-on: log StackChan server handshakes (Authorization, URL) and WS frames.
Run: mitmdump -s tools/capture_stackchan.py --listen-port 8080
Output: tools/capture.log
"""
import time
from mitmproxy import http, ctx

LOG = "tools/capture.log"

def log(line):
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {line}\n")

def request(flow: http.HTTPFlow):
    # Log every request host briefly, full headers for StackChan-looking ones
    host = flow.request.pretty_host
    log(f"REQ {flow.request.method} {flow.request.scheme}://{host}{flow.request.path}")
    if "stackChan" in flow.request.path or "stackchan" in host.lower():
        for k, v in flow.request.headers.items():
            log(f"    {k}: {v}")

def websocket_message(flow: http.HTTPFlow):
    m = flow.websocket.messages[-1]
    kind = "bin" if not m.is_text else "txt"
    direction = "app->srv" if m.from_client else "srv->app"
    data = m.content[:60]
    if "stackChan" in flow.request.path:
        log(f"WS {direction} {kind} len={len(m.content)} head={data!r}")
