#!/usr/bin/env python3
"""
Post-tool-use hook that analyzes code after Claude edits it
Provides immediate feedback on logical issues

Usage:
    Called automatically by Claude Code after Edit/Write/MultiEdit
    Input: JSON via stdin with tool_input containing file_path
    Output: Feedback printed to stderr, exit code 0 (continue) or 2 (block)
"""

import json
import sys
import os
from pathlib import Path

# Add hooks directory to path so we can import logic_validator
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logic_validator import analyze_code_logic


def format_issue_report(result: dict) -> str:
    """Format validation results into a readable report"""

    if not result['is_buggy'] and not result.get('warnings'):
        return f"✓ {result['file_path']} is logically consistent"

    report = []

    if result['is_buggy']:
        report.append(f"⚠️  LOGICAL ISSUES DETECTED in {result['file_path']}\n")

        critical_issues = [i for i in result['issues'] if i.severity == 'critical']
        for issue in critical_issues:
            report.append(f"  Line {issue.line}:{issue.column} - [{issue.issue_type}]")
            report.append(f"    ❌ {issue.message}")
            report.append(f"    💡 {issue.suggestion}\n")

    if result.get('warnings'):
        warning_issues = [i for i in result['issues'] if i.severity == 'warning']
        if warning_issues:
            report.append(f"\n  Warnings:")
            for issue in warning_issues:
                report.append(f"    Line {issue.line}: {issue.message}")

    info_issues = [i for i in result['issues'] if i.severity == 'info']
    if info_issues:
        report.append(f"\n  Suggestions:")
        for issue in info_issues:
            report.append(f"    Line {issue.line}: {issue.message}")

    return '\n'.join(report)


def main():
    """Main hook execution"""
    try:
        # Read hook input from stdin
        input_data = json.load(sys.stdin)
        tool_input = input_data.get('tool_input', {})
        file_path = tool_input.get('file_path', '')

        # Only process Python files
        if not file_path or not file_path.endswith('.py'):
            sys.exit(0)

        # Check if file exists
        full_path = Path(file_path)
        if not full_path.exists():
            print(f"Warning: File {file_path} does not exist", file=sys.stderr)
            sys.exit(0)

        print(f"🔍 Analyzing {file_path} for logical consistency...", file=sys.stderr)

        # Read the file
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                code = f.read()
        except Exception as e:
            print(f"Error reading {file_path}: {e}", file=sys.stderr)
            sys.exit(0)

        # Analyze the code
        result = analyze_code_logic(code, str(file_path))

        # Format and print report
        report = format_issue_report(result)
        print(report, file=sys.stderr)

        # Decide whether to block
        # For PostToolUse, we generally don't block (just warn)
        # But you can uncomment the lines below to block on critical issues
        #
        # if result['is_buggy']:
        #     print("\n⛔ Please fix critical issues before continuing.", file=sys.stderr)
        #     sys.exit(2)  # Block

        sys.exit(0)  # Continue

    except json.JSONDecodeError:
        print("Warning: Invalid JSON input to hook", file=sys.stderr)
        sys.exit(0)
    except Exception as e:
        print(f"Error in code analysis hook: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(0)  # Don't block on hook errors


if __name__ == "__main__":
    main()
