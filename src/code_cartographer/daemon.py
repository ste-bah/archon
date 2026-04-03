"""HTTP daemon — holds parsed project graphs in memory, serves queries via HTTP.
Usage:  PYTHONPATH=. python -m src.code_cartographer.daemon [--port 8042]
"""
from __future__ import annotations
import argparse, atexit, itertools, json, logging, os, random, signal, sys, threading, time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from .graph import analyze, compute_metrics, detect_clusters
from .models import (Edge, EdgeKind, FileNode, ImportInfo, Language,
                     ProjectGraph, Symbol, SymbolKind, Visibility)
from .parsers.python_parser import PythonParser
from .parsers.typescript_parser import TypeScriptParser
from .parsers.rust_parser import RustParser
from .parsers.cpp_parser import CppParser
from .resolver import resolve_imports
from .scanner import scan_directory
from .summarizer import generate_summary
from .visualizer import generate_all as generate_diagrams, generate_focus_diagram
from .renderers.mermaid import render_all as render_mermaid_all
from .renderers.html_interactive import generate_interactive_html
log = logging.getLogger("cartographer.daemon")

PARSERS = {Language.PYTHON: PythonParser(), Language.TYPESCRIPT: TypeScriptParser(tsx=False),
    Language.TSX: TypeScriptParser(tsx=True), Language.JAVASCRIPT: TypeScriptParser(tsx=False),
    Language.RUST: RustParser(), Language.CPP: CppParser(), Language.C: CppParser()}
LANG_ALIASES: dict[str, Language] = {
    "py": Language.PYTHON, "python": Language.PYTHON, "ts": Language.TYPESCRIPT,
    "typescript": Language.TYPESCRIPT, "tsx": Language.TSX, "js": Language.JAVASCRIPT,
    "javascript": Language.JAVASCRIPT, "rs": Language.RUST, "rust": Language.RUST,
    "cpp": Language.CPP, "c++": Language.CPP, "c": Language.C}
RESEARCH_ROOT = Path(__file__).resolve().parent.parent.parent / "research"
PID_DIR = Path.home() / ".archon" / "cartographer"
PID_FILE = PID_DIR / "daemon.pid"
_graphs: dict[str, ProjectGraph] = {}
_summaries: dict[str, str] = {}
_last_scan: dict[str, datetime] = {}
_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()
_state_lock = threading.Lock()
_start_time = time.monotonic()


def _project_lock(name: str) -> threading.Lock:
    with _locks_lock:
        if name not in _locks:
            _locks[name] = threading.Lock()
        return _locks[name]

def _research_dir(name: str) -> Path: return RESEARCH_ROOT / name

def _sample_max_mtime(path: Path, n: int = 100, pool_size: int = 500) -> float:
    try:
        pool = [p for p in itertools.islice(path.rglob("*"), pool_size) if p.is_file()]
    except OSError:
        return 0.0
    if not pool:
        return 0.0
    return max((p.stat().st_mtime for p in random.sample(pool, min(n, len(pool)))), default=0.0)


def _is_stale(name: str) -> bool:
    with _state_lock:
        if name not in _last_scan or name not in _graphs:
            return True
        root = _graphs[name].root
        ts = _last_scan[name].timestamp()
    return _sample_max_mtime(root) > ts


def _save_meta(name: str) -> None:
    d = _research_dir(name)
    d.mkdir(parents=True, exist_ok=True)
    (d / ".cartographer-meta.json").write_text(
        json.dumps({"last_scan": _last_scan[name].isoformat()}), encoding="utf-8")


def _load_cached(name: str) -> bool:
    """Load a project from research/{name}/analysis.json into memory."""
    if name in _graphs:
        return True
    ap = _research_dir(name) / "analysis.json"
    if not ap.exists():
        return False
    try:
        d = json.loads(ap.read_text(encoding="utf-8"))
        root = Path(d["root"])
        files: dict[Path, FileNode] = {}
        for ps, fd in d.get("files", {}).items():
            p = Path(ps)
            files[p] = FileNode(
                path=p, language=Language(fd["language"]),
                lines=fd.get("lines", 0), parse_errors=fd.get("parse_errors", 0),
                exports=fd.get("exports", []),
                symbols=[Symbol(name=s["name"], kind=SymbolKind(s["kind"]), line=s.get("line", 0),
                                visibility=Visibility(s["visibility"]) if "visibility" in s else Visibility.PUBLIC,
                                params=s.get("params", []), return_type=s.get("return_type"),
                                bases=s.get("bases", []), decorators=s.get("decorators", []))
                         for s in fd.get("symbols", [])],
                imports=[ImportInfo(module=i["module"], line=i.get("line", 0), names=i.get("names", []),
                                   alias=i.get("alias"), is_type_only=i.get("type_only", False),
                                   is_dynamic=i.get("dynamic", False), is_relative=i.get("relative", False))
                         for i in fd.get("imports", [])],
            )
        edges = [Edge(source=Path(e["source"]), target=Path(e["target"]),
                       kind=EdgeKind(e.get("kind", "import")), names=e.get("names", []))
                 for e in d.get("edges", [])]
        graph = ProjectGraph(name=name, root=root, files=files, edges=edges,
                             cycles=[[Path(p) for p in c] for c in d.get("cycles", [])])
        graph.build_index()
        mp = _research_dir(name) / ".cartographer-meta.json"
        try:
            scan_time = datetime.fromisoformat(json.loads(mp.read_text())["last_scan"])
        except Exception:
            scan_time = datetime.now(timezone.utc)
        sp = _research_dir(name) / "summary.md"
        summary = sp.read_text(encoding="utf-8") if sp.exists() else None
        with _state_lock:
            _graphs[name] = graph
            _last_scan[name] = scan_time
            if summary is not None:
                _summaries[name] = summary
        log.info("Loaded cached analysis for %r (%d files)", name, len(files))
        return True
    except Exception:
        log.warning("Failed to load cache for %r", name, exc_info=True)
        return False


