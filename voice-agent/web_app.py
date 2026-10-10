"""Tiny local web UI for the Canvas voice agent (demo-friendly).

Run:  python web_app.py     then open http://127.0.0.1:8765 in Chrome or Edge.

The browser listens (Web Speech API) and plays audio; this server runs the same
Gemini agent + Canvas MCP tools as voice_agent.py and synthesizes the voice with
edge-tts. It binds to localhost only.
"""
import asyncio
import base64
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import edge_tts

import demo_script
import voice_agent as va

HOST, PORT = "127.0.0.1", 8765
INDEX = Path(__file__).parent / "web" / "index.html"
MAX_TEXT = 1000

state = {"tools": [], "agents": {}, "history": {}}


def synth(text: str, persona: dict) -> str:
    """Return base64 mp3 of the text in the persona's voice ('' on failure)."""
    clean = va.re.sub(r"[\*_#`]", "", text)

    async def run() -> bytes:
        com = edge_tts.Communicate(clean, persona["voice"], rate=persona["rate"])
        return b"".join([c["data"] async for c in com.stream() if c["type"] == "audio"])

    try:
        return base64.b64encode(asyncio.run(run())).decode()
    except Exception as exc:
        print(f"[tts unavailable: {type(exc).__name__}]")
        return ""


def get_agent(key: str):
    if key not in state["agents"]:
        state["agents"][key] = va.configure_agent(va.PERSONAS[key], state["tools"])
    return state["agents"][key]


def reply_for(key: str, prompt: str, demo: bool = False) -> str:
    if demo:  # scripted answers, no Gemini call
        tools = {t.name: t for t in state["tools"]}
        return demo_script.respond(key, prompt, tools)
    if not os.getenv("GOOGLE_API_KEY"):
        return "I have no Gemini key set. Turn on demo mode to try the scripted questions."
    persona = va.PERSONAS[key]
    request = (
        f"Respond as {persona['name']}. Your personality is {persona['personality']}. "
        f"{va.SAFETY_RULES} The user's request is: {prompt}"
    )
    hist = state["history"].setdefault(key, [])
    messages = hist[-8:] + [{"role": "user", "content": request}]
    try:
        result = asyncio.run(get_agent(key).ainvoke({"messages": messages}))
        text = va.extract_text(result["messages"][-1]) or "I did not come up with an answer. Could you rephrase?"
    except Exception as exc:
        print(f"[error] {type(exc).__name__}: {exc}")
        return va.friendly_error(exc)
    hist += [{"role": "user", "content": prompt}, {"role": "assistant", "content": text}]
    return text


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict):
        self._send(code, json.dumps(obj).encode())

    def do_GET(self):
        if self.path == "/":
            self._send(200, INDEX.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/state":
            self._json(200, {
                "personas": {k: {"name": p["name"], "title": p["title"]} for k, p in va.PERSONAS.items()},
                "mcp_connected": bool(state["tools"]),
                "gemini_ready": bool(os.getenv("GOOGLE_API_KEY")),
                "demo_examples": demo_script.EXAMPLES,
            })
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        # Reject cross-site requests (a random web page must not drive the agent).
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://{HOST}:{PORT}", f"http://localhost:{PORT}"):
            return self._json(403, {"error": "forbidden"})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 10_000)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad request"})
        key = str(data.get("persona", ""))
        if key not in va.PERSONAS:
            return self._json(400, {"error": "unknown persona"})
        persona = va.PERSONAS[key]

        if self.path == "/api/greeting":
            state["history"][key] = []
            text = persona["greeting"]
            if not state["tools"]:
                text += " Heads up: I could not connect to Canvas, so I can chat but cannot look up your courses."
        elif self.path == "/api/chat":
            prompt = str(data.get("text", "")).strip()[:MAX_TEXT]
            if not prompt:
                return self._json(400, {"error": "empty"})
            text = reply_for(key, prompt, demo=data.get("demo") is True)
        else:
            return self._send(404, b"not found", "text/plain")
        self._json(200, {"name": persona["name"], "text": text, "audio": synth(text, persona)})


def main():
    if not os.getenv("GOOGLE_API_KEY"):
        print("Note: no GEMINI_API_KEY set. Only demo mode will work (add the key to .env for live AI).")
    state["tools"] = va.load_mcp_tools()
    print(f"Open http://{HOST}:{PORT} in Chrome or Edge. Ctrl+C to stop.")
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
