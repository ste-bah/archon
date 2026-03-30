#!/usr/bin/env python3
"""
Pre-commit hook for Claude Code that validates logical consistency
Blocks commits if code has logical contradictions

Usage:
    Called automatically by Claude Code before git commit commands
    Input: JSON via stdin with session_id and tool_input
    Output: Exit code 0 (allow), 1 (error), 2 (block)
"""

import json
import sys
import subprocess
from pathlib import Path
import os

# Add hooks directory to path so we can import logic_validator
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logic_validator import analyze_code_logic


def validate_staged_files():
    """
    Get all staged Python files and validate them

    Returns:
        Tuple[bool, str]: (success, message)
    """
    try:
        # Get staged files
        result = subprocess.run(
            ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
            capture_output=True,
            text=True,
            check=True,
            cwd=os.getcwd()
        )

        staged_files = [
            f for f in result.stdout.strip().split('\n')
            if f and f.endswith('.py')
        ]

        if not staged_files:
            return True, "No Python files to validate"

        # Run logical validation on each file
        failed_files = []
        all_issues = []

        for file_path in staged_files:
            full_path = Path(file_path)
            if not full_path.exists():
                continue

            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    code = f.read()

                result = analyze_code_logic(code, str(file_path))

                if result['is_buggy']:
                    failed_files.append(file_path)
                    all_issues.extend([
                        (file_path, issue)
                        for issue in result['issues']
                        if issue.severity == 'critical'
                    ])

            except Exception as e:
                print(f"Warning: Could not validate {file_path}: {e}", file=sys.stderr)
                continue

        if failed_files:
            error_msg = "❌ LOGICAL VALIDATION FAILED\n\n"
            error_msg += "The following files have logical inconsistencies:\n\n"

            for file_path, issue in all_issues:
                error_msg += f"  {file_path}:{issue.line}:{issue.column}\n"
                error_msg += f"    [{issue.issue_type}] {issue.message}\n"
                error_msg += f"    💡 {issue.suggestion}\n\n"

            error_msg += "\n🔧 Please fix these issues before committing.\n"
            return False, error_msg

        return True, f"✓ All {len(staged_files)} files passed logical validation"

    except subprocess.CalledProcessError as e:
        return False, f"Error running git command: {e}"
    except Exception as e:
        return False, f"Error during validation: {str(e)}"


def main():
    """Main hook execution"""
    try:
        # Read hook input from stdin
        input_data = json.load(sys.stdin)

        # Extract information
        session_id = input_data.get('session_id', 'unknown')
        tool_input = input_data.get('tool_input', {})
        command = tool_input.get('command', '')

        print(f"🔍 Running pre-commit validation...", file=sys.stderr)

        # Run validation
        success, message = validate_staged_files()

        if success:
            print(f"✅ {message}", file=sys.stderr)
            sys.exit(0)  # Allow commit
        else:
            # Block commit and provide feedback to Claude
            print(message, file=sys.stderr)

            # Return structured feedback for Claude
            feedback = {
                "decision": "block",
                "reason": message,
                "suggestion": "Please fix the logical inconsistencies in the code before committing."
            }
            print(json.dumps(feedback))
            sys.exit(2)  # Block commit (exit code 2)

    except json.JSONDecodeError:
        print("❌ Invalid JSON input", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ Hook error: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
