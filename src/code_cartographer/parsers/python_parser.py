"""Python source parser using tree-sitter."""

from __future__ import annotations

import logging

import tree_sitter_python
from tree_sitter import Language, Tree

from ..models import (
    FileNode,
    ImportInfo,
    Language as Lang,
    Symbol,
    SymbolKind,
    Visibility,
)
from .base import BaseParser, find_children, find_first_child, node_text

logger = logging.getLogger("cartographer.parser.python")

_LANGUAGE = Language(tree_sitter_python.language())


class PythonParser(BaseParser):
    def __init__(self) -> None:
        super().__init__(_LANGUAGE)

    def _extract(self, tree: Tree, source: str, node: FileNode) -> None:
        root = tree.root_node
        for child in root.children:
            if child.type == "import_statement":
                self._parse_import(child, source, node)
            elif child.type == "import_from_statement":
                self._parse_from_import(child, source, node)
            elif child.type == "class_definition":
                self._parse_class(child, source, node)
            elif child.type == "function_definition":
                self._parse_function(child, source, node)
            elif child.type == "decorated_definition":
                self._parse_decorated(child, source, node)
            elif child.type == "expression_statement":
                self._parse_exports(child, source, node)
            elif child.type == "try_statement":
                self._parse_try_imports(child, source, node)

    def _parse_import(self, stmt: "Node", source: str, node: FileNode) -> None:
        """Parse `import x` or `import x as y`."""
        for child in stmt.children:
            if child.type == "dotted_name":
                module = node_text(child, source)
                node.imports.append(ImportInfo(
                    module=module, line=child.start_point[0] + 1,
                ))
            elif child.type == "aliased_import":
                name_node = find_first_child(child, "dotted_name")
                alias_node = find_first_child(child, "identifier")
                if name_node:
                    module = node_text(name_node, source)
                    alias = node_text(alias_node, source) if alias_node else None
                    node.imports.append(ImportInfo(
                        module=module, alias=alias,
                        line=child.start_point[0] + 1,
                    ))

    def _parse_from_import(self, stmt: "Node", source: str, node: FileNode) -> None:
        """Parse `from x import y, z` or `from . import x`."""
        module = ""
        names: list[str] = []
        is_relative = False
        past_import_keyword = False

        for child in stmt.children:
            if child.type == "import":
                past_import_keyword = True
                continue

            if not past_import_keyword:
                # Before "import" keyword — this is the module path
                if child.type == "dotted_name":
                    module = node_text(child, source)
                elif child.type == "relative_import":
                    is_relative = True
                    prefix_node = find_first_child(child, "import_prefix")
                    dotted = find_first_child(child, "dotted_name")
                    prefix = node_text(prefix_node, source) if prefix_node else ""
                    dotted_text = node_text(dotted, source) if dotted else ""
                    module = prefix + dotted_text
            else:
                # After "import" keyword — these are imported names
                if child.type == "dotted_name":
                    names.append(node_text(child, source))
                elif child.type == "identifier":
                    names.append(node_text(child, source))
                elif child.type == "aliased_import":
                    name_node = child.children[0] if child.children else None
                    if name_node:
                        names.append(node_text(name_node, source))
                elif child.type == "wildcard_import":
                    names.append("*")

        node.imports.append(ImportInfo(
            module=module,
            names=names,
            is_relative=is_relative,
            line=stmt.start_point[0] + 1,
        ))

    def _parse_class(
        self, stmt: "Node", source: str, node: FileNode,
        decorators: list[str] | None = None,
    ) -> None:
        """Parse a class definition."""
        name_node = find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        bases: list[str] = []

        arg_list = find_first_child(stmt, "argument_list")
        if arg_list:
            for child in arg_list.children:
                if child.type in ("identifier", "attribute"):
                    bases.append(node_text(child, source))

        visibility = Visibility.PRIVATE if name.startswith("_") else Visibility.PUBLIC

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.CLASS,
            visibility=visibility,
            line=stmt.start_point[0] + 1,
            bases=bases,
            decorators=decorators or [],
        ))

        # Extract methods
        body = find_first_child(stmt, "block")
        if body:
            for child in body.children:
                if child.type == "function_definition":
                    self._parse_method(child, source, node, name)
                elif child.type == "decorated_definition":
                    func = find_first_child(child, "function_definition")
                    if func:
                        decos = self._extract_decorators(child, source)
                        self._parse_method(func, source, node, name, decos)

    def _parse_method(
        self, stmt: "Node", source: str, node: FileNode,
        class_name: str, decorators: list[str] | None = None,
    ) -> None:
        """Parse a method within a class."""
        name_node = find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        params = self._extract_params(stmt, source)
        return_type = self._extract_return_type(stmt, source)

        if name.startswith("__") and not name.endswith("__"):
            vis = Visibility.PRIVATE
        elif name.startswith("_"):
            vis = Visibility.PROTECTED
        else:
            vis = Visibility.PUBLIC

        node.symbols.append(Symbol(
            name=f"{class_name}.{name}",
            kind=SymbolKind.METHOD,
            visibility=vis,
            line=stmt.start_point[0] + 1,
            params=params,
            return_type=return_type,
            decorators=decorators or [],
        ))

    def _parse_function(
        self, stmt: "Node", source: str, node: FileNode,
        decorators: list[str] | None = None,
    ) -> None:
        """Parse a top-level function definition."""
        name_node = find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        params = self._extract_params(stmt, source)
        return_type = self._extract_return_type(stmt, source)
        visibility = Visibility.PRIVATE if name.startswith("_") else Visibility.PUBLIC

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.FUNCTION,
            visibility=visibility,
            line=stmt.start_point[0] + 1,
            params=params,
            return_type=return_type,
            decorators=decorators or [],
        ))

    def _parse_decorated(self, stmt: "Node", source: str, node: FileNode) -> None:
        """Parse a decorated class or function."""
        decorators = self._extract_decorators(stmt, source)
        func = find_first_child(stmt, "function_definition")
        cls = find_first_child(stmt, "class_definition")
        if func:
            self._parse_function(func, source, node, decorators)
        elif cls:
            self._parse_class(cls, source, node, decorators)

    def _extract_decorators(self, stmt: "Node", source: str) -> list[str]:
        """Extract decorator names from a decorated definition."""
        decorators: list[str] = []
        for child in stmt.children:
            if child.type == "decorator":
                # Skip the @ symbol
                for sub in child.children:
                    if sub.type in ("identifier", "attribute", "call"):
                        text = node_text(sub, source)
                        # For calls like @app.route("/"), just get the name part
                        if sub.type == "call":
                            fn = find_first_child(sub, "identifier") or find_first_child(sub, "attribute")
                            if fn:
                                text = node_text(fn, source)
                        decorators.append(text)
                        break
        return decorators

    def _extract_params(self, func_node: "Node", source: str) -> list[str]:
        """Extract parameter names from a function definition."""
        params: list[str] = []
        param_list = find_first_child(func_node, "parameters")
        if not param_list:
            return params
        for child in param_list.children:
            if child.type == "identifier":
                name = node_text(child, source)
                if name != "self" and name != "cls":
                    params.append(name)
            elif child.type in ("typed_parameter", "default_parameter", "typed_default_parameter"):
                name_node = find_first_child(child, "identifier")
                if name_node:
                    name = node_text(name_node, source)
                    if name != "self" and name != "cls":
                        params.append(name)
        return params

    def _extract_return_type(self, func_node: "Node", source: str) -> str | None:
        """Extract return type annotation from a function definition."""
        ret = find_first_child(func_node, "type")
        if ret:
            return node_text(ret, source)
        return None

    def _parse_exports(self, stmt: "Node", source: str, node: FileNode) -> None:
        """Parse __all__ assignment for exports."""
        for child in stmt.children:
            if child.type == "assignment":
                left = find_first_child(child, "identifier")
                if left and node_text(left, source) == "__all__":
                    right = find_first_child(child, "list")
                    if right:
                        for el in right.children:
                            if el.type == "string":
                                text = node_text(el, source).strip("'\"")
                                node.exports.append(text)

    def _parse_try_imports(self, stmt: "Node", source: str, node: FileNode) -> None:
        """Extract imports from try/except blocks."""
        for child in stmt.children:
            if child.type == "block":
                for sub in child.children:
                    if sub.type == "import_statement":
                        self._parse_import(sub, source, node)
                    elif sub.type == "import_from_statement":
                        self._parse_from_import(sub, source, node)
            elif child.type == "except_clause":
                block = find_first_child(child, "block")
                if block:
                    for sub in block.children:
                        if sub.type == "import_statement":
                            self._parse_import(sub, source, node)
                        elif sub.type == "import_from_statement":
                            self._parse_from_import(sub, source, node)
