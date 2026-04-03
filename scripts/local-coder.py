#!/usr/bin/env python3
"""Local coder — delegates coding tasks to a local llama.cpp endpoint.

Usage:
    python3 scripts/local-coder.py "write a fibonacci function" --context-file src/utils.py
    python3 scripts/local-coder.py --check
    python3 scripts/local-coder.py "refactor this" --context "def old(): pass"
"""

import argparse
import json
import re
import socket
import sys
import urllib.error
import urllib.request
from typing import Any

ENDPOINT = "http://192.168.1.125:1234/v1/chat/completions"
DEFAULT_TIMEOUT = 300
DEFAULT_MAX_TOKENS = 4096
DEFAULT_MAX_CONTEXT_CHARS = 200_000
PER_FILE_WARN_CHARS = 100_000
MAX_RESPONSE_BYTES = 10 * 1024 * 1024  # 10MB

SYSTEM_PROMPT = """\
You are a precise coding assistant. You receive a task and optional context code. \
You produce clean, correct, production-ready code.

RULES:
1. Output ONLY fenced code blocks. No prose before, between, or after them.
2. Each code block MUST start with a filepath comment on line 1: # filepath: path/to/file.ext
3. Specify the language on the opening fence: ```python, ```typescript, etc.
4. If multiple files are needed, output multiple fenced blocks.
5. Use explicit type annotations on all function signatures.
6. Keep functions under 50 lines. Keep files under 500 lines.
7. Handle edge cases: empty inputs, None/null, type mismatches.
8. Never hardcode secrets, credentials, or API keys.
9. Follow the style of any context code provided.
10. If you must explain something, use code comments — never prose outside fences.

EXAMPLE INPUT:
Write a function that checks if a number is prime.

EXAMPLE OUTPUT:
```python
# filepath: src/math_utils.py
def is_prime(n: int) -> bool:
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True
```

EXAMPLE INPUT:
Add a test for the User model and a serialization helper.

EXAMPLE OUTPUT:
```python
# filepath: tests/test_user.py
from src.models import User

def test_user_creation() -> None:
    user = User(name="Alice", age=30)
    assert user.name == "Alice"
    assert user.age == 30
```

```python
# filepath: src/serializers.py
from src.models import User

def serialize_user(user: User) -> dict[str, str | int]:
    return {"name": user.name, "age": user.age}
```
"""

# ---------------------------------------------------------------------------
# Code block parser
# ---------------------------------------------------------------------------

_FENCE_RE = re.compile(
    r"```([\w+#.\-]+)?\s*\n(.*?)^```",
    re.DOTALL | re.MULTILINE,
)
_FILEPATH_RE = re.compile(
    r"^#\s*filepath:\s*(.+)$",
    re.MULTILINE,
)


def parse_code_blocks(content: str) -> list[dict[str, Any]]:
    """Extract fenced code blocks from LLM response.

    Returns a list of dicts with keys: language, filepath, code.
    """
    blocks: list[dict[str, Any]] = []
    for match in _FENCE_RE.finditer(content):
        language = match.group(1) or None
        raw_code = match.group(2).rstrip("\n")

        filepath = None
        fp_match = _FILEPATH_RE.search(raw_code)
        if fp_match:
            filepath = fp_match.group(1).strip()
            # Remove the filepath comment line from the code body
            raw_code = raw_code[: fp_match.start()] + raw_code[fp_match.end() :]
            raw_code = raw_code.strip("\n")

        blocks.append({
            "language": language,
            "filepath": filepath,
            "code": raw_code,
        })
    return blocks


# ---------------------------------------------------------------------------
# Context file loading
# ---------------------------------------------------------------------------


def load_context_files(
    paths: list[str],
    max_context_chars: int = DEFAULT_MAX_CONTEXT_CHARS,
) -> str:
    """Load files and concatenate as labeled context.

    Warns on stderr if a single file exceeds PER_FILE_WARN_CHARS or if
    total context exceeds max_context_chars (truncates in that case).
    """
    parts: list[str] = []
    total_chars = 0

    for path in paths:
        with open(path) as fh:
            content = fh.read()

        if len(content) > PER_FILE_WARN_CHARS:
            print(
                f"WARNING: {path} is {len(content):,} chars "
                f"(>{PER_FILE_WARN_CHARS:,} threshold)",
                file=sys.stderr,
            )

        header = f"--- {path} ---\n"
        part = header + content
        total_chars += len(part)
        parts.append(part)

    result = "\n\n".join(parts)

    if len(result) > max_context_chars:
        print(
            f"WARNING: Total context ({len(result):,} chars) exceeds "
            f"max_context_chars ({max_context_chars:,}). Truncating.",
            file=sys.stderr,
        )
        result = result[:max_context_chars]

    return result


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------


