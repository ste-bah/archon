"""Disk persistence for dynamic tool definitions."""

import hashlib
import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

TOOLS_DIR = Path(".tool-factory/tools")

logger = logging.getLogger("tool-factory")


@dataclass
class ToolDefinition:
    name: str
    description: str
    code: str
    language: str
    parameters: dict | None
    ttl_minutes: int
    timeout_seconds: int
    created_at: str  # ISO 8601
    last_used: str | None = None
    invocation_count: int = 0
    code_hash: str = ""
    expires_at: str | None = None

    def __post_init__(self):
        if not self.code_hash:
            self.code_hash = hashlib.sha256(self.code.encode()).hexdigest()[:16]
        if self.ttl_minutes > 0 and not self.expires_at:
            created = datetime.fromisoformat(self.created_at)
            self.expires_at = (created + timedelta(minutes=self.ttl_minutes)).isoformat()

    def is_expired(self) -> bool:
        if not self.expires_at:
            return False
        return datetime.now(timezone.utc) >= datetime.fromisoformat(self.expires_at)


class ToolStore:
    """Manages tool definitions on disk."""

    def __init__(self, base_dir: Path = TOOLS_DIR):
        self._dir = base_dir
        self._tools: dict[str, ToolDefinition] = {}

    def init(self) -> int:
        """Create directory and load all persisted tools. Returns count loaded."""
        self._dir.mkdir(parents=True, exist_ok=True)
        loaded = 0
        for path in self._dir.glob("*.json"):
            try:
                data = json.loads(path.read_text())
                tool = ToolDefinition(**data)
                self._tools[tool.name] = tool
                loaded += 1
            except Exception as e:
                logger.error(f"Failed to load tool from {path}: {e}")
        return loaded

    def save(self, tool: ToolDefinition) -> None:
        """Persist a tool definition to disk (atomic write via temp + rename)."""
        self._tools[tool.name] = tool
        path = self._dir / f"{tool.name}.json"
        tmp_path = path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(asdict(tool), indent=2))
        tmp_path.rename(path)

    def delete(self, name: str) -> None:
        """Delete a tool definition from disk and memory."""
        path = self._dir / f"{name}.json"
        if path.exists():
            path.unlink()
        self._tools.pop(name, None)

    def get(self, name: str) -> ToolDefinition | None:
        return self._tools.get(name)

    def list_all(self, include_expired: bool = False) -> list[ToolDefinition]:
        if include_expired:
            return list(self._tools.values())
        return [t for t in self._tools.values() if not t.is_expired()]

    def count_active(self) -> int:
        return sum(1 for t in self._tools.values() if not t.is_expired())

    def has(self, name: str) -> bool:
        return name in self._tools
