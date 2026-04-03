"""Abstract base parser and shared tree-sitter utilities."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from pathlib import Path

from tree_sitter import Language, Node, Parser, Tree

from ..models import FileNode, Language as Lang

logger = logging.getLogger("cartographer.parser")

# Per-file parse timeout in seconds
PARSE_TIMEOUT_SECONDS = 10


class BaseParser(ABC):
    """Abstract base for language-specific parsers."""

    def __init__(self, language: Language) -> None:
        self._parser = Parser(language)

    def parse_file(self, path: Path, language: Lang) -> FileNode | None:
        """Parse a source file and extract symbols + imports.

        Returns None if the file cannot be read or parsed.
        """
        try:
            source = path.read_bytes()
        except OSError as exc:
            logger.warning("Cannot read %s: %s", path, exc)
            return None

        # Try UTF-8 first, fall back to latin-1
        try:
            text = source.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = source.decode("latin-1")
                logger.info("Non-UTF-8 file, decoded as latin-1: %s", path)
            except UnicodeDecodeError:
                logger.warning("Cannot decode %s, skipping", path)
                return None

        tree = self._parser.parse(source)
        line_count = text.count("\n") + 1

        node = FileNode(
            path=path,
            language=language,
            lines=line_count,
        )

        # Count parse errors
        node.parse_errors = _count_errors(tree.root_node)
        if node.parse_errors > 0:
            logger.info("%d parse errors in %s", node.parse_errors, path)

        self._extract(tree, text, node)
        return node

    @abstractmethod
    def _extract(self, tree: Tree, source: str, node: FileNode) -> None:
        """Extract symbols and imports from the parse tree into node."""
        ...


def _count_errors(root: Node) -> int:
    """Count ERROR and MISSING nodes in a tree-sitter parse tree."""
    count = 0
    cursor = root.walk()
    reached_root = False
    while not reached_root:
        if cursor.node.type in ("ERROR", "MISSING"):
            count += 1
        if cursor.goto_first_child():
            continue
        if cursor.goto_next_sibling():
            continue
        retracing = True
        while retracing:
            if not cursor.goto_parent():
                retracing = False
                reached_root = True
            elif cursor.goto_next_sibling():
                retracing = False
    return count


def node_text(node: Node, source: str) -> str:
    """Extract the text of a tree-sitter node.

    Uses the node's own ``text`` property (raw bytes) to avoid misalignment
    when *source* contains multi-byte UTF-8 characters and tree-sitter
    reports byte offsets rather than character offsets.
    """
    if node.text is not None:
        try:
            return node.text.decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            pass
    # Fallback: encode source to bytes so byte-offset slicing is correct.
    src_bytes = source.encode("utf-8")
    return src_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def find_children(node: Node, type_name: str) -> list[Node]:
    """Find all direct children of a given type."""
    return [c for c in node.children if c.type == type_name]


def find_first_child(node: Node, type_name: str) -> Node | None:
    """Find the first direct child of a given type."""
    for c in node.children:
        if c.type == type_name:
            return c
    return None
