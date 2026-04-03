"""C++ source parser using tree-sitter."""

from __future__ import annotations

import logging

import tree_sitter_cpp
from tree_sitter import Language, Tree

from ..models import (
    FileNode,
    ImportInfo,
    Language as Lang,
    Symbol,
    SymbolKind,
    Visibility,
)
from .base import BaseParser, find_first_child, node_text

logger = logging.getLogger("cartographer.parser.cpp")

_LANGUAGE = Language(tree_sitter_cpp.language())


class CppParser(BaseParser):
    def __init__(self) -> None:
        super().__init__(_LANGUAGE)

    def _extract(self, tree: Tree, source: str, node: FileNode) -> None:
        self._walk(tree.root_node, source, node, namespace_prefix="")

    def _walk(self, root, source: str, node: FileNode, namespace_prefix: str) -> None:
        for child in root.children:
            t = child.type
            if t == "preproc_include":
                self._parse_include(child, source, node)
            elif t == "namespace_definition":
                self._parse_namespace(child, source, node, namespace_prefix)
            elif t == "class_specifier":
                self._parse_class(child, source, node, namespace_prefix)
            elif t == "struct_specifier":
                self._parse_struct(child, source, node, namespace_prefix)
            elif t == "function_definition":
                self._parse_function(child, source, node, namespace_prefix)
            elif t == "declaration":
                self._parse_declaration(child, source, node, namespace_prefix)
            elif t == "enum_specifier":
                self._parse_enum(child, source, node, namespace_prefix)
            elif t == "template_declaration":
                self._parse_template(child, source, node, namespace_prefix)

    def _parse_include(self, stmt, source: str, node: FileNode) -> None:
        """Parse #include directives."""
        for child in stmt.children:
            if child.type == "string_literal":
                # #include "local.h" — project-local
                path = node_text(child, source).strip('"')
                node.imports.append(ImportInfo(
                    module=path,
                    is_relative=True,
                    line=stmt.start_point[0] + 1,
                ))
            elif child.type == "system_lib_string":
                # #include <system> — external
                path = node_text(child, source).strip("<>")
                node.imports.append(ImportInfo(
                    module=path,
                    is_relative=False,
                    line=stmt.start_point[0] + 1,
                ))

    def _parse_namespace(self, stmt, source: str, node: FileNode, prefix: str) -> None:
        """Parse namespace definition and recurse into body."""
        name_node = find_first_child(stmt, "namespace_identifier") or find_first_child(stmt, "identifier")
        ns_name = node_text(name_node, source) if name_node else ""

        full_name = f"{prefix}{ns_name}::" if ns_name else prefix

        body = find_first_child(stmt, "declaration_list")
        if body:
            self._walk(body, source, node, full_name)

    def _parse_class(self, stmt, source: str, node: FileNode, prefix: str) -> None:
        """Parse class specifier."""
        name_node = find_first_child(stmt, "type_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        full_name = f"{prefix}{name}"
        bases = self._extract_bases(stmt, source)

        node.symbols.append(Symbol(
            name=full_name,
            kind=SymbolKind.CLASS,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
            bases=bases,
        ))

        # Extract methods from class body
        body = find_first_child(stmt, "field_declaration_list")
        if body:
            self._extract_class_members(body, source, node, full_name)

    def _parse_struct(self, stmt, source: str, node: FileNode, prefix: str) -> None:
        """Parse struct specifier."""
        name_node = find_first_child(stmt, "type_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        full_name = f"{prefix}{name}"

        node.symbols.append(Symbol(
            name=full_name,
            kind=SymbolKind.STRUCT,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
        ))

    def _parse_enum(self, stmt, source: str, node: FileNode, prefix: str) -> None:
        """Parse enum specifier."""
        name_node = find_first_child(stmt, "type_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        full_name = f"{prefix}{name}"

        node.symbols.append(Symbol(
            name=full_name,
            kind=SymbolKind.ENUM,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
        ))

    def _parse_function(self, stmt, source: str, node: FileNode, prefix: str) -> None:
        """Parse function definition."""
        # The function declarator contains the name
        declarator = find_first_child(stmt, "function_declarator")
        if not declarator:
            return

        name_node = find_first_child(declarator, "identifier") or \
            find_first_child(declarator, "field_identifier") or \
            find_first_child(declarator, "qualified_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        full_name = f"{prefix}{name}" if prefix and "::" not in name else name
        params = self._extract_func_params(declarator, source)

        node.symbols.append(Symbol(
            name=full_name,
            kind=SymbolKind.FUNCTION,
            visibility=Visibility.PUBLIC,
            line=stmt.start_point[0] + 1,
            params=params,
        ))

    def _parse_declaration(self, stmt, source: str, node: FileNode, prefix: str) -> None:
        """Parse declarations — function declarations, variable declarations, etc."""
        # Check for function declarations (prototypes)
        for child in stmt.children:
            if child.type == "function_declarator":
                name_node = find_first_child(child, "identifier") or \
                    find_first_child(child, "field_identifier")
                if name_node:
                    name = node_text(name_node, source)
                    full_name = f"{prefix}{name}"
                    params = self._extract_func_params(child, source)
                    node.symbols.append(Symbol(
                        name=full_name,
                        kind=SymbolKind.FUNCTION,
                        visibility=Visibility.PUBLIC,
                        line=stmt.start_point[0] + 1,
                        params=params,
                    ))
                return

            # Nested class/struct in declaration
            if child.type == "class_specifier":
                self._parse_class(child, source, node, prefix)
                return
            if child.type == "struct_specifier":
                self._parse_struct(child, source, node, prefix)
                return
            if child.type == "enum_specifier":
                self._parse_enum(child, source, node, prefix)
                return

    def _parse_template(self, stmt, source: str, node: FileNode, prefix: str) -> None:
        """Parse template declarations — recurse into the inner declaration."""
        for child in stmt.children:
            if child.type == "class_specifier":
                self._parse_class(child, source, node, prefix)
            elif child.type == "struct_specifier":
                self._parse_struct(child, source, node, prefix)
            elif child.type == "function_definition":
                self._parse_function(child, source, node, prefix)
            elif child.type == "declaration":
                self._parse_declaration(child, source, node, prefix)

    def _extract_bases(self, stmt, source: str) -> list[str]:
        """Extract base classes from a class specifier."""
        bases: list[str] = []
        base_list = find_first_child(stmt, "base_class_clause")
        if base_list:
            for child in base_list.children:
                if child.type == "type_identifier":
                    bases.append(node_text(child, source))
                elif child.type == "qualified_identifier":
                    bases.append(node_text(child, source))
        return bases

    def _extract_class_members(
        self, body, source: str, node: FileNode, class_name: str,
    ) -> None:
        """Extract methods and fields from a class body."""
        current_visibility = Visibility.PRIVATE  # C++ class default

        for child in body.children:
            if child.type == "access_specifier":
                spec = node_text(child, source).rstrip(":")
                if "public" in spec:
                    current_visibility = Visibility.PUBLIC
                elif "protected" in spec:
                    current_visibility = Visibility.PROTECTED
                elif "private" in spec:
                    current_visibility = Visibility.PRIVATE
            elif child.type == "function_definition":
                self._extract_member_function(child, source, node, class_name, current_visibility)
            elif child.type in ("declaration", "field_declaration"):
                # Could be a method declaration or field
                for sub in child.children:
                    if sub.type == "function_declarator":
                        name_node = find_first_child(sub, "field_identifier") or \
                            find_first_child(sub, "identifier")
                        if name_node:
                            name = node_text(name_node, source)
                            params = self._extract_func_params(sub, source)
                            node.symbols.append(Symbol(
                                name=f"{class_name}.{name}",
                                kind=SymbolKind.METHOD,
                                visibility=current_visibility,
                                line=child.start_point[0] + 1,
                                params=params,
                            ))
                        break

    def _extract_member_function(
        self, stmt, source: str, node: FileNode,
        class_name: str, visibility: Visibility,
    ) -> None:
        """Extract a method from a class body function_definition."""
        declarator = find_first_child(stmt, "function_declarator")
        if not declarator:
            return
        name_node = find_first_child(declarator, "field_identifier") or \
            find_first_child(declarator, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        params = self._extract_func_params(declarator, source)

        node.symbols.append(Symbol(
            name=f"{class_name}.{name}",
            kind=SymbolKind.METHOD,
            visibility=visibility,
            line=stmt.start_point[0] + 1,
            params=params,
        ))

    def _extract_func_params(self, declarator, source: str) -> list[str]:
        """Extract parameter names from a function declarator."""
        params: list[str] = []
        param_list = find_first_child(declarator, "parameter_list")
        if not param_list:
            return params
        for child in param_list.children:
            if child.type == "parameter_declaration":
                # Last identifier or declarator is the name
                name = None
                for sub in child.children:
                    if sub.type == "identifier":
                        name = node_text(sub, source)
                    elif sub.type == "reference_declarator":
                        inner = find_first_child(sub, "identifier")
                        if inner:
                            name = node_text(inner, source)
                    elif sub.type == "pointer_declarator":
                        inner = find_first_child(sub, "identifier")
                        if inner:
                            name = node_text(inner, source)
                if name:
                    params.append(name)
        return params
