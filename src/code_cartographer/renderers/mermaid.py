"""Render Mermaid .mmd files to PNG/SVG via mmdc (mermaid-cli)."""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

_MMDC = "mmdc"
_TIMEOUT = 30  # seconds


def _find_mmdc() -> str | None:
    """Return the mmdc path if available, else None."""
    return shutil.which(_MMDC)


def _puppeteer_config() -> Path | None:
    """Create a temporary puppeteer config with --no-sandbox for Linux/WSL."""
    import json
    cfg = {"args": ["--no-sandbox", "--disable-setuid-sandbox"]}
    tmp = Path(tempfile.gettempdir()) / "mermaid-puppeteer.json"
    tmp.write_text(json.dumps(cfg))
    return tmp


def render_mermaid(
    mmd_content: str,
    output_path: Path,
    format: str = "png",
) -> bool:
    """Render Mermaid content to PNG/SVG using ``mmdc``.

    Returns True on success, False on failure (missing mmdc, crash, etc.).
    The ``.mmd`` source file must already exist on disk — this function only
    renders it, it does NOT write the ``.mmd`` file.
    """
    mmdc = _find_mmdc()
    if mmdc is None:
        log.warning("mmdc not found on PATH — skipping render of %s", output_path)
        return False

    mmd_file = output_path.with_suffix(".mmd")

    puppeteer_cfg = _puppeteer_config()
    cmd = [mmdc, "-i", str(mmd_file), "-o", str(output_path), "-e", format]
    if puppeteer_cfg is not None:
        cmd += ["--puppeteerConfigFile", str(puppeteer_cfg)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT,
        )
        if result.returncode != 0:
            log.error("mmdc failed (rc=%d) for %s: %s", result.returncode, output_path, result.stderr.strip())
            return False
        log.info("Rendered %s", output_path)
        return True
    except subprocess.TimeoutExpired:
        log.error("mmdc timed out after %ds for %s", _TIMEOUT, output_path)
        return False
    except OSError as exc:
        log.error("mmdc execution error for %s: %s", output_path, exc)
        return False


def render_all(
    diagrams: dict[str, str],
    output_dir: Path,
    format: str = "png",
    render: bool = True,
) -> dict[str, Path]:
    """Write ``.mmd`` files and optionally render each to *format*.

    Always writes the ``.mmd`` source files.  When *render* is False the PNG/SVG
    rendering step is skipped (useful for ``--no-render``).
    Returns ``{name: rendered_path}`` for successfully rendered diagrams.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    rendered: dict[str, Path] = {}

    for name, content in diagrams.items():
        mmd_path = output_dir / f"{name}.mmd"
        mmd_path.write_text(content, encoding="utf-8")
        log.debug("Wrote %s", mmd_path)

        if render:
            out_path = output_dir / f"{name}.{format}"
            if render_mermaid(content, out_path, format=format):
                rendered[name] = out_path

    if render:
        log.info("Rendered %d/%d diagrams to %s", len(rendered), len(diagrams), output_dir)
    else:
        log.info("Wrote %d .mmd file(s) to %s (rendering skipped)", len(diagrams), output_dir)
    return rendered
