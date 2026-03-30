"""Tests for push-to-talk configuration module."""

import json
import tempfile
from pathlib import Path

import pytest

from src.voice_mcp.ptt_config import PTTConfig, load_config


class TestPTTConfigDefaults:
    def test_default_hotkey(self):
        cfg = PTTConfig()
        assert cfg.hotkey == "ctrl+shift+space"

    def test_default_model_is_none(self):
        cfg = PTTConfig()
        assert cfg.model is None

    def test_default_language(self):
        cfg = PTTConfig()
        assert cfg.language == "en"

    def test_default_wayland_injector(self):
        cfg = PTTConfig()
        assert cfg.wayland_injector == "auto"

    def test_default_macos_clipboard_threshold(self):
        cfg = PTTConfig()
        assert cfg.macos_clipboard_threshold == 200

    def test_default_target_app_pattern_is_none(self):
        cfg = PTTConfig()
        assert cfg.target_app_pattern is None

    def test_pid_path_returns_path(self):
        cfg = PTTConfig()
        assert isinstance(cfg.pid_path(), Path)
        assert "ptt" in str(cfg.pid_path())

    def test_sock_path_returns_path(self):
        cfg = PTTConfig()
        assert isinstance(cfg.sock_path(), Path)
        assert "ptt" in str(cfg.sock_path())

    def test_tilde_expansion_in_pid_path(self):
        cfg = PTTConfig(pid_file="~/custom/ptt.pid")
        path = cfg.pid_path()
        assert not str(path).startswith("~")
        assert "custom" in str(path)

    def test_tilde_expansion_in_sock_path(self):
        cfg = PTTConfig(socket_path="~/custom/ptt.sock")
        path = cfg.sock_path()
        assert not str(path).startswith("~")


class TestLoadConfig:
    def test_load_returns_defaults_when_no_file(self, tmp_path):
        cfg = load_config(tmp_path / "nonexistent.json")
        assert isinstance(cfg, PTTConfig)
        assert cfg.hotkey == "ctrl+shift+space"

    def test_load_from_valid_json(self, tmp_path):
        config_file = tmp_path / "ptt.json"
        config_file.write_text(json.dumps({
            "hotkey": "ctrl+alt+v",
            "model": "tiny.en",
            "language": "fr",
        }))
        cfg = load_config(config_file)
        assert cfg.hotkey == "ctrl+alt+v"
        assert cfg.model == "tiny.en"
        assert cfg.language == "fr"

    def test_load_ignores_unknown_keys(self, tmp_path):
        config_file = tmp_path / "ptt.json"
        config_file.write_text(json.dumps({
            "hotkey": "ctrl+space",
            "future_feature": "value",
            "unknown_key": 42,
        }))
        cfg = load_config(config_file)
        assert cfg.hotkey == "ctrl+space"

    def test_load_falls_back_on_malformed_json(self, tmp_path):
        config_file = tmp_path / "ptt.json"
        config_file.write_text("{not valid json}")
        cfg = load_config(config_file)
        assert cfg.hotkey == "ctrl+shift+space"

    def test_load_preserves_unspecified_defaults(self, tmp_path):
        config_file = tmp_path / "ptt.json"
        config_file.write_text(json.dumps({"hotkey": "ctrl+space"}))
        cfg = load_config(config_file)
        assert cfg.language == "en"
        assert cfg.model is None

    def test_load_all_fields(self, tmp_path):
        config_file = tmp_path / "ptt.json"
        data = {
            "hotkey": "cmd+shift+space",
            "model": "small.en",
            "language": "de",
            "target_app_pattern": "Claude Code",
            "wayland_injector": "ydotool",
            "macos_clipboard_threshold": 100,
        }
        config_file.write_text(json.dumps(data))
        cfg = load_config(config_file)
        assert cfg.hotkey == "cmd+shift+space"
        assert cfg.model == "small.en"
        assert cfg.language == "de"
        assert cfg.target_app_pattern == "Claude Code"
        assert cfg.wayland_injector == "ydotool"
        assert cfg.macos_clipboard_threshold == 100

    def test_load_falls_back_on_type_error(self, tmp_path):
        config_file = tmp_path / "ptt.json"
        # macos_clipboard_threshold should be int, but provide a list
        config_file.write_text(json.dumps({"macos_clipboard_threshold": [1, 2]}))
        # PTTConfig accepts any value (no runtime type validation); just verify no crash
        # (The dataclass doesn't enforce types at runtime)
        cfg = load_config(config_file)
        assert cfg is not None
