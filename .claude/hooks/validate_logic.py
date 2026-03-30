#!/usr/bin/env python3
"""
Pre-tool-use validation hook for Edit/Write/MultiEdit operations
Validates code before it's written to files

Usage:
    Called automatically by Claude Code before Edit/Write/MultiEdit
    Input: JSON via stdin with tool_input containing file_path and content
    Output: Exit code 0 (allow), 2 (block)
"""

import json
import sys
import os
from pathlib import Path

# Add hooks directory to path so we can import logic_validator
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logic_validator import analyze_code_logic


def main():
    """Main hook execution"""
    try:
        # Read hook input from stdin
        input_data = json.load(sys.stdin)
        tool_input = input_data.get('tool_input', {})
        tool_name = input_data.get('tool_name', '')

        # Extract file path and content based on tool type
        file_path = tool_input.get('file_path', '')

        # Get the content that will be written
        if tool_name == 'Write':
            content = tool_input.get('content', '')
        elif tool_name == 'Edit':
            # For Edit, we need to read the current file and apply the edit
            # For simplicity, we'll skip validation on Edit (it's complex)
            # and rely on PostToolUse instead
            sys.exit(0)
        else:
            # Unknown tool or MultiEdit
            sys.exit(0)

        # Only validate Python files
        if not file_path or not file_path.endswith('.py'):
            sys.exit(0)

        # Don't validate empty files
        if not content or not content.strip():
            sys.exit(0)

        print(f"🔍 Validating code before writing to {file_path}...", file=sys.stderr)

        # Analyze the code
        result = analyze_code_logic(content, str(file_path))

        if result['is_buggy']:
            # Block the write operation
            error_msg = f"⛔ VALIDATION FAILED for {file_path}\n\n"
            error_msg += "The code you're about to write has logical issues:\n\n"

            critical_issues = [i for i in result['issues'] if i.severity == 'critical']
            for issue in critical_issues:
                error_msg += f"  Line {issue.line}:{issue.column} - [{issue.issue_type}]\n"
                error_msg += f"    ❌ {issue.message}\n"
                error_msg += f"    💡 {issue.suggestion}\n\n"

            error_msg += "Please fix these issues before writing the file."

            print(error_msg, file=sys.stderr)

            # Return structured feedback
            feedback = {
                "decision": "block",
                "reason": "Code contains logical inconsistencies",
                "suggestion": "Fix the critical issues listed above"
            }
            print(json.dumps(feedback))
            sys.exit(2)  # Block

        # Show any warnings but allow the operation
        warning_issues = [i for i in result['issues'] if i.severity == 'warning']
        if warning_issues:
            print(f"\n⚠️  Warnings for {file_path}:", file=sys.stderr)
            for issue in warning_issues:
                print(f"  Line {issue.line}: {issue.message}", file=sys.stderr)
            print("", file=sys.stderr)

        print(f"✓ Code validation passed for {file_path}", file=sys.stderr)
        sys.exit(0)  # Allow

    except json.JSONDecodeError:
        print("Warning: Invalid JSON input to hook", file=sys.stderr)
        sys.exit(0)  # Don't block on hook errors
    except Exception as e:
        print(f"Warning: Error in validation hook: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(0)  # Don't block on hook errors


if __name__ == "__main__":
    main()
