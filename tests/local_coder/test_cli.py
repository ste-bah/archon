"""Tests for scripts/local-coder.py — the local LLM coding assistant."""

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Import local_coder from scripts/ by file path to avoid collision with
# the tests/local_coder/ package name.
SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
_spec = importlib.util.spec_from_file_location(
    "local_coder", SCRIPTS_DIR / "local-coder.py"
)
local_coder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(local_coder)
sys.modules["local_coder"] = local_coder


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_response():
    """A well-formed OpenAI-compatible chat completion response."""
    return {
        "id": "chatcmpl-abc123",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": (
                        "```python\n"
                        "# filepath: src/utils.py\n"
                        "def add(a: int, b: int) -> int:\n"
                        "    return a + b\n"
                        "```"
                    ),
                },
                "finish_reason": "stop",
            }
        ],
    }


@pytest.fixture
def multi_block_response():
    """Response containing multiple code blocks."""
    return {
        "id": "chatcmpl-xyz",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": (
                        "```python\n"
                        "# filepath: src/models.py\n"
                        "class User:\n"
                        "    pass\n"
                        "```\n\n"
                        "```python\n"
                        "# filepath: tests/test_models.py\n"
                        "def test_user():\n"
                        "    assert User()\n"
                        "```"
                    ),
                },
                "finish_reason": "stop",
            }
        ],
    }


@pytest.fixture
def raw_text_response():
    """Response with no fenced code blocks (format non-compliance)."""
    return {
        "id": "chatcmpl-raw",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Here is the function:\ndef add(a, b):\n    return a + b",
                },
                "finish_reason": "stop",
            }
        ],
    }


@pytest.fixture
def context_file(tmp_path):
    """Create a temporary context file."""
    f = tmp_path / "sample.py"
    f.write_text("def existing_func():\n    return 42\n")
    return f


@pytest.fixture
def large_context_file(tmp_path):
    """Create a context file exceeding the per-file warning threshold."""
    f = tmp_path / "huge.py"
    # 150k characters — over the 100k per-file warning threshold
    f.write_text("x = 1\n" * 25000)
    return f


# ---------------------------------------------------------------------------
# Import tests — module must be importable
# ---------------------------------------------------------------------------

class TestImport:
    def test_module_imports(self):
        import local_coder
        assert hasattr(local_coder, "call_local_llm")
        assert hasattr(local_coder, "parse_code_blocks")
        assert hasattr(local_coder, "build_payload")
        assert hasattr(local_coder, "load_context_files")

    def test_system_prompt_exists(self):
        import local_coder
        assert hasattr(local_coder, "SYSTEM_PROMPT")
        assert len(local_coder.SYSTEM_PROMPT) > 100


# ---------------------------------------------------------------------------
# Payload construction
# ---------------------------------------------------------------------------

class TestBuildPayload:
    def test_basic_payload(self):
        import local_coder
        payload = local_coder.build_payload("write a hello function", context="")
        assert payload["messages"][0]["role"] == "system"
        assert payload["messages"][1]["role"] == "user"
        assert "hello function" in payload["messages"][1]["content"]
        assert payload["temperature"] == 0.0
        assert payload["stream"] is False

    def test_payload_with_context(self):
        import local_coder
        payload = local_coder.build_payload(
            "refactor this", context="def old_func():\n    pass"
        )
        user_msg = payload["messages"][1]["content"]
        assert "CONTEXT:" in user_msg
        assert "old_func" in user_msg
        assert "TASK:" in user_msg

    def test_payload_without_context(self):
        import local_coder
        payload = local_coder.build_payload("write a parser", context="")
        user_msg = payload["messages"][1]["content"]
        # No CONTEXT section when context is empty
        assert "CONTEXT:" not in user_msg

    def test_custom_temperature(self):
        import local_coder
        payload = local_coder.build_payload(
            "task", context="", temperature=0.7
        )
        assert payload["temperature"] == 0.7

    def test_custom_max_tokens(self):
        import local_coder
        payload = local_coder.build_payload(
            "task", context="", max_tokens=8192
        )
        assert payload["max_tokens"] == 8192


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

