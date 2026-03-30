"""Real-time cost tracking from API response usage field.

Section 7B of PRD-ARCHON-CAP-002:
  1. Read usage from each API response immediately.
  2. Compute incremental cost.
  3. Maintain running total.
  4. Check running_total + estimated < ceiling before each task.
"""

from dataclasses import dataclass, field


@dataclass
class CostTracker:
    """Tracks cumulative API costs during a benchmark run.

    Args:
        pricing:     Dict with "input_per_mtok" and "output_per_mtok" (USD per million tokens).
        run_ceiling: Maximum cost in USD for this run.
    """
    pricing: dict
    run_ceiling: float
    running_total: float = 0.0
    last_task_cost: float = 0.0
    task_costs: list = field(default_factory=list)

    def estimate_task_cost(self, max_tokens: int) -> float:
        """Estimate cost assuming max_tokens input and 20% output."""
        input_cost = (max_tokens / 1_000_000) * self.pricing["input_per_mtok"]
        output_cost = (max_tokens * 0.2 / 1_000_000) * self.pricing["output_per_mtok"]
        return input_cost + output_cost

    def can_afford(self, estimated_cost: float) -> bool:
        """Check if running a task would stay under the cost ceiling."""
        return (self.running_total + estimated_cost) <= self.run_ceiling

    def record_usage(self, usage: dict) -> float:
        """Record actual token usage from an API response.

        Returns the cost of this task in USD.
        """
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        cost = (
            (input_tokens / 1_000_000) * self.pricing["input_per_mtok"]
            + (output_tokens / 1_000_000) * self.pricing["output_per_mtok"]
        )

        self.last_task_cost = cost
        self.running_total += cost
        self.task_costs.append({
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost, 4),
        })
        return cost

    def get_summary(self) -> dict:
        """Return cost summary for the run."""
        return {
            "running_total_usd": round(self.running_total, 4),
            "run_ceiling_usd": self.run_ceiling,
            "remaining_budget_usd": round(self.run_ceiling - self.running_total, 4),
            "tasks_costed": len(self.task_costs),
        }
