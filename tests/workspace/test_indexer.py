"""Tests for workspace indexer."""

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from workspace.manifest import WorkspaceManifest, ProjectEntry, IndexConfig
from workspace.indexer import index_workspace_projects


@pytest.fixture
def mock_manifest(tmp_path):
    """Create a manifest with real temp directories."""
    proj_a = tmp_path / "project-a"
    proj_b = tmp_path / "project-b"
    proj_a.mkdir()
    proj_b.mkdir()
    (proj_a / "file.py").write_text("print('hello')")
    (proj_b / "file.ts").write_text("console.log('hello')")

    return WorkspaceManifest(
        version="1.0",
        projects=[
            ProjectEntry(name="proj-a", path=str(proj_a), role="primary"),
            ProjectEntry(name="proj-b", path=str(proj_b), role="secondary"),
        ],
        index_config=IndexConfig(),
    )


@pytest.fixture
def mock_leann():
    """Mock LEANN caller that returns success."""
    def caller(operation, **kwargs):
        return {"status": "ok", "chunks": 10, "operation": operation, **kwargs}
    return caller


class TestIndexWorkspaceProjects:
    def test_no_manifest_returns_status(self):
        result = index_workspace_projects(manifest=None)
        # Will try to load from disk — likely no manifest
        assert result["status"] in ("no_manifest", "ok")

    def test_indexes_all_projects(self, mock_manifest, mock_leann):
        result = index_workspace_projects(manifest=mock_manifest, leann_caller=mock_leann)
        assert result["status"] == "ok"
        assert "proj-a" in result["projects"]
        assert "proj-b" in result["projects"]
        assert result["projects"]["proj-a"]["status"] == "indexed"
        assert result["projects"]["proj-b"]["status"] == "indexed"

    def test_skips_missing_path(self, mock_manifest, mock_leann):
        mock_manifest.projects[0].path = "/nonexistent/path/12345"
        result = index_workspace_projects(manifest=mock_manifest, leann_caller=mock_leann)
        assert result["projects"]["proj-a"]["status"] == "path_missing"
        assert result["projects"]["proj-b"]["status"] == "indexed"

    def test_auto_reindex_disabled(self, mock_manifest, mock_leann):
        mock_manifest.index_config.auto_reindex = False
        result = index_workspace_projects(manifest=mock_manifest, leann_caller=mock_leann)
        assert result["status"] == "auto_reindex_disabled"

    def test_leann_error_captured(self, mock_manifest):
        def failing_leann(operation, **kwargs):
            raise ConnectionError("LEANN not running")

        result = index_workspace_projects(manifest=mock_manifest, leann_caller=failing_leann)
        assert result["status"] == "ok"
        assert result["projects"]["proj-a"]["status"] == "error"
        assert "LEANN not running" in result["projects"]["proj-a"]["error"]

    def test_duration_tracked(self, mock_manifest, mock_leann):
        result = index_workspace_projects(manifest=mock_manifest, leann_caller=mock_leann)
        assert "duration_ms" in result["projects"]["proj-a"]
        assert result["projects"]["proj-a"]["duration_ms"] >= 0

    def test_passes_project_name_to_leann(self, mock_manifest):
        calls = []
        def tracking_leann(operation, **kwargs):
            calls.append({"operation": operation, **kwargs})
            return {"status": "ok"}

        index_workspace_projects(manifest=mock_manifest, leann_caller=tracking_leann)
        assert len(calls) == 2
        assert calls[0]["repository_name"] == "proj-a"
        assert calls[1]["repository_name"] == "proj-b"