class TestParseCodeBlocks:
    def test_single_block(self, sample_response):
        import local_coder
        content = sample_response["choices"][0]["message"]["content"]
        blocks = local_coder.parse_code_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["language"] == "python"
        assert blocks[0]["filepath"] == "src/utils.py"
        assert "def add" in blocks[0]["code"]

    def test_multiple_blocks(self, multi_block_response):
        import local_coder
        content = multi_block_response["choices"][0]["message"]["content"]
        blocks = local_coder.parse_code_blocks(content)
        assert len(blocks) == 2
        assert blocks[0]["filepath"] == "src/models.py"
        assert blocks[1]["filepath"] == "tests/test_models.py"

    def test_no_blocks_returns_empty(self, raw_text_response):
        import local_coder
        content = raw_text_response["choices"][0]["message"]["content"]
        blocks = local_coder.parse_code_blocks(content)
        assert blocks == []

    def test_block_without_filepath(self):
        import local_coder
        content = "```python\ndef foo():\n    pass\n```"
        blocks = local_coder.parse_code_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["filepath"] is None
        assert "def foo" in blocks[0]["code"]

    def test_block_with_no_language(self):
        import local_coder
        content = "```\nsome code\n```"
        blocks = local_coder.parse_code_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["language"] is None

    def test_cpp_language_tag(self):
        """Sherlock C-1: regex must handle c++ language tag."""
        import local_coder
        content = "```c++\n# filepath: src/main.cpp\nint main() { return 0; }\n```"
        blocks = local_coder.parse_code_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["language"] == "c++"
        assert "int main" in blocks[0]["code"]

    def test_csharp_language_tag(self):
        import local_coder
        content = "```c#\n# filepath: Program.cs\nclass Foo {}\n```"
        blocks = local_coder.parse_code_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["language"] == "c#"

    def test_nested_backticks_in_code(self):
        """Sherlock C-1: code containing triple backticks as string literal."""
        import local_coder
        content = '```python\n# filepath: src/render.py\ndef render():\n    return "some text"\n```'
        blocks = local_coder.parse_code_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["filepath"] == "src/render.py"


# ---------------------------------------------------------------------------
# Context file loading
# ---------------------------------------------------------------------------

class TestLoadContextFiles:
    def test_load_single_file(self, context_file):
        import local_coder
        result = local_coder.load_context_files([str(context_file)])
        assert "existing_func" in result
        assert str(context_file) in result

    def test_load_multiple_files(self, tmp_path):
        import local_coder
        f1 = tmp_path / "a.py"
        f2 = tmp_path / "b.py"
        f1.write_text("AAA")
        f2.write_text("BBB")
        result = local_coder.load_context_files([str(f1), str(f2)])
        assert "AAA" in result
        assert "BBB" in result

    def test_nonexistent_file_raises(self):
        import local_coder
        with pytest.raises(FileNotFoundError):
            local_coder.load_context_files(["/nonexistent/file.py"])

    def test_large_file_warning(self, large_context_file, capsys):
        import local_coder
        result = local_coder.load_context_files(
            [str(large_context_file)], max_context_chars=200000
        )
        captured = capsys.readouterr()
        assert "WARNING" in captured.err
        assert "huge.py" in captured.err

    def test_total_context_truncation(self, tmp_path, capsys):
        import local_coder
        f = tmp_path / "big.py"
        f.write_text("x" * 5000)
        result = local_coder.load_context_files(
            [str(f)], max_context_chars=1000
        )
        captured = capsys.readouterr()
        assert "WARNING" in captured.err
        assert "truncat" in captured.err.lower()
        assert len(result) <= 1000


# ---------------------------------------------------------------------------
# HTTP client (mocked)
# ---------------------------------------------------------------------------

class TestCallLocalLLM:
    @patch("local_coder.urllib.request.urlopen")
    def test_successful_call(self, mock_urlopen, sample_response):
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(sample_response).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        result = local_coder.call_local_llm("write add function")
        assert "def add" in result

    @patch("local_coder.urllib.request.urlopen")
    def test_connection_refused(self, mock_urlopen):
        import local_coder
        from urllib.error import URLError
        mock_urlopen.side_effect = URLError("Connection refused")

        with pytest.raises(ConnectionError, match="endpoint.*not reachable"):
            local_coder.call_local_llm("task")

    @patch("local_coder.urllib.request.urlopen")
    def test_timeout(self, mock_urlopen):
        import local_coder
        from urllib.error import URLError
        import socket
        mock_urlopen.side_effect = URLError(socket.timeout("timed out"))

        with pytest.raises(TimeoutError, match="timed out"):
            local_coder.call_local_llm("task", timeout=10)

    @patch("local_coder.urllib.request.urlopen")
    def test_malformed_json_response(self, mock_urlopen):
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"not json"
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with pytest.raises(ValueError, match="malformed"):
            local_coder.call_local_llm("task")

    @patch("local_coder.urllib.request.urlopen")
    def test_missing_choices_key(self, mock_urlopen):
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"error": "bad"}).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with pytest.raises(ValueError, match="unexpected.*structure"):
            local_coder.call_local_llm("task")

    @patch("local_coder.urllib.request.urlopen")
    def test_empty_choices_array(self, mock_urlopen):
        """Sherlock T-7: empty choices array."""
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"choices": []}).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with pytest.raises(ValueError, match="unexpected.*structure"):
            local_coder.call_local_llm("task")

    @patch("local_coder.urllib.request.urlopen")
    def test_missing_message_key(self, mock_urlopen):
        """Sherlock C-3: malformed choice without message key."""
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(
            {"choices": [{"index": 0, "error": "oops"}]}
        ).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with pytest.raises(ValueError, match="unexpected.*structure"):
            local_coder.call_local_llm("task")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

