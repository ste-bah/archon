#!/usr/bin/env python3
"""
Metrics Tracker - Performance and usage metrics tracking

Tracks:
- Retrieval latency and cache hit rates
- Storage operations and failures
- Session-level statistics
- Performance metrics for optimization
"""

import json
import time
from typing import Dict
from collections import defaultdict


class MetricsTracker:
    """Singleton service for metrics tracking"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, metrics_file: str = "/home/cabdru/newdemo/.agentdb/metrics.json"):
        if self._initialized:
            return

        self.metrics_file = metrics_file
        self.counters = defaultdict(int)
        self.timings = defaultdict(list)
        self.gauges = {}
        self._initialized = True

        # Create directory if needed
        import os
        os.makedirs(os.path.dirname(metrics_file), exist_ok=True)

    def track_retrieval(self, latency_ms: float, cache_hit: bool):
        """
        Track retrieval operation

        Args:
            latency_ms: Time taken in milliseconds
            cache_hit: Whether this was a cache hit
        """
        self.counters["retrievals_total"] += 1
        if cache_hit:
            self.counters["retrievals_cache_hit"] += 1
        else:
            self.counters["retrievals_cache_miss"] += 1

        self.timings["retrieval_latency_ms"].append(latency_ms)

    def track_storage(self, pattern_id: str, confidence: float):
        """
        Track storage operation

        Args:
            pattern_id: ID of stored pattern
            confidence: Confidence score of pattern
        """
        self.counters["storage_operations"] += 1
        self.gauges["last_pattern_id"] = pattern_id
        self.timings["storage_confidence"].append(confidence)

    def track_session(self, patterns_learned: int, confidence_gain: float):
        """
        Track session-level metrics

        Args:
            patterns_learned: Number of patterns learned
            confidence_gain: Average confidence improvement
        """
        self.counters["sessions_completed"] += 1
        self.counters["total_patterns_learned"] += patterns_learned
        self.timings["session_confidence_gain"].append(confidence_gain)

    def increment(self, metric_name: str, tags: Dict = None):
        """
        Increment a counter metric

        Args:
            metric_name: Name of metric
            tags: Optional tags dict
        """
        key = metric_name
        if tags:
            tag_str = "_".join(f"{k}={v}" for k, v in sorted(tags.items()))
            key = f"{metric_name}_{tag_str}"

        self.counters[key] += 1

    def record_latency(self, operation: str, duration_ms: float):
        """
        Record latency for an operation

        Args:
            operation: Operation name
            duration_ms: Duration in milliseconds
        """
        self.timings[f"{operation}_latency_ms"].append(duration_ms)

    def get_stats(self) -> Dict:
        """
        Get all metrics statistics

        Returns:
            Dict with metrics summary
        """
        stats = {
            "counters": dict(self.counters),
            "gauges": dict(self.gauges),
            "timings": {}
        }

        # Calculate timing statistics
        for key, values in self.timings.items():
            if not values:
                continue

            stats["timings"][key] = {
                "count": len(values),
                "min": min(values),
                "max": max(values),
                "avg": sum(values) / len(values),
                "p95": self._percentile(values, 0.95),
                "p99": self._percentile(values, 0.99)
            }

        return stats

    def generate_report(self) -> Dict:
        """
        Generate comprehensive metrics report

        Returns:
            Dict with formatted report
        """
        stats = self.get_stats()

        # Calculate cache hit rate
        total_retrievals = self.counters.get("retrievals_total", 0)
        cache_hits = self.counters.get("retrievals_cache_hit", 0)
        cache_hit_rate = cache_hits / total_retrievals if total_retrievals > 0 else 0

        # Calculate average confidence
        confidence_scores = self.timings.get("storage_confidence", [])
        avg_confidence = (
            sum(confidence_scores) / len(confidence_scores)
            if confidence_scores else 0
        )

        report = {
            "summary": {
                "total_retrievals": total_retrievals,
                "cache_hit_rate": cache_hit_rate,
                "total_storage_operations": self.counters.get("storage_operations", 0),
                "avg_confidence": avg_confidence,
                "sessions_completed": self.counters.get("sessions_completed", 0),
                "total_patterns_learned": self.counters.get("total_patterns_learned", 0)
            },
            "performance": {
                "retrieval_latency_ms": stats["timings"].get("retrieval_latency_ms", {}),
                "storage_operations": stats["counters"].get("storage_operations", 0)
            },
            "errors": {
                "retrieval_failures": self.counters.get("retrievals_failed", 0),
                "storage_failures": self.counters.get("storage_failed", 0)
            }
        }

        return report

    def save_metrics(self):
        """Save metrics to file"""
        stats = self.get_stats()
        report = self.generate_report()

        output = {
            "timestamp": time.time(),
            "stats": stats,
            "report": report
        }

        with open(self.metrics_file, 'w') as f:
            json.dump(output, f, indent=2)

    def _percentile(self, values: list, p: float) -> float:
        """Calculate percentile of values"""
        if not values:
            return 0

        sorted_values = sorted(values)
        index = int(len(sorted_values) * p)
        return sorted_values[min(index, len(sorted_values) - 1)]
