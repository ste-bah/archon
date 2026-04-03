"""Rust source parser using tree-sitter."""

from __future__ import annotations

import logging

import tree_sitter_rust
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

logger = logging.getLogger("cartographer.parser.rust")

_LANGUAGE = Language(tree_sitter_rust.language())


class RustParser(BaseParser):
    def __init__(self) -> None:
        super().__init__(_LANGUAGE)

    def _extract(self, tree: Tree, source: str, node: FileNode) -> None:
        self._walk(tree.root_node, source, node)

    def _walk(self, root, source: str, node: FileNode) -> None:
        pending_attrs: list = []
        for child in root.children:
            t = child.type
            if t == "attribute_item":
                pending_attrs.append(child)
                continue

            attrs = pending_attrs
            pending_attrs = []

            if t == "use_declaration":
                self._parse_use(child, source, node)
            elif t == "mod_item":
                self._parse_mod(child, source, node)
            elif t == "extern_crate_declaration":
                self._parse_extern_crate(child, source, node)
            elif t == "function_item":
                self._parse_function(child, source, node)
            elif t == "struct_item":
                self._parse_struct(child, source, node, attrs)
            elif t == "enum_item":
                self._parse_enum(child, source, node, attrs)
            elif t == "trait_item":
                self._parse_trait(child, source, node)
            elif t == "impl_item":
                self._parse_impl(child, source, node)
            elif t == "const_item" or t == "static_item":
                self._parse_const(child, source, node)

    def _parse_use(self, stmt, source: str, node: FileNode) -> None:
        """Parse `use` declarations."""
        # Find the use path
        for child in stmt.children:
            if child.type in ("use_as_clause", "use_list", "use_wildcard",
                              "scoped_identifier", "identifier", "scoped_use_list"):
                path = node_text(child, source)
                # Extract the module path (before ::{ or ::*)
                module = path.split("::{")[0].split("::*")[0]

                names: list[str] = []
                if "::{" in path:
                    inner = path.split("::{")[1].rstrip("}")
                    names = [n.strip() for n in inner.split(",") if n.strip()]
                elif "::*" in path:
                    names = ["*"]
                elif "::" in path:
                    parts = path.split("::")
                    names = [parts[-1]]
                    module = "::".join(parts[:-1])

                is_relative = module.startswith("self") or module.startswith("super") or module.startswith("crate")

                node.imports.append(ImportInfo(
                    module=module,
                    names=names,
                    is_relative=is_relative,
                    line=stmt.start_point[0] + 1,
                ))
                break

    def _parse_mod(self, stmt, source: str, node: FileNode) -> None:
        """Parse `mod` declarations (file-level module references)."""
        name_node = find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)

        # Check if this is a `mod foo;` (file reference) or `mod foo { ... }` (inline)
        has_block = find_first_child(stmt, "declaration_list") is not None
        if not has_block:
            # File reference — treat as an import of a module file
            node.imports.append(ImportInfo(
                module=name,
                is_relative=True,
                line=stmt.start_point[0] + 1,
            ))

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.MODULE,
            visibility=self._get_visibility(stmt, source),
            line=stmt.start_point[0] + 1,
        ))

    def _parse_extern_crate(self, stmt, source: str, node: FileNode) -> None:
        """Parse `extern crate` declarations."""
        name_node = find_first_child(stmt, "identifier")
        if name_node:
            name = node_text(name_node, source)
            node.imports.append(ImportInfo(
                module=name,
                line=stmt.start_point[0] + 1,
            ))

    def _parse_function(self, stmt, source: str, node: FileNode) -> None:
        """Parse function item."""
        name_node = find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        params = self._extract_params(stmt, source)
        ret = self._extract_return_type(stmt, source)

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.FUNCTION,
            visibility=self._get_visibility(stmt, source),
            line=stmt.start_point[0] + 1,
            params=params,
            return_type=ret,
        ))

    def _parse_struct(self, stmt, source: str, node: FileNode, attrs: list | None = None) -> None:
        """Parse struct item."""
        name_node = find_first_child(stmt, "type_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        decorators = self._extract_derives_from_attrs(attrs or [], source)

        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.STRUCT,
            visibility=self._get_visibility(stmt, source),
            line=stmt.start_point[0] + 1,
            decorators=decorators,
        ))

    def _parse_enum(self, stmt, source: str, node: FileNode, attrs: list | None = None) -> None:
        """Parse enum item."""
        name_node = find_first_child(stmt, "type_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        decorators = self._extract_derives_from_attrs(attrs or [], source)
        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.ENUM,
            visibility=self._get_visibility(stmt, source),
            line=stmt.start_point[0] + 1,
            decorators=decorators,
        ))

    def _parse_trait(self, stmt, source: str, node: FileNode) -> None:
        """Parse trait item."""
        name_node = find_first_child(stmt, "type_identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.TRAIT,
            visibility=self._get_visibility(stmt, source),
            line=stmt.start_point[0] + 1,
        ))

        # Extract trait methods
        body = find_first_child(stmt, "declaration_list")
        if body:
            for child in body.children:
                if child.type == "function_signature_item":
                    method_name = find_first_child(child, "identifier")
                    if method_name:
                        params = self._extract_params(child, source)
                        node.symbols.append(Symbol(
                            name=f"{name}.{node_text(method_name, source)}",
                            kind=SymbolKind.METHOD,
                            visibility=Visibility.PUBLIC,
                            line=child.start_point[0] + 1,
                            params=params,
                        ))

    def _parse_impl(self, stmt, source: str, node: FileNode) -> None:
        """Parse impl blocks — extract methods."""
        # Find the type being implemented
        type_name = None
        trait_name = None

        for child in stmt.children:
            if child.type == "type_identifier":
                if type_name is None:
                    type_name = node_text(child, source)
                else:
                    # `impl Trait for Type` — first is trait, second is type
                    trait_name = type_name
                    type_name = node_text(child, source)
            elif child.type == "generic_type":
                name = node_text(child, source).split("<")[0]
                if type_name is None:
                    type_name = name
                else:
                    trait_name = type_name
                    type_name = name

        if not type_name:
            return

        # Record implementation relationship
        if trait_name:
            node.symbols.append(Symbol(
                name=f"{type_name} impl {trait_name}",
                kind=SymbolKind.METHOD,  # use METHOD as placeholder for impl
                visibility=Visibility.PUBLIC,
                line=stmt.start_point[0] + 1,
                bases=[trait_name],
            ))

        # Extract methods
        body = find_first_child(stmt, "declaration_list")
        if body:
            for child in body.children:
                if child.type == "function_item":
                    method_name = find_first_child(child, "identifier")
                    if method_name:
                        name = node_text(method_name, source)
                        params = self._extract_params(child, source)
                        ret = self._extract_return_type(child, source)
                        vis = self._get_visibility(child, source)
                        node.symbols.append(Symbol(
                            name=f"{type_name}.{name}",
                            kind=SymbolKind.METHOD,
                            visibility=vis,
                            line=child.start_point[0] + 1,
                            params=params,
                            return_type=ret,
                        ))

    def _parse_const(self, stmt, source: str, node: FileNode) -> None:
        """Parse const/static items."""
        name_node = find_first_child(stmt, "identifier")
        if not name_node:
            return

        name = node_text(name_node, source)
        node.symbols.append(Symbol(
            name=name,
            kind=SymbolKind.CONSTANT,
            visibility=self._get_visibility(stmt, source),
            line=stmt.start_point[0] + 1,
        ))

    def _get_visibility(self, stmt, source: str) -> Visibility:
        """Get visibility from a statement node."""
        for child in stmt.children:
            if child.type == "visibility_modifier":
                text = node_text(child, source)
                if "crate" in text:
                    return Visibility.INTERNAL
                return Visibility.PUBLIC
        return Visibility.PRIVATE

    def _extract_params(self, func_node, source: str) -> list[str]:
        """Extract parameter names from a function."""
        params: list[str] = []
        param_list = find_first_child(func_node, "parameters")
        if not param_list:
            return params
        for child in param_list.children:
            if child.type == "parameter":
                # Pattern: name : type
                pat = find_first_child(child, "identifier")
                if pat:
                    name = node_text(pat, source)
                    if name != "self":
                        params.append(name)
            elif child.type == "self_parameter":
                pass  # skip self/&self/&mut self
        return params

    def _extract_return_type(self, func_node, source: str) -> str | None:
        """Extract return type from -> annotation."""
        for i, child in enumerate(func_node.children):
            if child.type == "->":
                # Next sibling is the return type
                if i + 1 < len(func_node.children):
                    return node_text(func_node.children[i + 1], source)
        return None

    def _extract_derives_from_attrs(self, attrs: list, source: str) -> list[str]:
        """Extract #[derive(...)] from preceding attribute_item nodes."""
        derives: list[str] = []
        for attr in attrs:
            text = node_text(attr, source)
            if "derive" in text:
                start = text.find("(")
                end = text.rfind(")")
                if start != -1 and end != -1:
                    inner = text[start + 1:end]
                    derives.extend(
                        d.strip() for d in inner.split(",") if d.strip()
                    )
        return derives
