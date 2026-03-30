"""Voice MCP Server entry point — FastMCP wiring for voice tools.

Run with: python3 -m src.voice_mcp

This module registers the plain async functions from server.py as MCP tools
via FastMCP decorators, then serves them over stdio for Claude Code.
"""
import json
import logging

from mcp.server.fastmcp import FastMCP

from .server import (
    voice_listen as _voice_listen,
    voice_speak as _voice_speak,
    voice_status as _voice_status,
    voice_stop as _voice_stop,
)

mcp = FastMCP("voice-mcp")


@mcp.tool()
async def voice_listen(
    timeout_seconds: float = 30.0,
    language: str = "en",
    model: str | None = None,
) -> str:
    """Listen for voice input and return transcribed text.

    Captures microphone audio until silence is detected, then transcribes
    using Whisper. Audio never crosses the MCP boundary — only text is returned.

    Args:
        timeout_seconds: Max recording time in seconds (0.1–120). Default 30.
        language: BCP-47 language code (e.g. "en", "fr"). Default "en".
        model: Whisper model override (tiny.en/base.en/small.en/medium.en).
               Default: platform-selected (tiny.en on CPU, base.en on Apple Silicon).
    """
    result = await _voice_listen(timeout_seconds=timeout_seconds, language=language, model=model)
    return json.dumps(result)


@mcp.tool()
async def voice_speak(
    text: str,
    voice: str = "default",
    speed: float = 1.0,
    wait: bool = False,
) -> str:
    """Convert text to speech and play audio.

    Non-blocking by default — queues audio and returns immediately.
    Use wait=True to block until playback completes.
    Audio never crosses the MCP boundary.

    Args:
        text: Text to speak aloud.
        voice: Voice name (platform-specific). Default "default".
        speed: Playback speed multiplier (0.5–2.0). Default 1.0.
        wait: If True, block until playback finishes. Default False.
    """
    result = await _voice_speak(text=text, voice=voice, speed=speed, wait=wait)
    return json.dumps(result)


@mcp.tool()
async def voice_stop() -> str:
    """Stop current audio playback and clear the TTS queue."""
    result = await _voice_stop()
    return json.dumps(result)


@mcp.tool()
async def voice_status() -> str:
    """Get current voice I/O status.

    Returns platform, Whisper model state, available input/output devices,
    TTS backend, and current playback state.
    """
    result = await _voice_status()
    return json.dumps(result)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    mcp.run(transport="stdio")
