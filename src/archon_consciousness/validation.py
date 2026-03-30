"""Shared validation helpers for schema dataclasses.

Extracted from schemas.py to keep files under 500 lines.
All validation is fail-fast (raises immediately on invalid input).
"""

import math
import re
from datetime import datetime
from typing import Any

from src.archon_consciousness.constants import RULE_ID_MAX_LENGTH, RULE_ID_PATTERN


def validate_float_field(value: Any, name: str, min_val: float, max_val: float) -> None:
    """Validate a float field: not bool, not NaN/Inf, within range."""
    if isinstance(value, bool):
        raise TypeError(f"{name} must be float, got bool")
    if not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be float, got {type(value).__name__}")
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"{name} must be finite, got {value}")
    if value < min_val or value > max_val:
        raise ValueError(f"{name} must be in [{min_val}, {max_val}], got {value}")


def validate_int_field(value: Any, name: str, min_val: int) -> None:
    """Validate an int field: not bool, above minimum."""
    if isinstance(value, bool):
        raise TypeError(f"{name} must be int, got bool")
    if not isinstance(value, int):
        raise TypeError(f"{name} must be int, got {type(value).__name__}")
    if value < min_val:
        raise ValueError(f"{name} must be >= {min_val}, got {value}")


def validate_nonempty_str(value: Any, name: str) -> None:
    """Validate a non-empty string field."""
    if not isinstance(value, str):
        raise TypeError(f"{name} must be str, got {type(value).__name__}")
    if not value.strip():
        raise ValueError(f"{name} must not be empty")


def validate_enum_str(value: Any, name: str, allowed: tuple) -> None:
    """Validate a string field against an enum of allowed values."""
    if not isinstance(value, str):
        raise TypeError(f"{name} must be str, got {type(value).__name__}")
    if value not in allowed:
        raise ValueError(f"{name} must be one of {allowed}, got '{value}'")


def validate_rule_id(value: Any, name: str = "rule_id") -> None:
    """Validate a kebab-case rule_id."""
    validate_nonempty_str(value, name)
    if len(value) > RULE_ID_MAX_LENGTH:
        raise ValueError(
            f"{name} must be <= {RULE_ID_MAX_LENGTH} chars, got {len(value)}"
        )
    if not re.match(RULE_ID_PATTERN, value):
        raise ValueError(
            f"{name} must be kebab-case (lowercase alphanumeric + hyphens), "
            f"got '{value}'"
        )


def validate_str_list(value: Any, name: str, max_len: int | None = None) -> None:
    """Validate a list of strings."""
    if not isinstance(value, list):
        raise TypeError(f"{name} must be list, got {type(value).__name__}")
    for i, item in enumerate(value):
        if not isinstance(item, str):
            raise TypeError(f"{name}[{i}] must be str, got {type(item).__name__}")
    if max_len is not None and len(value) > max_len:
        raise ValueError(f"{name} must have at most {max_len} items, got {len(value)}")


def validate_datetime(value: Any, name: str) -> None:
    """Validate a datetime field."""
    if not isinstance(value, datetime):
        raise TypeError(f"{name} must be datetime, got {type(value).__name__}")


def datetime_to_str(dt: datetime) -> str:
    """Serialize datetime to ISO format string."""
    return dt.isoformat()


def str_to_datetime(s: str) -> datetime:
    """Deserialize ISO format string to datetime."""
    return datetime.fromisoformat(s)
