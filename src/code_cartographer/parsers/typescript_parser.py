"""TypeScript/JavaScript/TSX source parser using tree-sitter."""

from __future__ import annotations

import logging

import tree_sitter_typescript
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

logger = logging.getLogger("cartographer.parser.typescript")

_TS_LANGUAGE = Language(tree_sitter_typescript.language_typescript())
_TSX_LANGUAGE = Language(tree_sitter_typescript.language_tsx())


class TypeScriptParser(BaseParser):
    def __init__(self, tsx: bool = False) -> None:
        super().__init__(_TSX_LANGUAGE if tsx else _TS_LANGUAGE)
        self._tsx = tsx

    def _extract(self, tree: Tree, source: str, node: FileNode) -> None:
        self._walk_statements(tree.root_node, source, node)

    def _walk_statements(self, root, source: str, node: FileNode) -> None:
        for child in root.children:
            t = child.type
            if t == "import_statement":
                self._parse_import(child, source, node)
            elif t == "export_statement":
                self._parse_export(child, source, node)
            elif t in ("class_declaration", "abstract_class_declaration"):
                self._parse_class(child, source, node)
            elif t in ("function_declaration", "generator_function_declaration"):
                self._parse_function(child, source, node)
            elif t == "interface_declaration":
                self._parse_interface(child, source, node)
            elif t == "type_alias_declaration":
                self._parse_type_alias(child, source, node)
            elif t in ("lexical_declaration", "variable_declaration"):
                self._parse_variable_decl(child, source, node)

    def _parse_import(self, stmt, source: str, node: FileNode) -> None:
        """Parse import statements."""
        names: list[str] = []
        module = ""
        is_type_only = False
        alias = None

        for child in stmt.children:
            if child.type == "type" or (child.type == "identifier" and node_text(child, source) == "type"):
                # `import type { X } from 'y'`
                if child == stmt.children[1]:  # position check for `import type`
                    is_type_only = True
            elif child.type == "import_clause":
                self._extract_import_clause(child, source, names)
                # Check for default import alias
                default = find_first_child(child, "identifier")
                if default and not names:
                    alias = node_text(default, source)
                    names.append(alias)
            elif child.type == "string":
                module = node_text(child, source).strip("'\"")

        is_relative = module.startswith(".")

        node.imports.append(ImportInfo(
            module=module,
            names=names,
            alias=alias,
            is_type_only=is_type_only,
            is_relative=is_relative,
            line=stmt.start_point[0] + 1,
        ))

    def _extract_import_clause(self, clause, source: str, names: list[str]) -> None:
        """Extract named imports from an import clause."""
        for child in clause.children:
            if child.type == "named_imports":
                for spec in child.children:
                    if spec.type == "import_specifier":
                        name_node = spec.children[0] if spec.children else None
                        if name_node:
                            names.append(node_text(name_node, source))
            elif child.type == "namespace_import":
                # import * as X
                alias_node = find_first_child(child, "identifier")
                if alias_node:
                    names.append("* as " + node_text(alias_node, source))
            elif child.type == "identifier":
                # Default import
                name = node_text(child, source)
                if name not in names:
                    names.append(name)

    def _parse_export(self, stmt, source: str, node: FileNode) -> None:
        """Parse export statements, extracting both exports and nested declarations."""
        is_default = False
        for child in stmt.children:
            if child.type == "default":
                is_default = True
            elif child.type in ("class_declaration", "abstract_class_declaration"):
                self._parse_class(child, source, node, exported=True)
            elif child.type in ("function_declaration", "generator_function_declaration"):
                self._parse_function(child, source, node, exported=True)
            elif child.type == "interface_declaration":
                self._parse_interface(child, source, node, exported=True)
            elif child.type == "type_alias_declaration":
                self._parse_type_alias(child, source, node, exported=True)
            elif child.type in ("lexical_declaration", "variable_declaration"):
                self._parse_variable_decl(child, source, node, exported=True)
            elif child.type == "export_clause":
                for spec in child.children:
                    if spec.type == "export_specifier":
                        name_node = spec.children[0] if spec.children else None
                        if name_node:
                            node.exports.append(node_text(name_node, source))

        # `export default X`
        if is_default:
            node.exports.append("default")

    def _parse_class(
        self, stmt, source: str, node: FileNode,
        exported: bool = False,
    ) -> None:
        """Parse class declaration."""
        name_node = find_first_child(stmt, "type_identifier") or find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        bases: list[str] = []

        # extends clause
        heritage = find_first_child(stmt, "class_heritage")
        if heritage:
            for child in heritage.children:
                if child.type == "extends_clause":
                    for sub in child.children:
                        if sub.type in ("type_identifier", "identifier", "generic_type"):
                            bases.append(node_text(sub, source))
                elif child.type == "implements_clause":
                    for sub in child.children:
                        if sub.type in ("type_identifier", "identifier", "generic_type"):
                            bases.append(node_text(sub, source))

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.CLASS,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
            bases=bases,
        ))
        if exported:
            node.exports.append(name)

        # Extract methods
        body = find_first_child(stmt, "class_body")
        if body:
            for child in body.children:
                if child.type in ("method_definition", "public_field_definition"):
                    self._parse_method(child, source, node, name)

    def _parse_method(self, stmt, source: str, node: FileNode, class_name: str) -> None:
        """Parse a method within a class."""
        name_node = find_first_child(stmt, "property_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        params = self._extract_params(stmt, source)

        # Check visibility modifiers
        vis = Visibility.PUBLIC
        for child in stmt.children:
            if child.type == "accessibility_modifier":
                mod = node_text(child, source)
                if mod == "private":
                    vis = Visibility.PRIVATE
                elif mod == "protected":
                    vis = Visibility.PROTECTED

        node.symbols.append(Symbol(
            name=f"{class_name}.{name}",
            kind=SymbolKind.METHOD,
            visibility=vis,
            line=stmt.start_point[0] + 1,
            params=params,
        ))

    def _parse_function(
        self, stmt, source: str, node: FileNode,
        exported: bool = False,
    ) -> None:
        """Parse function declaration."""
        name_node = find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        params = self._extract_params(stmt, source)

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.FUNCTION,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
            params=params,
        ))
        if exported:
            node.exports.append(name)

    def _parse_interface(
        self, stmt, source: str, node: FileNode,
        exported: bool = False,
    ) -> None:
        """Parse interface declaration."""
        name_node = find_first_child(stmt, "type_identifier") or find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        bases: list[str] = []

        extends = find_first_child(stmt, "extends_type_clause")
        if extends:
            for child in extends.children:
                if child.type in ("type_identifier", "generic_type"):
                    bases.append(node_text(child, source))

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.INTERFACE,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
            bases=bases,
        ))
        if exported:
            node.exports.append(name)

    def _parse_type_alias(
        self, stmt, source: str, node: FileNode,
        exported: bool = False,
    ) -> None:
        """Parse type alias declaration."""
        name_node = find_first_child(stmt, "type_identifier") or find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.TYPE_ALIAS,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
        ))
        if exported:
            node.exports.append(name)

    def _parse_variable_decl(
        self, stmt, source: str, node: FileNode,
        exported: bool = False,
    ) -> None:
        """Parse const/let/var declarations for exported constants."""
        for child in stmt.children:
            if child.type == "variable_declarator":
                name_node = find_first_child(child, "identifier")
                if name_node:
                    name = node_text(name_node, source)
                    node.symbols.append(Symbol(
                        name=name,
                        kind=SymbolKind.CONSTANT,
                        visibility=Visibility.PUBLIC,
                        line=child.start_point[0] + 1,
                    ))
                    if exported:
                        node.exports.append(name)

    def _extract_params(self, func_node, source: str) -> list[str]:
        """Extract parameter names from a function/method."""
        params: list[str] = []
        param_list = find_first_child(func_node, "formal_parameters")
        if not param_list:
            return params
        for child in param_list.children:
            if child.type == "required_parameter" or child.type == "optional_parameter":
                # Could have accessibility modifier, pattern, etc.
                for sub in child.children:
                    if sub.type == "identifier":
                        params.append(node_text(sub, source))
                        break
            elif child.type == "identifier":
                params.append(node_text(child, source))
        return params
