"""Subprocess sandbox for executing dynamic tool code."""

import asyncio
import json
import os
import signal
import tempfile
import time
from dataclasses import dataclass

# Environment variable allowlist (REQ-TOOL-004)
ENV_ALLOWLIST = frozenset({"PATH", "HOME", "LANG"})
# Note: PYTHONPATH excluded to prevent importing project-internal modules

# Memory limit: 256MB
MEMORY_LIMIT_BYTES = 256 * 1024 * 1024


@dataclass
class ExecutionResult:
    success: bool
    output: str  # JSON string on success, error message on failure
    exit_code: int
    duration_ms: float
    stderr: str


class SandboxExecutor:
    """Execute dynamic tool code in a sandboxed subprocess."""

    async def execute(
        self,
        code: str,
        parameters: dict,
        timeout_seconds: int = 30,
    ) -> ExecutionResult:
        """Execute tool code with parameters in a sandboxed subprocess."""
        harness = self._build_harness(code)
        env = self._build_env()
        params_json = json.dumps(parameters)

        with tempfile.TemporaryDirectory(prefix="tool-factory-") as tmpdir:
            start = time.perf_counter()
            try:
                proc = await asyncio.create_subprocess_exec(
                    "python3", "-c", harness,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                    cwd=tmpdir,
                    start_new_session=True,  # Creates new process group for clean kill
                )
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(input=params_json.encode()),
                    timeout=timeout_seconds,
                )
                duration_ms = (time.perf_counter() - start) * 1000
                stdout_str = stdout.decode().strip()
                stderr_str = stderr.decode().strip()
                exit_code = proc.returncode if proc.returncode is not None else 0

                if exit_code != 0:
                    return ExecutionResult(
                        success=False,
                        output=stdout_str or json.dumps({"error": f"Process exited with code {exit_code}", "type": "ProcessError"}),
                        exit_code=exit_code,
                        duration_ms=duration_ms,
                        stderr=stderr_str,
                    )

                return ExecutionResult(
                    success=True,
                    output=stdout_str,
                    exit_code=0,
                    duration_ms=duration_ms,
                    stderr=stderr_str,
                )

            except asyncio.TimeoutError:
                duration_ms = (time.perf_counter() - start) * 1000
                # Kill entire process group (not just the direct child)
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    proc.kill()
                await proc.wait()
                return ExecutionResult(
                    success=False,
                    output=json.dumps({"error": f"Tool timed out after {timeout_seconds}s", "type": "TimeoutError"}),
                    exit_code=-1,
                    duration_ms=duration_ms,
                    stderr="",
                )

    def _build_harness(self, user_code: str) -> str:
        """Wrap user code in an execution harness.

        User code is placed INSIDE the try/except block to prevent
        unhandled exceptions from top-level statements.
        """
        # Indent user code to be inside the try block
        indented_code = "\n".join("    " + line for line in user_code.splitlines())
        return f"""
import json
import sys
import resource

# Set memory limit (best-effort)
try:
    resource.setrlimit(resource.RLIMIT_AS, ({MEMORY_LIMIT_BYTES}, {MEMORY_LIMIT_BYTES}))
except (ValueError, resource.error):
    pass  # macOS may not support RLIMIT_AS

# Read parameters from stdin
params = json.loads(sys.stdin.read())

# User code wrapped in exception handler
try:
{indented_code}
    result = run(params)
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({{"error": str(e), "type": type(e).__name__}}))
    sys.exit(1)
"""

    def _build_env(self) -> dict[str, str]:
        """Build sandboxed environment with only allowlisted variables."""
        return {k: v for k, v in os.environ.items() if k in ENV_ALLOWLIST}
