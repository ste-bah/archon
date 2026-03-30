"""Error pattern matching for log monitoring."""

import re
from typing import Optional

DEFAULT_ERROR_PATTERNS = [
    re.compile(r"\bERROR\b", re.IGNORECASE),
    re.compile(r"\bFATAL\b", re.IGNORECASE),
    re.compile(r"\bCRITICAL\b", re.IGNORECASE),
    re.compile(r"\bFAILED\b", re.IGNORECASE),
    re.compile(r"\bException\b"),
    re.compile(r"\bTraceback\b"),
    re.compile(r"^\s+at\s+"),                    # Node.js stack traces
    re.compile(r"\bsegfault\b", re.IGNORECASE),
    re.compile(r"\bOOM\b|Out of memory", re.IGNORECASE),
    re.compile(r"exit code [1-9]\d*"),
    re.compile(r"\bTIMEOUT\b", re.IGNORECASE),
    re.compile(r"\bDEADLOCK\b", re.IGNORECASE),
    re.compile(r"\bConnection refused\b", re.IGNORECASE),
    re.compile(r"\bENOSPC\b"),
    re.compile(r"\bENOMEM\b"),
    re.compile(r"\bpermission denied\b", re.IGNORECASE),
]

# Severity mapping: pattern → severity
_CRITICAL_PATTERNS = {"FATAL", "segfault", "OOM", "Out of memory", "ENOSPC", "ENOMEM", "DEADLOCK"}
_ERROR_PATTERNS = {"ERROR", "FAILED", "Exception", "Traceback", "Connection refused", "permission denied"}
_WARNING_PATTERNS = {"TIMEOUT"}


def compile_patterns(pattern_strings: list[str]) -> list[re.Pattern]:
    """Compile user-provided regex strings. Invalid patterns raise ValueError."""
    compiled = []
    for s in pattern_strings:
        try:
            compiled.append(re.compile(s))
        except re.error as e:
            raise ValueError(f"Invalid regex pattern '{s}': {e}")
    return compiled


def match_line(line: str, patterns: Optional[list[re.Pattern]] = None) -> Optional[re.Pattern]:
    """Return the first matching pattern, or None."""
    if patterns is None:
        patterns = DEFAULT_ERROR_PATTERNS
    for p in patterns:
        if p.search(line):
            return p
    return None


def classify_severity(pattern: re.Pattern, line: str) -> str:
    """Map a matched pattern to a severity level."""
    pat_str = pattern.pattern

    for crit in _CRITICAL_PATTERNS:
        if crit.lower() in pat_str.lower():
            return "critical"

    for err in _ERROR_PATTERNS:
        if err.lower() in pat_str.lower():
            return "error"

    for warn in _WARNING_PATTERNS:
        if warn.lower() in pat_str.lower():
            return "warning"

    return "info"
