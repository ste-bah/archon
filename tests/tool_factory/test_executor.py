"""Tests for tool-factory subprocess sandbox executor."""

import asyncio
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from tool_factory.executor import SandboxExecutor, ENV_ALLOWLIST

# ENV_ALLOWLIST is now {"PATH", "HOME", "LANG"} — PYTHONPATH excluded for security


@pytest.fixture
def executor():
    return SandboxExecutor()


class TestSandboxExecutor:
    def test_simple_function(self, executor, sample_tool_code):
        result = asyncio.run(executor.execute(sample_tool_code, {"a": 3, "b": 4}))
        assert result.success is True
        import json
        output = json.loads(result.output)
        assert output["sum"] == 7

    def test_parameters_passed_correctly(self, executor):
        code = "def run(params):\n    return {'name': params['name'], 'count': params['count']}"
        result = asyncio.run(executor.execute(code, {"name": "test", "count": 42}))
        assert result.success is True
        import json
        output = json.loads(result.output)
        assert output["name"] == "test"
        assert output["count"] == 42

    def test_timeout_kills_process(self, executor, timeout_code):
        result = asyncio.run(executor.execute(timeout_code, {}, timeout_seconds=2))
        assert result.success is False
        assert result.exit_code != 0 or "timeout" in result.output.lower() or "timed out" in result.output.lower()

    def test_env_only_allowlisted(self, executor, env_leak_code):
        # Set a secret env var to verify it's stripped
        os.environ["ANTHROPIC_API_KEY"] = "sk-test-secret-key"
        os.environ["AWS_SECRET_ACCESS_KEY"] = "aws-secret-key"
        try:
            result = asyncio.run(executor.execute(env_leak_code, {}))
            assert result.success is True
            import json
            env = json.loads(result.output)
            assert "ANTHROPIC_API_KEY" not in env
            assert "AWS_SECRET_ACCESS_KEY" not in env
            # Only allowlisted vars (+ macOS kernel-injected vars) should be present
            MACOS_SYSTEM_VARS = {"__CF_USER_TEXT_ENCODING", "__CFBundleIdentifier"}
            for key in env:
                assert key in ENV_ALLOWLIST or key in MACOS_SYSTEM_VARS, f"Unexpected env var: {key}"
        finally:
            os.environ.pop("ANTHROPIC_API_KEY", None)
            os.environ.pop("AWS_SECRET_ACCESS_KEY", None)

    def test_cwd_is_temp_not_project(self, executor):
        code = "import os\ndef run(params):\n    return {'cwd': os.getcwd()}"
        result = asyncio.run(executor.execute(code, {}))
        assert result.success is True
        import json
        output = json.loads(result.output)
        cwd = output["cwd"]
        # Should NOT be the project directory
        assert "claudeflow-testing" not in cwd or "/tmp" in cwd or "/var" in cwd

    def test_exception_returns_error(self, executor):
        code = "def run(params):\n    raise ValueError('intentional error')"
        result = asyncio.run(executor.execute(code, {}))
        assert result.success is False
        import json
        output = json.loads(result.output)
        assert output["type"] == "ValueError"
        assert "intentional" in output["error"]

    def test_stderr_captured(self, executor):
        code = "import sys\ndef run(params):\n    print('debug info', file=sys.stderr)\n    return {'ok': True}"
        result = asyncio.run(executor.execute(code, {}))
        assert result.success is True
        assert "debug info" in result.stderr

    def test_duration_recorded(self, executor, sample_tool_code):
        result = asyncio.run(executor.execute(sample_tool_code, {"a": 1, "b": 2}))
        assert result.duration_ms > 0
        assert result.duration_ms < 10000  # should be fast

    def test_empty_params(self, executor):
        code = "def run(params):\n    return {'empty': True}"
        result = asyncio.run(executor.execute(code, {}))
        assert result.success is True
