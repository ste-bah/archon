"""Tests for workspace manifest loading and validation."""

import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from workspace.manifest import (
    DEFAULT_MAX_FILES,
    DEFAULT_MAX_MEMORY_MB,
    DEFAULT_REINDEX_INTERVAL,
    IndexConfig,
    ProjectEntry,
    WorkspaceManifest,
    load_workspace,
    validate_manifest,
    project_slug_from_cwd,
    get_add_dir_args,
    NAME_PATTERN,
)


@pytest.fixture
def valid_manifest_data():
    return {
        "version": "1.0",
        "projects": [
            {
                "name": "archon",
                "path": "/tmp/test-archon",
                "role": "primary",
            },
            {
                "name": "market-terminal",
                "path": "/tmp/test-market",
                "role": "secondary",
                "maxFiles": 3000,
                "excludes": ["*.pyc"],
            },
        ],
    }


@pytest.fixture
def valid_manifest_file(valid_manifest_data, tmp_path):
    path = tmp_path / "workspace.json"
    path.write_text(json.dumps(valid_manifest_data))
    return path


class TestNamePattern:
    def test_valid_names(self):
        for name in ["archon", "market-terminal", "tla", "my-project-v2", "a1"]:
            assert NAME_PATTERN.match(name), f"{name} should be valid"

    def test_invalid_names(self):
        for name in ["", "-starts-with-hyphen", "UPPERCASE", "has spaces", "a" * 64, "has_underscores"]:
            assert not NAME_PATTERN.match(name), f"{name} should be invalid"

    def test_single_char(self):
        assert NAME_PATTERN.match("a")


