"""Scripted answers for demo mode (no Gemini needed).

Questions are matched by keyword. Date and time come from the computer's clock;
Canvas facts come from the same MCP tools the real agent uses, so the demo still
shows a live MCP connection. Each coach has its own wording.
"""
import asyncio
import re
from datetime import datetime, timedelta, timezone

EXAMPLES = [
    "What day is it?",
    "What classes do I have?",
    "What is due soon?",
    "Any announcements?",
    "Can you submit my assignment?",
    "Who are you?",
]

STYLE = {
    "1": {  # Professor Owl
        "open": "Hoo, ",
        "close": " Wisdom comes one step at a time.",
        "hello": "Hoo-hello, dear student! I can tell you the date, your courses, what is due, and announcements.",
        "who": "I am Professor Owl, your calm study mentor. I read your Canvas courses through a read-only connection.",
        "no": "Hoo, I cannot do that. I can only read your Canvas, never change it. Please do that part in Canvas yourself.",
        "unknown": "Hmm, that is outside my demo script. Try asking the day, your classes, what is due, or announcements.",
    },
    "2": {  # Coach Blaze
        "open": "Alright, ",
        "close": " Let's go, you've got this!",
        "hello": "Hey champ! Ask me the date, your classes, what is due, or announcements. Let's roll!",
        "who": "I am Coach Blaze, your deadline coach! I look at your Canvas through a read-only connection and keep you on track.",
        "no": "Whoa, no can do! I only read your Canvas, I can never change it. You make that play yourself in Canvas!",
        "unknown": "That is not in my playbook for the demo! Try the day, your classes, what is due, or announcements.",
    },
}


def _text(result) -> str:
    if isinstance(result, list):
        return "\n".join(b.get("text", "") for b in result if isinstance(b, dict))
    return str(result)


def _call(tools: dict, name: str, args: dict | None = None) -> str:
    if name not in tools:
        return "CANVAS_UNAVAILABLE: Canvas is not connected."
    try:
        return _text(asyncio.run(tools[name].ainvoke(args or {})))
    except Exception as exc:
        return f"CANVAS_UNAVAILABLE: {type(exc).__name__}"


def _courses(raw: str) -> list[tuple[int, str]]:
    return [(int(i), n) for i, n in re.findall(r"^(\d+): (.+)$", raw, re.M)]


def _upcoming(raw: str):
    """Parse '- name (due ISO)' lines, keep future ones, soonest first."""
    now = datetime.now(timezone.utc)
    items = []
    for name, due in re.findall(r"^- (.+?) \(due (\d{4}-[^ )]+)", raw, re.M):
        try:
            when = datetime.fromisoformat(due.replace("Z", "+00:00"))
        except ValueError:
            continue
        if when >= now:
            items.append((when, name))
    return sorted(items)


def _say_date(when: datetime) -> str:
    when = when.astimezone()
    return f"{when:%A, %B} {when.day}"


def _say_due(when: datetime) -> str:
    when = when.astimezone()
    return f"{when:%A %B} {when.day} at {when:%I:%M %p}".replace(" 0", " ")


def _has(text: str, *words: str) -> bool:
    return any(re.search(rf"\b{re.escape(w)}", text) for w in words)


def respond(key: str, question: str, tools: dict) -> str:
    s = STYLE.get(key, STYLE["1"])
    q = question.lower()
    now = datetime.now()

    if _has(q, "submit", "delete", "turn in", "send", "email", "post my", "change my", "edit", "grade"):
        return s["no"]
    if _has(q, "who are you", "your name", "what are you", "introduce"):
        return s["who"]
    if _has(q, "hello", "hi", "hey", "help", "what can you do"):
        return s["hello"]
    if _has(q, "what time", "the time", "o'clock"):
        return f"{s['open']}it is {now:%I:%M %p}.".replace(" 0", " ", 1) + s["close"]
    if _has(q, "what day", "today", "the date", "what's the date", "what is the date", "day is it"):
        return f"{s['open']}today is {_say_date(now)}." + s["close"]
    if _has(q, "tomorrow"):
        return f"{s['open']}tomorrow is {_say_date(now + timedelta(days=1))}." + s["close"]

    if _has(q, "class", "course", "enrolled", "taking"):
        courses = _courses(_call(tools, "list_courses"))
        if not courses:
            return s["open"] + "I could not find any courses right now. Canvas may be unreachable."
        names = [n for _, n in courses]
        listed = ", ".join(names[:-1]) + (f", and {names[-1]}" if len(names) > 1 else names[0])
        return f"{s['open']}you have {len(names)} courses: {listed}." + s["close"]

    if _has(q, "due", "assignment", "homework", "to-do", "todo", "deadline", "soon", "upcoming"):
        items = _upcoming(_call(tools, "get_todo_items"))[:3]
        if not items:
            return s["open"] + "nothing is due soon. Your to-do list is clear." + s["close"]
        parts = [f"{name}, due {_say_due(when)}" for when, name in items]
        return f"{s['open']}here is what is next: " + "; ".join(parts) + "." + s["close"]

    if _has(q, "announcement", "news", "posted"):
        courses = _courses(_call(tools, "list_courses"))
        pick = next((c for c in courses if any(w in q for w in c[1].lower().split() if len(w) > 3)), None)
        for cid, cname in ([pick] if pick else courses):
            raw = _call(tools, "get_announcements", {"course_id": cid, "limit": 1})
            m = re.match(r"- (.+?) \((\d{4}-\d{2}-\d{2})\): (.*)", raw, re.S)
            if m:
                body = m.group(3).strip()[:160].rsplit(" ", 1)[0]
                return f"{s['open']}the latest in {cname} is {m.group(1)}. It says: {body}..." + s["close"]
        return s["open"] + "there are no announcements to share right now." + s["close"]

    return s["unknown"]
