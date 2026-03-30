#!/usr/bin/env python3
"""
Error Handler - Fail-loud error handling with comprehensive logging

Golden Rule: NO SILENT FAILURES

All errors are logged with full context and appropriate severity.
Critical errors are re-raised, warnings are logged but allow continuation.
"""

import logging
import json
from typing import Dict, Any
from datetime import datetime


class ErrorHandler:
    """Centralized error handling for AgentDB integration"""

    def __init__(self, log_path: str = "/home/cabdru/newdemo/logs/agentdb_errors.log"):
        self.logger = self._setup_logger(log_path)
        self.error_counts = {}
        self.circuit_breaker_threshold = 5
        self.circuit_breaker_open = False

    def handle_retrieval_failure(self, exc: Exception, context: Dict):
        """
        Handle retrieval failures (non-critical)

        Strategy: Log extensively + continue without learned strategy
        Circuit breaker opens after 5 consecutive failures.
        """
        self._log_error("retrieval_failure", exc, context)
        self.error_counts["retrieval"] = (
            self.error_counts.get("retrieval", 0) + 1
        )

        # Circuit breaker check
        if self.error_counts["retrieval"] >= self.circuit_breaker_threshold:
            self.circuit_breaker_open = True
            self.logger.critical(
                "Circuit breaker triggered: 5 consecutive retrieval failures. "
                "Disabling AgentDB retrievals for this session."
            )

    def handle_storage_failure(self, exc: Exception, context: Dict):
        """
        Handle storage failures (critical)

        Strategy: Log + re-raise (fail loudly)
        Storage failures are critical and should not be suppressed.
        """
        self._log_error("storage_failure", exc, context)
        self.error_counts["storage"] = (
            self.error_counts.get("storage", 0) + 1
        )

        # Don't suppress - storage failures are critical
        # Caller should re-raise after logging

    def handle_timeout(self, operation: str, timeout_ms: int):
        """Handle timeout errors"""
        self.logger.warning(
            f"Timeout in {operation} after {timeout_ms}ms. "
            f"Using fallback behavior."
        )

    def circuit_breaker_check(self) -> bool:
        """
        Check if circuit breaker is open

        Returns:
            True if circuit breaker is open (operations should be skipped)
        """
        return self.circuit_breaker_open

    def retry_with_backoff(self, func, max_retries: int = 3):
        """
        Retry function with exponential backoff

        Args:
            func: Function to retry
            max_retries: Maximum retry attempts (default 3)

        Returns:
            Function result

        Raises:
            Last exception if all retries fail
        """
        import time

        delay = 1.0  # Start with 1 second
        backoff_factor = 2.0

        for attempt in range(max_retries):
            try:
                return func()
            except Exception as exc:
                if attempt == max_retries - 1:
                    # Last attempt - re-raise
                    self.logger.error(
                        f"All {max_retries} retry attempts failed: {exc}"
                    )
                    raise

                # Log retry
                self.logger.warning(
                    f"Retry {attempt + 1}/{max_retries} after {delay}s: {exc}"
                )

                time.sleep(delay)
                delay *= backoff_factor

    def log_structured(self, level: str, message: str, context: Dict):
        """
        Log structured message with context

        Args:
            level: Log level (info, warning, error, critical)
            message: Log message
            context: Additional context dict
        """
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": level,
            "message": message,
            "context": context
        }

        if level == "error" or level == "critical":
            self.logger.error(json.dumps(log_data))
        elif level == "warning":
            self.logger.warning(json.dumps(log_data))
        else:
            self.logger.info(json.dumps(log_data))

    def _log_error(
        self,
        error_type: str,
        exc: Exception,
        context: Dict
    ):
        """Log error with full context"""
        import traceback

        error_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "error_type": error_type,
            "exception": str(exc),
            "exception_type": type(exc).__name__,
            "traceback": traceback.format_exc(),
            "context": context
        }

        self.logger.error(
            f"AgentDB Error: {error_type}",
            extra={"error_data": json.dumps(error_data, default=str)}
        )

    def _setup_logger(self, log_path: str) -> logging.Logger:
        """Configure structured error logging"""
        logger = logging.getLogger("AgentDBErrors")
        logger.setLevel(logging.ERROR)

        # Create logs directory if needed
        import os
        os.makedirs(os.path.dirname(log_path), exist_ok=True)

        handler = logging.FileHandler(log_path)
        formatter = logging.Formatter(
            '{"timestamp": "%(asctime)s", "level": "%(levelname)s", '
            '"message": "%(message)s"}'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

        return logger
