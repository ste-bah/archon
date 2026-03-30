#!/usr/bin/env python3
"""
Final validation hook that runs when Claude stops
Ensures all changes pass logical consistency checks

Usage:
    Called automatically by Claude Code when Claude finishes responding
    Input: JSON via stdin with session_id
    Output: Summary printed to stderr, exit code always 0 (informational only)
"""

import json
import sys
import subprocess
import os
from pathlib import Path
from typing import List, Tuple

# Add hooks directory to path so we can import logic_validator
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logic_validator import analyze_code_logic


def get_modified_files() -> List[str]:
    """
    Get all modified Python files in the working directory

    Returns:
        List of file paths
    """
    try:
        result = subprocess.run(
            ['git', 'status', '--porcelain'],
            capture_output=True,
            text=True,
            check=True,
            cwd=os.getcwd()
        )

        modified_files = []
        for line in result.stdout.strip().split('\n'):
            if not line or not line.strip():
                continue

            # Parse git status output
            # Format: XY filename
            # X = status in index, Y = status in working tree
            status = line[:2]
            file_path = line[3:].strip()

            # Include modified, added, renamed files
            if file_path.endswith('.py') and status.strip():
                # Remove any quotes that git might add
                file_path = file_path.strip('"')
                modified_files.append(file_path)

        return modified_files

    except subprocess.CalledProcessError as e:
        print(f"Warning: Could not get git status: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"Warning: Error getting modified files: {e}", file=sys.stderr)
        return []


def validate_files(files: List[str]) -> Tuple[List[Tuple[str, dict]], List[Tuple[str, dict]]]:
    """
    Validate a list of files

    Returns:
        Tuple of (failed_files, warned_files)
    """
    failed_files = []
    warned_files = []

    for file_path in files:
        full_path = Path(file_path)

        if not full_path.exists():
            continue

        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                code = f.read()

            result = analyze_code_logic(code, str(file_path))

            if result['is_buggy']:
                failed_files.append((file_path, result))
            elif result.get('warnings'):
                warned_files.append((file_path, result))

        except Exception as e:
            print(f"Warning: Could not validate {file_path}: {e}", file=sys.stderr)
            continue

    return failed_files, warned_files


def format_summary(failed_files: List[Tuple[str, dict]], warned_files: List[Tuple[str, dict]]) -> str:
    """Format validation summary"""

    summary = []
    summary.append("\n" + "=" * 60)
    summary.append("📊 FINAL VALIDATION SUMMARY")
    summary.append("=" * 60 + "\n")

    if not failed_files and not warned_files:
        summary.append("✅ All modified files passed validation")
        summary.append("\nNo logical inconsistencies detected.")
        return '\n'.join(summary)

    if failed_files:
        summary.append("❌ CRITICAL ISSUES FOUND\n")
        summary.append("The following files have logical inconsistencies:\n")

        for file_path, result in failed_files:
            summary.append(f"  📄 {file_path}")

            critical_issues = [i for i in result['issues'] if i.severity == 'critical']
            for issue in critical_issues:
                summary.append(f"     Line {issue.line}: {issue.message}")
                summary.append(f"     💡 {issue.suggestion}")

            summary.append("")

        summary.append("⚠️  Please fix these issues before committing.\n")

    if warned_files:
        summary.append("⚠️  WARNINGS\n")
        summary.append("The following files have warnings:\n")

        for file_path, result in warned_files:
            summary.append(f"  📄 {file_path}")

            warning_issues = [i for i in result['issues'] if i.severity == 'warning']
            for issue in warning_issues[:3]:  # Limit to first 3 warnings
                summary.append(f"     Line {issue.line}: {issue.message}")

            if len(warning_issues) > 3:
                summary.append(f"     ... and {len(warning_issues) - 3} more warnings")

            summary.append("")

    summary.append("=" * 60)

    return '\n'.join(summary)


def main():
    """Main hook execution"""
    try:
        # Read hook input from stdin
        input_data = json.load(sys.stdin)
        session_id = input_data.get('session_id', 'unknown')

        print(f"\n🔍 Running final validation for session {session_id}...", file=sys.stderr)

        # Get all modified Python files
        modified_files = get_modified_files()

        if not modified_files:
            print("✓ No modified Python files to validate", file=sys.stderr)
            sys.exit(0)

        print(f"Validating {len(modified_files)} modified file(s)...", file=sys.stderr)

        # Validate all files
        failed_files, warned_files = validate_files(modified_files)

        # Print summary
        summary = format_summary(failed_files, warned_files)
        print(summary, file=sys.stderr)

        # Always exit 0 for Stop hooks (informational only)
        sys.exit(0)

    except json.JSONDecodeError:
        print("Warning: Invalid JSON input to hook", file=sys.stderr)
        sys.exit(0)
    except Exception as e:
        print(f"Error in final validation: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