class TestValidateManifest:
    def test_valid_manifest(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert isinstance(manifest, WorkspaceManifest)
        assert manifest.version == "1.0"
        assert len(manifest.projects) == 2
        assert manifest.projects[0].name == "archon"
        assert manifest.projects[0].role == "primary"

    def test_missing_version(self, valid_manifest_data):
        del valid_manifest_data["version"]
        with pytest.raises(ValueError, match="version"):
            validate_manifest(valid_manifest_data)

    def test_wrong_version(self, valid_manifest_data):
        valid_manifest_data["version"] = "2.0"
        with pytest.raises(ValueError, match="version"):
            validate_manifest(valid_manifest_data)

    def test_empty_projects(self, valid_manifest_data):
        valid_manifest_data["projects"] = []
        with pytest.raises(ValueError, match="project"):
            validate_manifest(valid_manifest_data)

    def test_too_many_projects(self, valid_manifest_data):
        valid_manifest_data["projects"] = [
            {"name": f"proj-{i:02d}", "path": f"/tmp/p{i}", "role": "secondary"}
            for i in range(21)
        ]
        with pytest.raises(ValueError, match="20"):
            validate_manifest(valid_manifest_data)

    def test_duplicate_names(self, valid_manifest_data):
        valid_manifest_data["projects"][1]["name"] = "archon"
        with pytest.raises(ValueError, match="[Dd]uplicate"):
            validate_manifest(valid_manifest_data)

    def test_invalid_name_pattern(self, valid_manifest_data):
        valid_manifest_data["projects"][0]["name"] = "INVALID NAME"
        with pytest.raises(ValueError, match="name"):
            validate_manifest(valid_manifest_data)

    def test_relative_path_rejected(self, valid_manifest_data):
        valid_manifest_data["projects"][0]["path"] = "relative/path"
        with pytest.raises(ValueError, match="absolute"):
            validate_manifest(valid_manifest_data)

    def test_invalid_role(self, valid_manifest_data):
        valid_manifest_data["projects"][0]["role"] = "tertiary"
        with pytest.raises(ValueError, match="role"):
            validate_manifest(valid_manifest_data)

    def test_max_files_below_minimum(self, valid_manifest_data):
        valid_manifest_data["projects"][0]["maxFiles"] = 50
        with pytest.raises(ValueError, match="maxFiles"):
            validate_manifest(valid_manifest_data)

    def test_max_files_above_maximum(self, valid_manifest_data):
        valid_manifest_data["projects"][0]["maxFiles"] = 100000
        with pytest.raises(ValueError, match="maxFiles"):
            validate_manifest(valid_manifest_data)

    def test_default_max_files(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert manifest.projects[0].max_files == DEFAULT_MAX_FILES

    def test_custom_max_files(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert manifest.projects[1].max_files == 3000

    def test_default_index_config(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert manifest.index_config.max_memory_mb == DEFAULT_MAX_MEMORY_MB
        assert manifest.index_config.auto_reindex is True
        assert manifest.index_config.reindex_interval_minutes == DEFAULT_REINDEX_INTERVAL

    def test_custom_index_config(self, valid_manifest_data):
        valid_manifest_data["indexConfig"] = {
            "maxMemoryMB": 1000,
            "autoReindex": False,
            "reindexIntervalMinutes": 60,
        }
        manifest = validate_manifest(valid_manifest_data)
        assert manifest.index_config.max_memory_mb == 1000
        assert manifest.index_config.auto_reindex is False
        assert manifest.index_config.reindex_interval_minutes == 60

    def test_missing_path_warns_not_errors(self, valid_manifest_data):
        valid_manifest_data["projects"][0]["path"] = "/nonexistent/path/12345"
        # Should NOT raise — missing paths are warnings, not errors
        manifest = validate_manifest(valid_manifest_data)
        assert manifest.projects[0].path == "/nonexistent/path/12345"

    def test_excludes_default_empty(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert manifest.projects[0].excludes == []

    def test_excludes_custom(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert manifest.projects[1].excludes == ["*.pyc"]


class TestLoadWorkspace:
    def test_load_valid_file(self, valid_manifest_file):
        manifest = load_workspace(valid_manifest_file)
        assert manifest is not None
        assert len(manifest.projects) == 2

    def test_missing_file_returns_none(self, tmp_path):
        manifest = load_workspace(tmp_path / "nonexistent.json")
        assert manifest is None

    def test_invalid_json_returns_none(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text("NOT JSON {{{")
        manifest = load_workspace(bad)
        assert manifest is None

    def test_invalid_schema_returns_none(self, tmp_path):
        bad = tmp_path / "bad-schema.json"
        bad.write_text(json.dumps({"version": "9.9", "projects": []}))
        manifest = load_workspace(bad)
        assert manifest is None


class TestProjectSlugFromCwd:
    def test_exact_match(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert project_slug_from_cwd(manifest, "/tmp/test-archon") == "archon"

    def test_subdirectory_match(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert project_slug_from_cwd(manifest, "/tmp/test-archon/src/deep/path") == "archon"

    def test_no_match(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        assert project_slug_from_cwd(manifest, "/completely/different") is None

    def test_longest_prefix_wins(self):
        data = {
            "version": "1.0",
            "projects": [
                {"name": "parent", "path": "/tmp/projects", "role": "secondary"},
                {"name": "child", "path": "/tmp/projects/child", "role": "primary"},
            ],
        }
        manifest = validate_manifest(data)
        assert project_slug_from_cwd(manifest, "/tmp/projects/child/src") == "child"


class TestGetAddDirArgs:
    def test_returns_secondary_projects(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        args = get_add_dir_args(manifest, "/tmp/test-archon")
        assert args == ["--add-dir", "/tmp/test-market"]

    def test_excludes_primary(self, valid_manifest_data):
        manifest = validate_manifest(valid_manifest_data)
        args = get_add_dir_args(manifest, "/tmp/test-archon")
        assert "/tmp/test-archon" not in args

    def test_empty_when_only_primary(self):
        data = {
            "version": "1.0",
            "projects": [
                {"name": "solo", "path": "/tmp/solo", "role": "primary"},
            ],
        }
        manifest = validate_manifest(data)
        args = get_add_dir_args(manifest, "/tmp/solo")
        assert args == []