def build_payload(
    task: str,
    context: str = "",
    temperature: float = 0.0,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> dict[str, Any]:
    """Build the OpenAI-compatible chat completion request payload."""
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
    ]

    if context:
        user_content = f"CONTEXT:\n{context}\n\nTASK:\n{task}"
    else:
        user_content = task

    messages.append({"role": "user", "content": user_content})

    return {
        "model": "local",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------


def call_local_llm(
    task: str,
    context: str = "",
    temperature: float = 0.0,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout: int = DEFAULT_TIMEOUT,
    endpoint: str = ENDPOINT,
) -> str:
    """Send a task to the local llama.cpp endpoint and return the response text.

    Raises:
        ConnectionError: If the endpoint is not reachable.
        TimeoutError: If the request timed out.
        ValueError: If the response is malformed or has unexpected structure.
    """
    payload = build_payload(task, context, temperature, max_tokens)
    data = json.dumps(payload).encode()

    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(MAX_RESPONSE_BYTES)
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, socket.timeout):
            raise TimeoutError(
                f"Request timed out after {timeout}s. "
                "The model may need more time or the server is overloaded."
            ) from exc
        raise ConnectionError(
            f"Local LLM endpoint not reachable at {endpoint}: {reason}"
        ) from exc

    try:
        result = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(
            f"Response from {endpoint} is malformed (not valid JSON): "
            f"{raw[:200]!r}"
        ) from exc

    if "choices" not in result or not result["choices"]:
        raise ValueError(
            f"Response has unexpected structure (missing 'choices'): "
            f"{json.dumps(result)[:300]}"
        )

    try:
        return result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(
            f"Response has unexpected structure (missing message/content): "
            f"{json.dumps(result)[:300]}"
        ) from exc


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


def check_endpoint(endpoint: str = ENDPOINT) -> bool:
    """Quick health probe — send a tiny request to verify the endpoint is up."""
    payload = {
        "model": "local",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "stream": False,
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delegate coding tasks to a local llama.cpp LLM endpoint.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            '  %(prog)s "write a fibonacci function"\n'
            '  %(prog)s "refactor this" -c src/utils.py\n'
            "  %(prog)s --check\n"
        ),
    )
    parser.add_argument(
        "task",
        nargs="?",
        help="The coding task to perform",
    )
    parser.add_argument(
        "--context-file", "-c",
        action="append",
        default=[],
        metavar="FILE",
        help="File(s) to include as context (repeatable)",
    )
    parser.add_argument(
        "--context",
        default="",
        help="Inline context string",
    )
    parser.add_argument(
        "--temperature", "-t",
        type=float,
        default=0.0,
        help="Sampling temperature (default: 0.0)",
    )
    parser.add_argument(
        "--max-tokens", "-m",
        type=int,
        default=DEFAULT_MAX_TOKENS,
        help=f"Max generation tokens (default: {DEFAULT_MAX_TOKENS})",
    )
    parser.add_argument(
        "--max-context-chars",
        type=int,
        default=DEFAULT_MAX_CONTEXT_CHARS,
        help=f"Max total context characters (default: {DEFAULT_MAX_CONTEXT_CHARS:,})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    parser.add_argument(
        "--endpoint",
        default=ENDPOINT,
        help=f"LLM endpoint URL (default: {ENDPOINT})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if the endpoint is reachable and exit",
    )
    parser.add_argument(
        "--parse",
        action="store_true",
        help="Parse response into structured code blocks (JSON output)",
    )

    args = parser.parse_args()

    # Health check mode
    if args.check:
        ok = check_endpoint(args.endpoint)
        if ok:
            print("OK: endpoint is reachable")
            sys.exit(0)
        else:
            print("FAIL: endpoint is not reachable", file=sys.stderr)
            sys.exit(1)

    # Task is required when not in --check mode
    if not args.task:
        parser.error("task is required (unless using --check)")

    # Build context
    context_parts: list[str] = []
    if args.context_file:
        file_context = load_context_files(
            args.context_file,
            max_context_chars=args.max_context_chars,
        )
        context_parts.append(file_context)
    if args.context:
        context_parts.append(args.context)
    context = "\n\n".join(context_parts)

    # Call the LLM
    try:
        response = call_local_llm(
            task=args.task,
            context=context,
            temperature=args.temperature,
            max_tokens=args.max_tokens,
            timeout=args.timeout,
            endpoint=args.endpoint,
        )
    except (ConnectionError, TimeoutError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    # Output
    if args.parse:
        blocks = parse_code_blocks(response)
        print(json.dumps(blocks, indent=2))
    else:
        print(response)


if __name__ == "__main__":
    main()
