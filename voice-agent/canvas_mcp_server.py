"""Read-only Canvas MCP server (stdio).

Exposes four tools that only ever perform HTTP GET requests against the
Canvas LMS API. There is deliberately no tool that submits, edits, deletes,
or messages anything, so the voice agent cannot change your Canvas data.

Environment (loaded from .env here or in the parent folder):
    CANVAS_API_TOKEN  your personal access token (never printed or returned)
    CANVAS_URL        e.g. https://byui.instructure.com
"""
import functools
import html as html_lib
import os
import re
from pathlib import Path

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")
load_dotenv(HERE.parent / ".env")  # fall back to the project-level .env

TOKEN = os.getenv("CANVAS_API_TOKEN", "")
BASE_URL = os.getenv("CANVAS_URL", "https://byui.instructure.com").rstrip("/")

mcp = FastMCP("canvas-readonly")


class CanvasError(Exception):
    """Raised with a short, safe message (never includes the token)."""


def _get(path: str, params: dict | None = None) -> list | dict:
    if not TOKEN:
        raise CanvasError("CANVAS_API_TOKEN is not set in .env.")
    try:
        resp = httpx.get(
            f"{BASE_URL}/api/v1{path}",
            params=params,
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        raise CanvasError(f"Could not reach Canvas ({type(exc).__name__}).") from None
    if resp.status_code == 401:
        raise CanvasError("Canvas rejected the access token (401). It may be expired.")
    if resp.status_code == 403:
        raise CanvasError("Canvas says this token is not allowed to see that (403).")
    if resp.status_code == 404:
        raise CanvasError("Canvas could not find that course or item (404).")
    if resp.status_code >= 400:
        raise CanvasError(f"Canvas returned an error ({resp.status_code}).")
    return resp.json()


def _strip_html(html: str | None, limit: int = 400) -> str:
    text = html_lib.unescape(re.sub(r"<[^>]+>", " ", html or ""))
    text = re.sub(r"[\s ]+", " ", text).replace("�", "").strip()
    return text[:limit] + ("..." if len(text) > limit else "")


def _safe(fn):
    """Turn failures into a plain message the agent can relay."""

    @functools.wraps(fn)  # keeps the real signature so FastMCP builds the schema
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except CanvasError as exc:
            return f"CANVAS_UNAVAILABLE: {exc}"

    return wrapper


@mcp.tool()
@_safe
def list_courses() -> str:
    """List the user's current active Canvas courses with their ids."""
    courses = _get("/courses", {"enrollment_state": "active", "per_page": 50})
    rows = [f"{c['id']}: {c.get('name', 'Unnamed course')}" for c in courses if c.get("name")]
    return "\n".join(rows) if rows else "EMPTY: No active courses were found."


@mcp.tool()
@_safe
def get_upcoming_assignments(course_id: int, limit: int = 10) -> str:
    """List not-yet-due assignments for one course, soonest first.

    Args:
        course_id: Canvas course id from list_courses.
        limit: Maximum number of assignments to return (1-25).
    """
    limit = max(1, min(limit, 25))
    items = _get(
        f"/courses/{course_id}/assignments",
        {"bucket": "upcoming", "order_by": "due_at", "per_page": limit},
    )
    rows = [
        f"- {a['name']} (due {a['due_at']}, {a.get('points_possible') or 0} pts)"
        for a in items[:limit]
        if a.get("due_at")
    ]
    return "\n".join(rows) if rows else "EMPTY: No upcoming assignments with due dates."


@mcp.tool()
@_safe
def get_announcements(course_id: int, limit: int = 3) -> str:
    """Get the most recent announcements for one course (text only).

    Args:
        course_id: Canvas course id from list_courses.
        limit: Maximum number of announcements to return (1-10).
    """
    limit = max(1, min(limit, 10))
    items = _get(
        "/announcements",
        {"context_codes[]": f"course_{course_id}", "per_page": limit},
    )
    rows = [
        f"- {a.get('title', 'Untitled')} ({(a.get('posted_at') or '')[:10]}): "
        f"{_strip_html(a.get('message'))}"
        for a in items[:limit]
    ]
    return "\n".join(rows) if rows else "EMPTY: No announcements for this course."


@mcp.tool()
@_safe
def get_todo_items() -> str:
    """List the user's Canvas to-do items (things needing attention soon)."""
    items = _get("/users/self/todo")
    rows = []
    for t in items:
        a = t.get("assignment") or {}
        rows.append(f"- {a.get('name', t.get('type', 'Item'))} (due {a.get('due_at', 'no date')})")
    return "\n".join(rows) if rows else "EMPTY: Nothing on the to-do list."


if __name__ == "__main__":
    mcp.run(transport="stdio")
