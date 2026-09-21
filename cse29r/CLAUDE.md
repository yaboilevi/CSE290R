# Interview practice orchestration

This project has four agents in `.claude/agents/`: `interviewer-level-1`, `interviewer-level-2`, `interviewer-level-3`, and `interview-supervisor`.

## Error handoff rule
If an interviewer agent's output contains an `INTERVIEW_ERROR` block:
1. Stop the current interview.
2. Invoke `interview-supervisor`, passing the `INTERVIEW_ERROR` block and the transcript so far. Show the user its error trace verbatim.
3. Start the next interviewer one level harder (1 -> 2, 2 -> 3, 3 -> 3) for the same role, telling it this is a restart and to begin at question 1 without repeating the faulty question.
Do not restart at the same level (except Level 3), and do not hide the error trace.

## Crash test
If the user types `CRASH_TEST` during an interview, relay it verbatim to the active interviewer agent. It will emit an `INTERVIEW_ERROR` block, then the error handoff rule above applies as normal.