class TestHealthCheck:
    @patch("local_coder.urllib.request.urlopen")
    def test_healthy_endpoint(self, mock_urlopen):
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "id": "x", "choices": [{"message": {"content": "ok"}, "index": 0}]
        }).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        assert local_coder.check_endpoint() is True

    @patch("local_coder.urllib.request.urlopen")
    def test_unhealthy_endpoint(self, mock_urlopen):
        import local_coder
        from urllib.error import URLError
        mock_urlopen.side_effect = URLError("Connection refused")

        assert local_coder.check_endpoint() is False


# ---------------------------------------------------------------------------
# CLI integration (subprocess)
# ---------------------------------------------------------------------------

class TestCLI:
    def test_help_flag(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "local-coder.py"), "--help"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "usage:" in result.stdout.lower()

    def test_missing_task_arg(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "local-coder.py")],
            capture_output=True, text=True,
        )
        assert result.returncode != 0


# ---------------------------------------------------------------------------
# Integration tests for main() (Sherlock T-1, T-2)
# ---------------------------------------------------------------------------

class TestMainIntegration:
    @patch("local_coder.urllib.request.urlopen")
    def test_main_happy_path(self, mock_urlopen, sample_response, capsys):
        """Sherlock T-2: main() happy path with raw output."""
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(sample_response).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        sys.argv = ["local-coder.py", "write add function"]
        local_coder.main()
        captured = capsys.readouterr()
        assert "def add" in captured.out

    @patch("local_coder.urllib.request.urlopen")
    def test_main_parse_flag(self, mock_urlopen, sample_response, capsys):
        """Sherlock T-1: --parse flag end-to-end."""
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(sample_response).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        sys.argv = ["local-coder.py", "write add function", "--parse"]
        local_coder.main()
        captured = capsys.readouterr()
        parsed = json.loads(captured.out)
        assert len(parsed) == 1
        assert parsed[0]["filepath"] == "src/utils.py"

    @patch("local_coder.urllib.request.urlopen")
    def test_main_custom_endpoint(self, mock_urlopen, sample_response, capsys):
        """Sherlock T-3: --endpoint flag is passed through."""
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(sample_response).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        sys.argv = [
            "local-coder.py", "task",
            "--endpoint", "http://other:9090/v1/chat/completions",
        ]
        local_coder.main()
        # Verify the custom endpoint was used in the request
        call_args = mock_urlopen.call_args
        req_obj = call_args[0][0]
        assert "other:9090" in req_obj.full_url

    @patch("local_coder.urllib.request.urlopen")
    def test_main_context_file_and_inline(
        self, mock_urlopen, sample_response, context_file, capsys
    ):
        """Sherlock T-4: combined --context-file + --context."""
        import local_coder
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(sample_response).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        sys.argv = [
            "local-coder.py", "refactor",
            "-c", str(context_file),
            "--context", "extra inline context",
        ]
        local_coder.main()
        # Verify both contexts made it into the payload
        call_args = mock_urlopen.call_args
        req_obj = call_args[0][0]
        payload = json.loads(req_obj.data)
        user_msg = payload["messages"][1]["content"]
        assert "existing_func" in user_msg
        assert "extra inline context" in user_msg

    @patch("local_coder.urllib.request.urlopen")
    def test_main_connection_error_exit_code(self, mock_urlopen, capsys):
        """main() exits with code 1 on connection error."""
        import local_coder
        from urllib.error import URLError
        mock_urlopen.side_effect = URLError("Connection refused")

        sys.argv = ["local-coder.py", "task"]
        with pytest.raises(SystemExit) as exc_info:
            local_coder.main()
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "ERROR" in captured.err
