#!/usr/bin/env python3
"""
Logic Validator Module for Claude Code Hooks

Analyzes Python code for logical inconsistencies, silent failures,
and anti-patterns based on lessons learned from production system fixes.

Key checks:
1. Silent failure patterns (empty returns without logging)
2. Broad exception handling without logging
3. Missing error propagation for critical failures
4. Untracked failure metrics
5. Ambiguous error messages
"""

import ast
import re
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class LogicIssue:
    """Represents a logical consistency issue"""
    severity: str  # 'critical', 'warning', 'info'
    line: int
    column: int
    issue_type: str
    message: str
    suggestion: str


class LogicValidator:
    """Validates Python code for logical consistency issues"""

    def __init__(self):
        self.issues: List[LogicIssue] = []

    def analyze_code_logic(self, code: str, file_path: str = "<unknown>") -> Dict:
        """
        Main analysis function

        Returns:
            Dict with keys:
                - is_buggy: bool
                - issues: List[LogicIssue]
                - logical_statement: str (summary)
                - contradictions: List[str]
        """
        self.issues = []

        try:
            tree = ast.parse(code)

            # Run all checks
            self._check_silent_failures(tree, code)
            self._check_broad_exceptions(tree, code)
            self._check_missing_metrics(tree, code)
            self._check_error_propagation(tree, code)
            self._check_ambiguous_errors(tree, code)

            # Categorize issues
            critical_issues = [i for i in self.issues if i.severity == 'critical']
            warnings = [i for i in self.issues if i.severity == 'warning']

            is_buggy = len(critical_issues) > 0

            # Generate summary
            logical_statement = self._generate_summary()
            contradictions = [i.message for i in critical_issues]

            return {
                'is_buggy': is_buggy,
                'issues': self.issues,
                'logical_statement': logical_statement,
                'contradictions': contradictions,
                'warnings': [i.message for i in warnings],
                'file_path': file_path
            }

        except SyntaxError as e:
            return {
                'is_buggy': True,
                'issues': [],
                'logical_statement': f"Syntax error at line {e.lineno}",
                'contradictions': [str(e)],
                'warnings': [],
                'file_path': file_path
            }

    def _check_silent_failures(self, tree: ast.AST, code: str):
        """Check for silent failure patterns"""

        class SilentFailureVisitor(ast.NodeVisitor):
            def __init__(self, validator):
                self.validator = validator

            def visit_Try(self, node):
                for handler in node.handlers:
                    # Check if handler catches broad exceptions
                    if handler.type is None or (
                        isinstance(handler.type, ast.Name) and
                        handler.type.id == 'Exception'
                    ):
                        # Check for empty return without logging
                        has_logging = self._has_logging(handler.body)
                        has_empty_return = self._has_empty_return(handler.body)

                        if has_empty_return and not has_logging:
                            self.validator.issues.append(LogicIssue(
                                severity='critical',
                                line=handler.lineno,
                                column=handler.col_offset,
                                issue_type='silent_failure',
                                message=f"Silent failure: Exception caught but returns empty value without logging (line {handler.lineno})",
                                suggestion="Add logging before returning empty value, or re-raise critical errors"
                            ))

                self.generic_visit(node)

            def _has_logging(self, body: List[ast.stmt]) -> bool:
                """Check if body contains logging calls"""
                for node in ast.walk(ast.Module(body=body)):
                    if isinstance(node, ast.Call):
                        if isinstance(node.func, ast.Attribute):
                            if node.func.attr in ('error', 'warning', 'info', 'debug', 'critical'):
                                return True
                        elif isinstance(node.func, ast.Name):
                            if node.func.id in ('print',):  # print is acceptable for debugging
                                return True
                return False

            def _has_empty_return(self, body: List[ast.stmt]) -> bool:
                """Check if body has return [] or return None or return"""
                for stmt in body:
                    if isinstance(stmt, ast.Return):
                        if stmt.value is None:
                            return True
                        if isinstance(stmt.value, ast.List) and len(stmt.value.elts) == 0:
                            return True
                        if isinstance(stmt.value, ast.Dict) and len(stmt.value.keys) == 0:
                            return True
                        if isinstance(stmt.value, ast.Constant) and stmt.value.value is None:
                            return True
                return False

        visitor = SilentFailureVisitor(self)
        visitor.visit(tree)

    def _check_broad_exceptions(self, tree: ast.AST, code: str):
        """Check for overly broad exception handling"""

        class BroadExceptionVisitor(ast.NodeVisitor):
            def __init__(self, validator):
                self.validator = validator

            def visit_Try(self, node):
                for handler in node.handlers:
                    # Check for bare 'except:' or 'except Exception:'
                    if handler.type is None:
                        self.validator.issues.append(LogicIssue(
                            severity='warning',
                            line=handler.lineno,
                            column=handler.col_offset,
                            issue_type='bare_except',
                            message=f"Bare except clause at line {handler.lineno} catches all exceptions including system exits",
                            suggestion="Use specific exception types (e.g., ValueError, RuntimeError) instead"
                        ))
                    elif isinstance(handler.type, ast.Name) and handler.type.id == 'Exception':
                        # This is sometimes OK, but warn if no re-raise
                        has_reraise = self._has_reraise(handler.body)
                        has_specific_handling = self._has_specific_handling(handler.body)

                        if not has_reraise and not has_specific_handling:
                            self.validator.issues.append(LogicIssue(
                                severity='warning',
                                line=handler.lineno,
                                column=handler.col_offset,
                                issue_type='broad_exception',
                                message=f"Broad 'Exception' catch at line {handler.lineno} without re-raising or specific handling",
                                suggestion="Use specific exception types or add conditional re-raise for critical errors"
                            ))

                self.generic_visit(node)

            def _has_reraise(self, body: List[ast.stmt]) -> bool:
                """Check if handler re-raises exceptions"""
                for stmt in body:
                    if isinstance(stmt, ast.Raise) and stmt.exc is None:
                        return True
                    if isinstance(stmt, ast.If):
                        # Check if conditional re-raise
                        for if_stmt in stmt.body + stmt.orelse:
                            if isinstance(if_stmt, ast.Raise):
                                return True
                return False

            def _has_specific_handling(self, body: List[ast.stmt]) -> bool:
                """Check if handler has specific error type checking"""
                for node in ast.walk(ast.Module(body=body)):
                    if isinstance(node, ast.If):
                        # Look for checks like 'cuda' in str(e).lower()
                        test = node.test
                        if isinstance(test, ast.Compare):
                            return True
                return False

        visitor = BroadExceptionVisitor(self)
        visitor.visit(tree)

    def _check_missing_metrics(self, tree: ast.AST, code: str):
        """Check for exception handlers without metrics tracking"""

        class MetricsVisitor(ast.NodeVisitor):
            def __init__(self, validator):
                self.validator = validator
                self.has_metrics = False

            def visit_Try(self, node):
                for handler in node.handlers:
                    # Check if metrics are tracked in handler
                    has_metrics_increment = self._has_metrics(handler.body)
                    has_logging = self._has_logging(handler.body)

                    if not has_metrics_increment and has_logging:
                        # This is a warning, not critical
                        self.validator.issues.append(LogicIssue(
                            severity='info',
                            line=handler.lineno,
                            column=handler.col_offset,
                            issue_type='missing_metrics',
                            message=f"Exception handler at line {handler.lineno} logs errors but doesn't track metrics",
                            suggestion="Consider adding failure metrics (e.g., self.metrics['error_type'] += 1)"
                        ))

                self.generic_visit(node)

            def _has_metrics(self, body: List[ast.stmt]) -> bool:
                """Check if metrics are incremented"""
                for node in ast.walk(ast.Module(body=body)):
                    if isinstance(node, ast.AugAssign):
                        # Check for self.metrics['key'] += 1
                        if isinstance(node.target, ast.Subscript):
                            if isinstance(node.target.value, ast.Attribute):
                                if node.target.value.attr == 'metrics':
                                    return True
                return False

            def _has_logging(self, body: List[ast.stmt]) -> bool:
                """Check if logging is present"""
                for node in ast.walk(ast.Module(body=body)):
                    if isinstance(node, ast.Call):
                        if isinstance(node.func, ast.Attribute):
                            if node.func.attr in ('error', 'warning', 'info', 'debug', 'critical'):
                                return True
                return False

        visitor = MetricsVisitor(self)
        visitor.visit(tree)

    def _check_error_propagation(self, tree: ast.AST, code: str):
        """Check for critical errors that should propagate but don't"""

        class ErrorPropagationVisitor(ast.NodeVisitor):
            def __init__(self, validator):
                self.validator = validator

            def visit_Try(self, node):
                for handler in node.handlers:
                    # Look for critical error patterns that should propagate
                    has_critical_keywords = self._has_critical_error_keywords(handler.body, ast.unparse(handler) if hasattr(ast, 'unparse') else '')
                    returns_silently = self._returns_without_propagate(handler.body)

                    if has_critical_keywords and returns_silently:
                        self.validator.issues.append(LogicIssue(
                            severity='critical',
                            line=handler.lineno,
                            column=handler.col_offset,
                            issue_type='critical_error_not_propagated',
                            message=f"Critical error (GPU/OOM/CUDA) caught but not re-raised at line {handler.lineno}",
                            suggestion="Re-raise critical errors with 'raise' statement"
                        ))

                self.generic_visit(node)

            def _has_critical_error_keywords(self, body: List[ast.stmt], handler_str: str) -> bool:
                """Check for critical error keywords in conditionals"""
                critical_keywords = ['cuda', 'gpu', 'oom', 'memory', 'fatal']

                for stmt in body:
                    if isinstance(stmt, ast.If):
                        # Check if condition checks for critical errors
                        test_str = ast.unparse(stmt.test) if hasattr(ast, 'unparse') else str(stmt.test)
                        if any(kw in test_str.lower() for kw in critical_keywords):
                            # Check if this if block returns without raising
                            if self._if_block_returns_without_raise(stmt):
                                return True

                return False

            def _if_block_returns_without_raise(self, if_stmt: ast.If) -> bool:
                """Check if an if block returns without raising"""
                has_return = False
                has_raise = False

                for stmt in if_stmt.body:
                    if isinstance(stmt, ast.Return):
                        has_return = True
                    if isinstance(stmt, ast.Raise):
                        has_raise = True

                return has_return and not has_raise

            def _returns_without_propagate(self, body: List[ast.stmt]) -> bool:
                """Check if handler returns without re-raising"""
                # This is now used in conjunction with _has_critical_error_keywords
                # which checks inside if blocks
                return True

        visitor = ErrorPropagationVisitor(self)
        visitor.visit(tree)

    def _check_ambiguous_errors(self, tree: ast.AST, code: str):
        """Check for ambiguous error messages"""

        class AmbiguousErrorVisitor(ast.NodeVisitor):
            def __init__(self, validator):
                self.validator = validator

            def visit_Call(self, node):
                # Check logger calls
                if isinstance(node.func, ast.Attribute):
                    if node.func.attr in ('error', 'warning', 'critical'):
                        # Check if message is too generic
                        if node.args:
                            msg_node = node.args[0]
                            if isinstance(msg_node, ast.Constant):
                                msg = str(msg_node.value)
                                if self._is_ambiguous(msg):
                                    self.validator.issues.append(LogicIssue(
                                        severity='info',
                                        line=node.lineno,
                                        column=node.col_offset,
                                        issue_type='ambiguous_error',
                                        message=f"Ambiguous error message at line {node.lineno}: '{msg}'",
                                        suggestion="Include 'what happened', 'why it matters', and 'how to fix'"
                                    ))

                self.generic_visit(node)

            def _is_ambiguous(self, msg: str) -> bool:
                """Check if error message is too generic"""
                ambiguous_patterns = [
                    r'^error$',
                    r'^failed$',
                    r'^exception$',
                    r'^something went wrong$',
                ]

                msg_lower = msg.lower().strip()
                return any(re.match(pattern, msg_lower) for pattern in ambiguous_patterns)

        visitor = AmbiguousErrorVisitor(self)
        visitor.visit(tree)

    def _generate_summary(self) -> str:
        """Generate a summary of findings"""
        if not self.issues:
            return "Code passes all logical consistency checks"

        critical = len([i for i in self.issues if i.severity == 'critical'])
        warnings = len([i for i in self.issues if i.severity == 'warning'])
        info = len([i for i in self.issues if i.severity == 'info'])

        summary_parts = []
        if critical > 0:
            summary_parts.append(f"{critical} critical issue(s)")
        if warnings > 0:
            summary_parts.append(f"{warnings} warning(s)")
        if info > 0:
            summary_parts.append(f"{info} info item(s)")

        return f"Found {', '.join(summary_parts)}"


# Convenience function for direct use
def analyze_code_logic(code: str, file_path: str = "<unknown>") -> Dict:
    """Analyze code for logical consistency issues"""
    validator = LogicValidator()
    return validator.analyze_code_logic(code, file_path)


if __name__ == "__main__":
    # Test the validator
    test_code = """
try:
    results = search_engine.search(concept)
except Exception as e:
    return []
"""

    result = analyze_code_logic(test_code, "test.py")
    print(f"Is buggy: {result['is_buggy']}")
    print(f"Summary: {result['logical_statement']}")
    for issue in result['issues']:
        print(f"  [{issue.severity}] {issue.message}")
