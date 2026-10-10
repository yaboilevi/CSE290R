"""Voice agent connected to a read-only Canvas MCP server.

Run:   python voice_agent.py          (microphone + speakers)
       python voice_agent.py --text   (typed input, still speaks replies)
       python voice_agent.py --quiet  (typed input, no audio; handy for testing)
"""
import asyncio
import os
import re
import sys
from pathlib import Path

# SpeechRecognition imports "pyaudio"; on Python 3.14 the maintained fork is
# "pyaudiowpatch". Alias it if the standard package is not installed.
try:
    import pyaudio  # noqa: F401
except ImportError:
    try:
        import pyaudiowpatch

        sys.modules["pyaudio"] = pyaudiowpatch
    except ImportError:
        pass

import edge_tts
import pygame
import speech_recognition as sr
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")
load_dotenv(HERE.parent / ".env")  # Canvas token may live in the project-level .env

# LangChain's Google provider reads GOOGLE_API_KEY; accept GEMINI_API_KEY too.
if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("GEMINI_API_KEY")

os.environ["PYGAME_HIDE_SUPPORT_PROMPT"] = "1"

MODEL = os.getenv("GEMINI_MODEL", "google_genai:gemini-2.5-flash")
SPEECH_FILE = str(HERE / "temp_speech.mp3")
MCP_SERVER = str(HERE / "canvas_mcp_server.py")

# Flags set in main()
TEXT_INPUT = False
SILENT = False

PERSONAS = {
    "1": {
        "name": "PROFESSOR OWL",
        "title": "A calm, wise study mentor who knows your Canvas courses",
        "personality": "calm, encouraging, organized, and brief, with the occasional gentle owl pun",
        "voice": "en-GB-RyanNeural",
        "rate": "-5%",
        "greeting": "Hoo-hello! I am Professor Owl. Ask me about your courses, "
        "what is due soon, or the latest announcements.",
    },
    "2": {
        "name": "COACH BLAZE",
        "title": "A high-energy deadline coach who keeps you on track",
        "personality": "upbeat, motivating, and direct, like a friendly sports coach who loves deadlines",
        "voice": "en-US-GuyNeural",
        "rate": "+8%",
        "greeting": "Let's go! Coach Blaze here. Tell me what you need and "
        "we'll crush this week's assignments together!",
    },
}

SAFETY_RULES = (
    "You can only READ the user's Canvas data through your tools: courses, upcoming "
    "assignments, announcements, and the to-do list. You cannot submit work, edit or "
    "delete anything, send messages, or see passwords or tokens. If asked to do any "
    "of that, say plainly that you can't, and suggest the user do it in Canvas. "
    "Never invent courses, due dates, or announcements. Only report what the tools "
    "return. Call list_courses first if you need a course id. If a tool result starts "
    "with CANVAS_UNAVAILABLE, tell the user Canvas could not be reached and what the "
    "problem was, without guessing. If a result starts with EMPTY, say there is "
    "nothing to show. Speak in short plain sentences with no markdown, bullets, or "
    "symbols, and read dates in a natural spoken form."
)


def load_mcp_tools():
    """Connect to the Canvas MCP server over stdio and return its tools.

    Returns an empty list (and the agent says so) if the server cannot start,
    so the voice loop still works without Canvas.
    """
    client = MultiServerMCPClient(
        {
            "canvas": {
                "transport": "stdio",
                "command": sys.executable,
                "args": [MCP_SERVER],
            }
        }
    )
    try:
        tools = asyncio.run(client.get_tools())
    except Exception as exc:  # unavailable MCP must not crash the agent
        print(f"[warning] Canvas MCP unavailable: {type(exc).__name__}: {exc}")
        return []
    print(f"[mcp] Connected. Tools: {', '.join(t.name for t in tools)}")
    return tools


def play_audio(file_path: str):
    pygame.mixer.init()
    pygame.mixer.music.load(file_path)
    pygame.mixer.music.play()
    while pygame.mixer.music.get_busy():
        pygame.time.Clock().tick(10)
    pygame.mixer.music.unload()
    pygame.mixer.quit()


async def generate_speech(text: str, voice: str, rate: str, output_file: str = SPEECH_FILE):
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(output_file)


