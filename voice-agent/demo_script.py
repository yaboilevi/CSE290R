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
        "grades": "Hoo, grades are one thing I cannot see. My read-only connection covers courses, due dates, and announcements. Check grades in Canvas.",
    },
    "2": {  # Coach Blaze
        "open": "Alright, ",
        "close": " Let's go, you've got this!",
        "hello": "Hey champ! Ask me the date, your classes, what is due, or announcements. Let's roll!",
        "who": "I am Coach Blaze, your deadline coach! I look at your Canvas through a read-only connection and keep you on track.",
        "no": "Whoa, no can do! I only read your Canvas, I can never change it. You make that play yourself in Canvas!",
        "unknown": "That is not in my playbook for the demo! Try the day, your classes, what is due, or announcements.",
        "grades": "Grades are off my scoreboard! I can only see courses, due dates, and announcements. Check your grades in Canvas, champ.",
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


def _has(text: str, *words: str, exact: bool = False) -> bool:
    """True if any word/phrase appears as a whole word (plural/-ed/-ing allowed unless exact)."""
    suffix = "" if exact else r"(?:s|es|d|ed|ing)?"
    return any(re.search(rf"\b{re.escape(w)}{suffix}\b", text) for w in words)


def _join(names: list[str]) -> str:
    if len(names) <= 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + f", and {names[-1]}"


_STOP = {"the", "and", "for", "any", "are", "was", "what", "with", "from", "about", "have", "latest",
         "news", "announcement", "announcements", "posted", "class", "classes", "course", "courses", "intro"}


def _tokens(text: str) -> set[str]:
    """Words useful for matching a course name (3+ characters, minus filler words)."""
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= 3 and w not in _STOP}


def _no_courses(s: dict, raw: str) -> str:
    if raw.startswith("CANVAS_UNAVAILABLE"):
        return s["open"] + "I could not reach Canvas just now, so I cannot look that up."
    return s["open"] + "I could not find any active courses in Canvas right now."


def respond(key: str, question: str, tools: dict) -> str:
    s = STYLE.get(key, STYLE["1"])
    q = question.lower()
    now = datetime.now()

    # Order matters: refusals first, then Canvas topics, then small talk.
    # Small-talk words like "today" or "hey" often ride along with a real question.
    if _has(q, "submit", "delete", "turn in", "send", "email", "post my", "post a", "change my",
            "edit", "drop my", "message my", "upload"):
        return s["no"]
    if _has(q, "who are you", "your name", "what are you", "introduce"):
        return s["who"]

    if _has(q, "announcement", "news", "posted"):
        raw = _call(tools, "list_courses")
        courses = _courses(raw)
        if not courses:
            return _no_courses(s, raw)
        words = _tokens(q)
        pick = next((c for c in courses if _tokens(c[1]) & words), None)
        for cid, cname in ([pick] if pick else courses):
            ann = _call(tools, "get_announcements", {"course_id": cid, "limit": 1})
            m = re.match(r"- (.+?) \((\d{4}-\d{2}-\d{2})\): (.*)", ann, re.S)
            if m:
                body = m.group(3).strip()
                if len(body) > 160:
                    body = body[:160].rsplit(" ", 1)[0] + "..."
                return f"{s['open']}the latest in {cname} is {m.group(1)}. It says: {body}" + s["close"]
        where = f" in {pick[1]}" if pick else ""
        return s["open"] + f"there are no announcements{where} to share right now." + s["close"]

    if _has(q, "grade", "score", "gpa", "how am i doing"):
        return s["grades"]

    if _has(q, "due", "assignment", "homework", "to-do", "todo", "deadline", "soon", "upcoming", "work on"):
        items = _upcoming(_call(tools, "get_todo_items"))
        day = None
        if _has(q, "today", "tonight", exact=True):
            day, label = now.date(), "today"
        elif _has(q, "tomorrow", exact=True):
            day, label = (now + timedelta(days=1)).date(), "tomorrow"
        if day is not None:
            todays = [(w, n) for w, n in items if w.astimezone().date() == day]
            if not todays:
                nxt = items[0] if items else None
                after = f" The next thing is {nxt[1]}, due {_say_due(nxt[0])}." if nxt else ""
                return f"{s['open']}nothing is due {label}.{after}" + s["close"]
            items = todays
        items = items[:3]
        if not items:
            return s["open"] + "nothing is due soon. Your to-do list is clear." + s["close"]
        parts = [f"{name}, due {_say_due(when)}" for when, name in items]
        lead = f"here is what is due {label}: " if day is not None else "here is what is next: "
        return s["open"] + lead + "; ".join(parts) + "." + s["close"]

    if _has(q, "class", "course", "enrolled", "taking"):
        raw = _call(tools, "list_courses")
        names = [n for _, n in _courses(raw)]
        if not names:
            return _no_courses(s, raw)
        noun = "course" if len(names) == 1 else "courses"
        return f"{s['open']}you have {len(names)} {noun}: {_join(names)}." + s["close"]

    if _has(q, "what time", "the time", "o'clock", exact=True):
        return f"{s['open']}it is {now:%I:%M %p}.".replace(" 0", " ", 1) + s["close"]
    if _has(q, "tomorrow", exact=True):
        return f"{s['open']}tomorrow is {_say_date(now + timedelta(days=1))}." + s["close"]
    if _has(q, "what day", "today", "the date", "day is it", exact=True):
        return f"{s['open']}today is {_say_date(now)}." + s["close"]
    if _has(q, "hello", "hi", "hey", "help", "what can you do", exact=True):
        return s["hello"]

    return s["unknown"]
