# Canvas Voice Agent (Certify MCP)

A voice assistant with two personalities (Professor Owl and Coach Blaze) that answers spoken questions about your Canvas courses using a **read-only Canvas MCP server** and a Gemini model.

## Setup

```bash
pip install langchain langchain-google-genai langchain-mcp-adapters mcp edge-tts pygame-ce SpeechRecognition python-dotenv httpx pyaudiowpatch
```

(`pyaudiowpatch` replaces `pyaudio`, which has no Python 3.14 build. The code aliases it automatically. On older Python, `pip install pyaudio` works.)

Copy `.env.example` to `.env` and fill it in. Never commit `.env` or show it in screenshots.

```
GEMINI_API_KEY=...
CANVAS_API_TOKEN=...
CANVAS_URL=https://byui.instructure.com
```

Run: `python voice_agent.py` (voice), `--text` (type, hear replies), or `--quiet` (type, no audio).
Say "switch voice" to change personality, "exit" to quit.

### Web demo page

```bash
python web_app.py
```

Open http://127.0.0.1:8765 in Chrome or Edge. The mic button listens (the browser's speech recognition), and the **Swap coach** button switches between Professor Owl and Coach Blaze and plays the new greeting. The server only listens on localhost and rejects cross-site requests. In browsers without speech recognition, a typing box appears instead.

**Demo mode** (button on the page) answers from a fixed script in `demo_script.py` instead of calling Gemini, so it works without a key and is predictable for recordings. It handles the day, time, classes, what is due, announcements, "who are you", and refuses write requests. Canvas facts still come from the MCP tools, and each coach has its own wording. Click the example questions on the page or speak them.

The page changes color and avatar with each coach (indigo owl, orange flame), shows whether Canvas and Gemini are connected, and turns demo mode on by itself when there is no Gemini key.

Test the scripted answers (no key or network needed): `python -m unittest test_demo_script -v`

**Run demo** plays the whole script hands-free: the first coach answers every scripted question out loud, then the page swaps to the other coach for two more. It takes about two minutes, and the button turns into **Stop demo** while it runs. Good for recording the video.

## What the MCP exposes

`canvas_mcp_server.py` is a stdio MCP server with four tools, all of which only make HTTP GET requests:

| Tool | Data returned |
| --- | --- |
| `list_courses` | Names and ids of your active courses |
| `get_upcoming_assignments` | Upcoming assignment names, due dates, points for one course |
| `get_announcements` | Recent announcement titles and text for one course |
| `get_todo_items` | Your Canvas to-do list |

## Permissions

- Uses your personal Canvas access token, which can do whatever your account can. Canvas does not let personal tokens be scoped, so safety comes from the server: it has **no** write tools (no submitting, editing, deleting, or messaging), and the agent only ever sees tool output, never the token.
- The agent is also instructed to refuse write requests and to never invent data.
- Spoken audio is sent to Google's speech recognition; text replies go to Edge TTS for the voice.

## Error handling

- MCP server fails to start: the agent warns you and keeps chatting without Canvas.
- Canvas unreachable, expired token, or no access: tools return `CANVAS_UNAVAILABLE: ...` and the agent explains it.
- No results: tools return `EMPTY: ...` and the agent says there is nothing to show.
- Gemini key/quota problems, no mic, or no audio device: spoken or printed friendly message instead of a crash.
- Unsafe requests (for example "submit my assignment"): politely declined.

## Demo prompts

1. "What courses am I taking?"
2. "What is due soon?"
3. "Any announcements in Dynamic Web Fundamentals?"
4. "Submit my assignment for me." (should be declined)