# ── Scan pipeline ───────────────────────────────────────────────────

def _run_scan(project_path: Path, name: str, languages: set[Language] | None) -> dict:
    root = project_path.resolve()
    discovered = scan_directory(root, languages=languages)
    files: dict[Path, FileNode] = {}
    for path, lang in discovered:
        parser = PARSERS.get(lang)
        if parser is None:
            continue
        try:
            node = parser.parse_file(path, lang)
            if node:
                files[path] = node
        except Exception:
            log.warning("Parse failed: %s", path, exc_info=True)

    edges, unresolved = resolve_imports(files, root)
    graph = ProjectGraph(name=name, root=root, files=files, edges=edges, unresolved=unresolved)
    graph = analyze(graph)
    metrics, clusters = compute_metrics(graph), detect_clusters(graph)
    with _state_lock:
        _graphs[name] = graph
        _last_scan[name] = datetime.now(timezone.utc)

    out = _research_dir(name)
    out.mkdir(parents=True, exist_ok=True)
    dd = out / "diagrams"; dd.mkdir(parents=True, exist_ok=True)
    summary_md = generate_summary(graph, metrics=metrics, clusters=clusters)
    with _state_lock:
        _summaries[name] = summary_md
    (out / "summary.md").write_text(summary_md, encoding="utf-8")
    (out / "analysis.json").write_text(json.dumps(graph.to_dict(), indent=2), encoding="utf-8")
    _save_meta(name)
    ms = generate_diagrams(graph)
    if ms:
        render_mermaid_all(ms, dd, render=False)
    try:
        generate_interactive_html(graph, dd / "overview.html")
    except Exception:
        log.warning("HTML generation failed", exc_info=True)
    return {"status": "ok", "files": graph.file_count, "symbols": graph.symbol_count,
            "edges": graph.edge_count, "cycles": len(graph.cycles), "cached": False}


def _cached_stats(g: ProjectGraph) -> dict:
    return {"status": "ok", "files": g.file_count, "symbols": g.symbol_count,
            "edges": g.edge_count, "cycles": len(g.cycles), "cached": True}


def _path_matches(candidate: Path, target: Path, root: Path) -> bool:
    try:
        rel = candidate.relative_to(root)
    except ValueError:
        rel = candidate
    return candidate == target or rel == target or str(rel) == str(target)


# ── HTTP Handler ────────────────────────────────────────────────────