def speak(text: str, persona: dict) -> None:
    print(f"\n[{persona['name']}]: {text}\n")
    if SILENT:
        return
    clean_text = re.sub(r"[\*_#`]", "", text)
    try:
        asyncio.run(generate_speech(clean_text, persona["voice"], persona["rate"]))
        play_audio(SPEECH_FILE)
    except Exception as exc:  # no network / no audio device: keep going in text
        print(f"[audio unavailable: {type(exc).__name__}]")
    finally:
        if os.path.exists(SPEECH_FILE):
            try:
                os.remove(SPEECH_FILE)
            except PermissionError:
                pass


def configure_agent(persona: dict, tools: list):
    # Personality and rules go in the visible user-level request (see main).
    return create_agent(model=MODEL, tools=tools)


def listen() -> str:
    if TEXT_INPUT:
        try:
            return input("\n[You, typed]: ").strip()
        except EOFError:
            return "exit"
    recognizer = sr.Recognizer()
    recognizer.dynamic_energy_threshold = True
    try:
        with sr.Microphone() as source:
            print("\n[Listening...]")
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            try:
                audio = recognizer.listen(source, timeout=5, phrase_time_limit=12)
            except sr.WaitTimeoutError:
                return ""
    except (OSError, AttributeError) as exc:
        print(f"[No microphone available ({exc}). Restart with --text to type instead.]")
        raise SystemExit(1)
    try:
        text = recognizer.recognize_google(audio)
        print(f"[You]: {text}")
        return text.strip()
    except sr.UnknownValueError:
        return ""
    except sr.RequestError:
        print("[Speech recognition service unreachable.]")
        return ""


def select_persona() -> str:
    print("\n---------------- SELECT PERSONALITY ----------------")
    for key, persona in PERSONAS.items():
        print(f"[{key}] {persona['name']} - {persona['title']}")
    print("-----------------------------------------------------")
    while True:
        choice = input(f"Choose a personality (1-{len(PERSONAS)}): ").strip()
        if choice in PERSONAS:
            return choice
        print("Please choose one of the listed options.")


def friendly_error(exc: Exception) -> str:
    text = str(exc).lower()
    if "api key" in text or "api_key" in text or "permission" in text or "401" in text:
        return "I could not reach my language model. Please check the Gemini key in the dot env file."
    if "429" in text or "quota" in text or "resource_exhausted" in text:
        return "I have hit my usage limit for now. Please try again in a minute."
    return "Sorry, something went wrong while I was working on that. Please try again."


def extract_text(message) -> str:
    text = getattr(message, "text", None)
    if callable(text):  # older langchain versions expose text() as a method
        text = text()
    return (text or str(message.content)).strip()


def main():
    global TEXT_INPUT, SILENT
    SILENT = "--quiet" in sys.argv
    TEXT_INPUT = SILENT or "--text" in sys.argv

    if not os.getenv("GOOGLE_API_KEY"):
        print("Missing GEMINI_API_KEY. Add it to .env (see .env.example) and rerun.")
        raise SystemExit(1)

    active_key = select_persona()
    persona = PERSONAS[active_key]
    tools = load_mcp_tools()
    agent = configure_agent(persona, tools)
    speak(persona["greeting"], persona)
    if not tools:
        speak(
            "Heads up: I could not connect to Canvas, so I can chat but cannot look up your courses.",
            persona,
        )

    history: list[dict] = []
    while True:
        try:
            prompt = listen()
            if not prompt:
                continue
            clean_prompt = prompt.lower().strip().rstrip(".!")
            if clean_prompt in ["exit", "quit", "stop", "goodbye"]:
                speak("Goodbye! Keep up the good work.", persona)
                break
            if "switch voice" in clean_prompt or "change personality" in clean_prompt:
                active_key = select_persona()
                persona = PERSONAS[active_key]
                agent = configure_agent(persona, tools)
                speak(persona["greeting"], persona)
                continue

            user_request = (
                f"Respond as {persona['name']}. Your personality is {persona['personality']}. "
                f"{SAFETY_RULES} "
                f"The user's request is: {prompt}"
            )
            # Keep a short memory so follow-ups like "and that course?" work.
            messages = history[-8:] + [{"role": "user", "content": user_request}]
            result = asyncio.run(agent.ainvoke({"messages": messages}))
            output_text = extract_text(result["messages"][-1])
            if not output_text:
                output_text = "I did not come up with an answer to that. Could you rephrase it?"
            history += [
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": output_text},
            ]
            speak(output_text, persona)
        except (EOFError, KeyboardInterrupt):
            print("\nExiting...")
            break
        except Exception as exc:
            print(f"[error] {type(exc).__name__}: {exc}")
            speak(friendly_error(exc), persona)


if __name__ == "__main__":
    main()
