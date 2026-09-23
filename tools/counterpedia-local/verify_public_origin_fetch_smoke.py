#!/usr/bin/env python3
"""DOMAIN-CONSUMER-FIX0 — real packaged-extension public-origin fetch smoke.

Loads the built ``dist/`` (the PRODUCTION manifest, which intentionally
declares no remote ``host_permissions``) into a ``--load-extension``-honoring
Google Chrome for Testing (new headless), attaches
to the extension's own service-worker target over CDP, and performs a real
``fetch()`` of the three public Counterpedia index files from that
``chrome-extension://`` context:

    search-index.json
    activity-index.json
    source-resolution-index.json

It asserts all three return HTTP 200. This is NOT a mocked unit test: the fetch
is issued by the packaged extension itself. The public origin currently permits
these reads through CORS, so this smoke deliberately proves the zero-required-
host-permission production posture. Stable-channel Chrome (152+) silently ignores
``--load-extension``
and cannot be used; resolution requires a Chrome-for-Testing / Chromium build.

Browser resolution order:
  1. $DEMO_BROWSER0_BINARY (if set)
  2. demo_browser.resolve_demo_browser() (Playwright CfT cache, etc.)
Exit 0 = PASS; non-zero = FAIL / could-not-run.
"""
from __future__ import annotations
import base64, json, os, shutil, socket, struct, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
EXT_ROOT = HERE.parent.parent
DIST = EXT_ROOT / "dist"
PORT = int(os.environ.get("SMOKE_CDP_PORT", "9922"))
ORIGIN = "https://counterpedia.vercel.app"
FILES = ["search-index.json", "activity-index.json", "source-resolution-index.json"]


def log(m: str) -> None:
    print(f"[origin-smoke] {m}", flush=True)


def resolve_browser() -> Path:
    env = os.environ.get("DEMO_BROWSER0_BINARY")
    if env and Path(env).exists():
        return Path(env)
    try:
        import demo_browser as db  # type: ignore
        return db.resolve_demo_browser()
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"no --load-extension-capable browser found: {exc}")


def hj(path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=4) as r:
        return json.loads(r.read().decode())


class WS:
    def __init__(self, url: str):
        hostport, path = url[5:].split("/", 1)
        path = "/" + path
        host, port = hostport.split(":")
        self.s = socket.create_connection((host, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(
            (f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
             f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
             f"Origin: http://127.0.0.1:{port}\r\n\r\n").encode())
        b = b""
        while b"\r\n\r\n" not in b:
            b += self.s.recv(4096)
        assert b"101" in b.split(b"\r\n")[0], b[:120]
        self.rx = b""

    def send(self, o) -> None:
        d = json.dumps(o).encode(); m = os.urandom(4); n = len(d); h = bytearray([0x81])
        if n < 126: h.append(0x80 | n)
        elif n < 65536: h.append(0x80 | 126); h += struct.pack(">H", n)
        else: h.append(0x80 | 127); h += struct.pack(">Q", n)
        h += m
        self.s.sendall(bytes(h) + bytes(x ^ m[i % 4] for i, x in enumerate(d)))

    def _r(self, n: int) -> bytes:
        while len(self.rx) < n:
            self.rx += self.s.recv(65536)
        o, self.rx = self.rx[:n], self.rx[n:]
        return o

    def recv(self) -> str:
        p = b""
        while True:
            b0, b1 = self._r(2); fin = b0 & 0x80; ln = b1 & 0x7f
            if ln == 126: ln = struct.unpack(">H", self._r(2))[0]
            elif ln == 127: ln = struct.unpack(">Q", self._r(8))[0]
            p += self._r(ln)
            if fin: break
        return p.decode("utf-8", "replace")


def evaluate(ws_url: str):
    ws = WS(ws_url)
    expr = ("(async()=>{const b=%r;const fs=%r;const o={};for(const f of fs){try{"
            "const r=await fetch(b+'/counterpedia/'+f,{credentials:'omit',cache:'no-store'});"
            "let n=-1;try{const j=await r.json();n=Array.isArray(j.entries)?j.entries.length:"
            "(Array.isArray(j)?j.length:Object.keys(j||{}).length);}catch(e){}"
            "o[f]={ok:r.ok,status:r.status,shape:n};}catch(e){o[f]={ok:false,error:String(e)};}}"
            "return JSON.stringify(o);})()" % (ORIGIN, FILES))
    ws.send({"id": 1, "method": "Runtime.evaluate",
             "params": {"expression": expr, "awaitPromise": True, "returnByValue": True}})
    for _ in range(400):
        m = json.loads(ws.recv())
        if m.get("id") == 1:
            return m
    return None


def main() -> int:
    if not (DIST / "manifest.json").exists():
        log("dist/ not built — run `npm run build` first"); return 3
    browser = resolve_browser()
    ud = Path(tempfile.mkdtemp(prefix="originsmoke_"))
    proc = subprocess.Popen(
        [str(browser), f"--user-data-dir={ud}", f"--load-extension={DIST}",
         f"--disable-extensions-except={DIST}", f"--remote-debugging-port={PORT}",
         "--remote-allow-origins=*", "--headless=new", "--disable-gpu",
         "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
         "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(40):
            try:
                hj("/json/version"); up = True; break
            except Exception:
                time.sleep(0.5)
        if not up:
            log("CDP never came up"); return 4
        target = None; extid = None; deadline = time.time() + 25
        while time.time() < deadline:
            tl = hj("/json/list")
            exts = [t for t in tl if t.get("url", "").startswith("chrome-extension://")]
            sw = [t for t in exts if t.get("type") in ("service_worker", "background_page", "worker")]
            page = [t for t in exts if t.get("type") == "page" and "/panel/" in t.get("url", "")]
            if sw: target = sw[0]; break
            if page: target = page[0]; break
            if exts and extid is None:
                extid = exts[0]["url"].split("/")[2]
            if extid:
                try: hj(f"/json/new?chrome-extension://{extid}/dist/panel/index.html")
                except Exception: pass
            time.sleep(0.6)
        if not target:
            log("no extension target appeared (browser does not honor --load-extension?)"); return 5
        extid = target["url"].split("/")[2]
        log(f"extension loaded id={extid} target={target['type']}")
        res = evaluate(target["webSocketDebuggerUrl"])
        if not res or "result" not in res:
            log(f"CDP eval failed: {res}"); return 6
        val = res["result"].get("result", {}).get("value")
        if val is None:
            log(f"no eval value: {res}"); return 6
        data = json.loads(val); allok = True
        log(f"fetch from chrome-extension://{extid} (production manifest, zero remote host_permissions):")
        for f in FILES:
            r = data.get(f, {})
            ok = bool(r.get("ok")) and r.get("status") == 200
            allok = allok and ok
            log(f"  {f:32s} ok={r.get('ok')} status={r.get('status')} "
                f"entries/rows={r.get('shape')} {r.get('error','')}")
        print("SMOKE_RESULT=" + ("PASS" if allok else "FAIL"))
        return 0 if allok else 7
    finally:
        try:
            proc.terminate(); proc.wait(timeout=5)
        except Exception:
            try: proc.kill()
            except Exception: pass
        shutil.rmtree(ud, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
