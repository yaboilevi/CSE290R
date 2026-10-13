"""Tests for demo mode answers. Run: python -m unittest test_demo_script -v

Uses fake MCP tools, so no Canvas token, Gemini key, or network is needed.
"""
import unittest
from datetime import datetime, timedelta, timezone

import demo_script as ds

# Freeze the clock at noon so "due today/tomorrow" tests do not depend on when they run.
NOW = datetime.now().astimezone().replace(hour=12, minute=0, second=0, microsecond=0)


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


ds.datetime = FixedDateTime


class FakeTool:
    def __init__(self, name, reply):
        self.name, self.reply = name, reply

    async def ainvoke(self, args):
        return self.reply(args) if callable(self.reply) else self.reply


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_tools(courses=None, todo=None, announcements=None):
    courses = courses if courses is not None else ["101: US History", "202: Dynamic Web Fundamentals"]
    now = NOW
    if todo is None:
        later_today = now + timedelta(hours=11)  # 11 pm today
        todo = [
            f"- Essay draft (due {iso(later_today)})",
            f"- Web quiz (due {iso(now + timedelta(days=3))})",
            f"- Old lab (due {iso(now - timedelta(days=2))})",
        ]
    anns = announcements or {
        101: "- Field trip (2026-10-10): Bring a sack lunch on Friday please.",
        202: "- Week 6 notes (2026-10-11): Read chapter six before class.",
    }
    return {
        "list_courses": FakeTool("list_courses", "\n".join(courses) or "EMPTY: No active courses were found."),
        "get_todo_items": FakeTool("get_todo_items", "\n".join(todo) or "EMPTY: Nothing on the to-do list."),
        "get_announcements": FakeTool("get_announcements", lambda a: anns.get(a["course_id"], "EMPTY: none")),
    }


def ask(q, key="1", **kw):
    return ds.respond(key, q, make_tools(**kw))


class Matching(unittest.TestCase):
    def test_hi_does_not_match_history(self):
        r = ask("Any announcements in history?")
        self.assertIn("Field trip", r)

    def test_short_course_word_picks_that_course(self):
        self.assertIn("Week 6 notes", ask("Any news for web?"))

    def test_no_course_named_falls_back_to_first_with_news(self):
        self.assertIn("Field trip", ask("Any announcements?"))

    def test_grades_question_is_not_called_a_write(self):
        r = ask("What are my grades?")
        self.assertNotEqual(r, ds.STYLE["1"]["no"])
        self.assertIn("grade", r.lower())

    def test_change_grade_is_refused(self):
        self.assertEqual(ask("Change my grade to an A"), ds.STYLE["1"]["no"])

    def test_classes_today_lists_classes(self):
        self.assertIn("US History", ask("What classes do I have today?"))

    def test_due_today_only_lists_today(self):
        r = ask("What is due today?")
        self.assertIn("Essay draft", r)
        self.assertNotIn("Web quiz", r)

    def test_due_tomorrow_when_nothing_then(self):
        r = ask("What is due tomorrow?")
        self.assertIn("nothing", r.lower())
        self.assertIn("Essay draft", r)  # mentions the next thing instead

    def test_greeting_plus_question_answers_question(self):
        self.assertIn("Essay draft", ask("Hey, what's due soon?"))

    def test_due_in_my_class_is_about_due(self):
        self.assertIn("Essay draft", ask("What is due in my class?"))

    def test_past_items_skipped(self):
        self.assertNotIn("Old lab", ask("What is due soon?"))

    def test_edition_is_not_edit(self):
        self.assertNotEqual(ask("What is the textbook edition for my classes?"), ds.STYLE["1"]["no"])

    def test_submit_refused(self):
        self.assertEqual(ask("Can you submit my assignment?"), ds.STYLE["1"]["no"])
        self.assertEqual(ask("Please submit it", key="2"), ds.STYLE["2"]["no"])

    def test_basic_intents(self):
        self.assertIn("today is", ask("What day is it?"))
        self.assertEqual(ask("Who are you?"), ds.STYLE["1"]["who"])
        self.assertIn("it is", ask("What time is it?"))
        self.assertEqual(ask("hello"), ds.STYLE["1"]["hello"])


class Wording(unittest.TestCase):
    def test_two_courses_no_oxford_comma(self):
        self.assertIn("US History and Dynamic Web Fundamentals", ask("What classes do I have?"))

    def test_three_courses(self):
        r = ask("What classes do I have?", courses=["1: A", "2: B", "3: C"])
        self.assertIn("3 courses: A, B, and C", r)

    def test_one_course_singular(self):
        r = ask("What classes do I have?", courses=["1: Solo"])
        self.assertIn("1 course: Solo", r)

    def test_canvas_down_is_reported_for_announcements(self):
        r = ask("Any announcements?", courses=[])
        self.assertIn("Canvas", r)

    def test_coach_wording_differs(self):
        self.assertTrue(ask("What day is it?", key="2").startswith("Alright"))


if __name__ == "__main__":
    unittest.main()