class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: ANN001
        log.debug(fmt, *args)

    def _json(self, code: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def _require(self, name: str) -> ProjectGraph | None:
        if name in _graphs or _load_cached(name):
            return _graphs[name]
        self._json(404, {"status": "error", "error": f"Project {name!r} not found"})
        return None

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        params = {k: v[0] for k, v in parse_qs(self.path.split("?", 1)[1]).items()} if "?" in self.path else {}
        if path == "/health":
            self._json(200, {"status": "ok"})
        elif path == "/status":
            self._json(200, {"status": "ok", "projects_loaded": len(_graphs),
                             "uptime": int(time.monotonic() - _start_time)})
        elif path == "/list":
            with _state_lock:
                snapshot = list(_graphs.items())
                scans = dict(_last_scan)
            self._json(200, {"status": "ok", "projects": [
                {"name": n, "files": g.file_count, "symbols": g.symbol_count,
                 "last_scan": scans[n].isoformat() if n in scans else None}
                for n, g in snapshot]})
        elif path == "/summary":
            name = params.get("name", "")
            if not name:
                return self._json(400, {"status": "error", "error": "Missing 'name' parameter"})
            g = self._require(name)
            if g:
                self._json(200, {"status": "ok", "summary": _summaries.get(name, ""), "stale": _is_stale(name)})
        else:
            self._json(404, {"status": "error", "error": f"Unknown endpoint: {path}"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        try:
            body = self._body()
        except (json.JSONDecodeError, ValueError) as exc:
            return self._json(400, {"status": "error", "error": f"Invalid JSON: {exc}"})
        handlers = {"/scan": self._h_scan, "/query": self._h_query, "/focus": self._h_focus}
        h = handlers.get(path)
        if h:
            h(body)
        else:
            self._json(404, {"status": "error", "error": f"Unknown endpoint: {path}"})

    def _h_scan(self, b: dict) -> None:
        pp, name, force = b.get("path"), b.get("name"), b.get("force", False)
        if not pp or not name:
            return self._json(400, {"status": "error", "error": "Missing 'path' and/or 'name'"})
        pp = Path(pp).resolve()
        if not pp.is_dir():
            return self._json(400, {"status": "error", "error": f"Not a directory: {pp}"})
        langs: set[Language] | None = None
        if b.get("languages"):
            langs = {l for s in b["languages"] if (l := LANG_ALIASES.get(s.lower()))}
        if not force:
            if name in _graphs and not _is_stale(name):
                return self._json(200, _cached_stats(_graphs[name]))
            if _load_cached(name) and not _is_stale(name):
                return self._json(200, _cached_stats(_graphs[name]))
        with _project_lock(name):
            self._json(200, _run_scan(pp, name, langs))

    def _h_query(self, b: dict) -> None:
        name, qt = b.get("name", ""), b.get("type", "")
        if not name or not qt:
            return self._json(400, {"status": "error", "error": "Missing 'name' and/or 'type'"})
        g = self._require(name)
        if not g:
            return
        try:
            if qt == "hotspots":
                r = [{"file": str(p), "fan_in": fi, "fan_out": fo} for p, fi, fo in g.hotspots(b.get("top_n", 20))]
            elif qt == "cycles":
                r = [[str(p) for p in c] for c in g.cycles]
            elif qt == "file-deps":
                t = b.get("target", "")
                if not t:
                    return self._json(400, {"status": "error", "error": "Missing 'target'"})
                tp = Path(t)
                r = {"imports": [str(e.target) for e in g.edges if _path_matches(e.source, tp, g.root)],
                     "imported_by": [str(e.source) for e in g.edges if _path_matches(e.target, tp, g.root)]}
            elif qt == "symbol-search":
                q = b.get("query", "").lower()
                if not q:
                    return self._json(400, {"status": "error", "error": "Missing 'query'"})
                r = [{"file": str(p), "name": s.name, "kind": s.kind.value, "line": s.line}
                     for p, fn in g.files.items() for s in fn.symbols if q in s.name.lower()]
            elif qt == "file-info":
                t = b.get("target", "")
                if not t:
                    return self._json(400, {"status": "error", "error": "Missing 'target'"})
                tp = Path(t)
                fn = next((fn for p, fn in g.files.items() if _path_matches(p, tp, g.root)), None)
                if fn is None:
                    return self._json(404, {"status": "error", "error": f"File not found: {t}"})
                r = fn.to_dict()
            else:
                return self._json(400, {"status": "error", "error": f"Unknown query type: {qt}"})
            self._json(200, {"status": "ok", "results": r})
        except Exception as exc:
            log.error("Query failed: %s", exc, exc_info=True)
            self._json(500, {"status": "error", "error": str(exc)})

    def _h_focus(self, b: dict) -> None:
        name, module, depth = b.get("name", ""), b.get("module", ""), b.get("depth", 2)
        if not name or not module:
            return self._json(400, {"status": "error", "error": "Missing 'name' and/or 'module'"})
        g = self._require(name)
        if not g:
            return
        mermaid = generate_focus_diagram(g, module, depth)
        files = [str(p) for p in g.files if module in str(p)]
        edges = [e.to_dict() for e in g.edges if module in str(e.source) or module in str(e.target)]
        self._json(200, {"status": "ok", "mermaid": mermaid, "files": files, "edges": edges})


# ── Daemon lifecycle ────────────────────────────────────────────────

class CartographerDaemon:
    """Manages the HTTP daemon lifecycle."""
    def __init__(self, port: int = 8042):
        self.port = port
        self.server: ThreadingHTTPServer | None = None

    def start(self) -> None:
        PID_DIR.mkdir(parents=True, exist_ok=True)
        PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
        atexit.register(lambda: PID_FILE.unlink(missing_ok=True))
        try:
            self.server = ThreadingHTTPServer(("127.0.0.1", self.port), _Handler)
        except OSError as exc:
            log.error("Port %d already in use", self.port)
            PID_FILE.unlink(missing_ok=True)
            sys.exit(1)
        log.info("Cartographer daemon on http://127.0.0.1:%d (pid %d)", self.port, os.getpid())
        try:
            self.server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            self.shutdown()

    def shutdown(self) -> None:
        if self.server:
            log.info("Shutting down daemon")
            self.server.shutdown()
            self.server = None
        PID_FILE.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Code Cartographer HTTP Daemon")
    p.add_argument("--port", type=int, default=8042, help="Listen port (default: 8042)")
    args = p.parse_args(argv if argv is not None else sys.argv[1:])
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    daemon = CartographerDaemon(port=args.port)

    def _signal_handler(signum, frame):  # noqa: ANN001, ARG001
        threading.Thread(target=daemon.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _signal_handler)
    daemon.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
