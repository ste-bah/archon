"""Benchmark task and result schemas."""

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


@dataclass
class BenchmarkTask:
    """A single reference task in the benchmark suite."""
    instance_id: str
    task_type: str
    problem_statement: str
    gold_answer: str = ""
    gold_patch: str = ""
    test_patch: str = ""
    scoring_method: str = "test_pass"
    max_tokens: int = 50000
    timeout_seconds: int = 300
    base_commit: str = ""
    repo_snapshot: str = ""
    human_review: bool = False
    metadata: dict = field(default_factory=dict)


@dataclass
class BenchmarkResult:
    """REQ-BENCH-004: A single benchmark run result stored in MemoryGraph."""
    suite_id: str
    task_id: str
    run_date: datetime
    model_version: str
    archon_version: str
    score: float
    tokens_used: int
    wall_clock_seconds: float
    corrections_needed: int
    details: dict = field(default_factory=dict)
    cost_usd: float = 0.0

    def to_memorygraph_params(self) -> dict:
        """Convert to MemoryGraph storage params (REQ-BENCH-004)."""
        return {
            "name": f"benchmark-{self.suite_id}-{self.task_id}-{self.run_date.strftime('%Y%m%d')}",
            "memory_type": "general",
            "content": json.dumps(self.to_dict()),
            "importance": 0.4,
            "tags": [
                "benchmark",
                f"suite:{self.suite_id}",
                f"model:{self.model_version}",
                f"archon:{self.archon_version}",
            ],
        }

    def to_dict(self) -> dict:
        d = asdict(self)
        d["run_date"] = self.run_date.isoformat()
        return d
