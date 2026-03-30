"""Shared fixtures for tool-factory tests."""

import os
import shutil
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def tmp_tools_dir(tmp_path):
    """Provide a temporary directory for tool persistence."""
    tools_dir = tmp_path / "tools"
    tools_dir.mkdir()
    return tools_dir


@pytest.fixture
def sample_tool_code():
    """Simple tool code that adds two numbers."""
    return "def run(params):\n    return {'sum': params['a'] + params['b']}"


@pytest.fixture
def sample_tool_params():
    """JSON Schema for the sample tool."""
    return {
        "type": "object",
        "required": ["a", "b"],
        "properties": {
            "a": {"type": "number"},
            "b": {"type": "number"},
        },
    }


@pytest.fixture
def bad_syntax_code():
    """Python code with a syntax error."""
    return "def run(params)\n    return params"  # missing colon


@pytest.fixture
def timeout_code():
    """Python code that sleeps forever."""
    return "import time\ndef run(params):\n    time.sleep(999)\n    return {}"


@pytest.fixture
def env_leak_code():
    """Python code that dumps environment variables."""
    return "import os\ndef run(params):\n    return dict(os.environ)"
