"""Interactive HTML renderer — self-contained D3.js force-directed graph."""

from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from pathlib import Path

from ..models import FileNode, ProjectGraph

logger = logging.getLogger(__name__)

LANGUAGE_COLORS: dict[str, str] = {
    "python": "#3572A5",
    "typescript": "#2b7489",
    "tsx": "#2b7489",
    "javascript": "#f1e05a",
    "rust": "#dea584",
    "cpp": "#f34b7d",
    "c": "#555555",
}

DEFAULT_COLOR = "#999999"


# ── Data preparation ────────────────────────────────────────────────


def _dir_of(path: Path, root: Path) -> str:
    """Return the parent directory of *path* relative to *root*."""
    try:
        rel = path.relative_to(root)
    except ValueError:
        rel = path
    parent = str(rel.parent)
    return parent if parent != "." else "(root)"


def _primary_language(files: list[FileNode]) -> str:
    """Most common language among *files*."""
    if not files:
        return "python"
    counts = Counter(f.language.value for f in files)
    return counts.most_common(1)[0][0]


def _build_graph_data(graph: ProjectGraph, node_cap: int) -> dict:
    """Aggregate file-level data into directory-level nodes and links."""

    # Group files by directory
    dir_files: dict[str, list[FileNode]] = defaultdict(list)
    for path, fnode in graph.files.items():
        d = _dir_of(path, graph.root)
        dir_files[d].append(fnode)

    # If over cap, merge smallest dirs into "(other)"
    if len(dir_files) > node_cap:
        logger.info(
            "Directory count %d exceeds cap %d — aggregating smallest into '(other)'",
            len(dir_files),
            node_cap,
        )
        ranked = sorted(dir_files.items(), key=lambda kv: len(kv[1]), reverse=True)
        keep = dict(ranked[: node_cap - 1])
        other_files: list[FileNode] = []
        for _, flist in ranked[node_cap - 1 :]:
            other_files.extend(flist)
        keep["(other)"] = other_files
        dir_files = keep

    # Build lookup: file path -> directory id
    file_to_dir: dict[Path, str] = {}
    for d, flist in dir_files.items():
        for f in flist:
            file_to_dir[f.path] = d

    # Nodes
    nodes: list[dict] = []
    for d, flist in dir_files.items():
        symbol_count = sum(len(f.symbols) for f in flist)
        nodes.append(
            {
                "id": d,
                "type": "directory",
                "files": len(flist),
                "symbols": symbol_count,
                "language": _primary_language(flist),
                "fanIn": 0,
                "fanOut": 0,
            }
        )

    # Edges (directory-level, aggregated)
    link_counts: Counter[tuple[str, str]] = Counter()
    for edge in graph.edges:
        src_dir = file_to_dir.get(edge.source)
        tgt_dir = file_to_dir.get(edge.target)
        if src_dir and tgt_dir and src_dir != tgt_dir:
            link_counts[(src_dir, tgt_dir)] += 1

    links: list[dict] = [
        {"source": s, "target": t, "count": c} for (s, t), c in link_counts.items()
    ]

    # Fan-in / fan-out on directory level
    fan_in: Counter[str] = Counter()
    fan_out: Counter[str] = Counter()
    for (s, t), c in link_counts.items():
        fan_out[s] += c
        fan_in[t] += c
    node_map = {n["id"]: n for n in nodes}
    for d, n in node_map.items():
        n["fanIn"] = fan_in.get(d, 0)
        n["fanOut"] = fan_out.get(d, 0)

    # File-level detail for drill-down
    file_nodes: dict[str, list[dict]] = {}
    for d, flist in dir_files.items():
        file_nodes[d] = [
            {
                "id": str(f.path.relative_to(graph.root)) if _is_relative(f.path, graph.root) else str(f.path),
                "symbols": len(f.symbols),
                "lines": f.lines,
            }
            for f in flist
        ]

    return {"nodes": nodes, "links": links, "fileNodes": file_nodes}


def _is_relative(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


# ── HTML template ───────────────────────────────────────────────────

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{PROJECT_NAME}} — Dependency Graph</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; }
#toolbar { position: fixed; top: 0; left: 0; right: 0; height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 16px; background: #161b22; border-bottom: 1px solid #30363d; z-index: 10; }
#toolbar h1 { font-size: 14px; font-weight: 600; white-space: nowrap; }
#search { width: 220px; padding: 4px 8px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; font-size: 13px; outline: none; }
#search:focus { border-color: #58a6ff; }
#back-btn { display: none; padding: 4px 10px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 12px; }
#back-btn:hover { background: #30363d; }
#info { margin-left: auto; font-size: 12px; color: #8b949e; white-space: nowrap; }
#legend { position: fixed; bottom: 12px; left: 12px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 10px 14px; font-size: 12px; z-index: 10; }
#legend h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #8b949e; margin-bottom: 6px; }
.legend-item { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.legend-swatch { width: 12px; height: 12px; border-radius: 3px; }
#tooltip { position: fixed; pointer-events: none; background: #1c2128; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; font-size: 12px; line-height: 1.5; display: none; z-index: 20; max-width: 280px; }
svg { width: 100vw; height: 100vh; display: block; }
</style>
</head>
<body>
<div id="toolbar">
  <h1>{{PROJECT_NAME}}</h1>
  <input id="search" type="text" placeholder="Search files / dirs…">
  <button id="back-btn" onclick="backToDirectories()">← Back</button>
  <span id="info"></span>
</div>
<div id="legend"></div>
<div id="tooltip"></div>
<svg></svg>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
// --- DATA ---
const graphData = {{GRAPH_DATA}};
const LANG_COLORS = {{LANG_COLORS}};
const DEFAULT_CLR = "{{DEFAULT_COLOR}}";

function langColor(lang) { return LANG_COLORS[lang] || DEFAULT_CLR; }

// --- SETUP ---
const svg = d3.select("svg");
const width = window.innerWidth;
const height = window.innerHeight;
const g = svg.append("g");

svg.attr("viewBox", [0, 0, width, height]);

// Zoom
const zoom = d3.zoom().scaleExtent([0.1, 6]).on("zoom", e => g.attr("transform", e.transform));
svg.call(zoom);

// Arrow marker
svg.append("defs").append("marker")
  .attr("id", "arrow").attr("viewBox", "0 0 10 10")
  .attr("refX", 20).attr("refY", 5)
  .attr("markerWidth", 6).attr("markerHeight", 6)
  .attr("orient", "auto-start-reverse")
  .append("path").attr("d", "M 0 0 L 10 5 L 0 10 z").attr("fill", "#30363d");

// Tooltip
const tooltip = d3.select("#tooltip");

// Info
d3.select("#info").text(graphData.nodes.length + " directories, " + graphData.links.length + " dependency links");

// --- LEGEND ---
const langs = [...new Set(graphData.nodes.map(n => n.language))].sort();
const legend = d3.select("#legend");
legend.append("h3").text("Languages");
langs.forEach(l => {
  const row = legend.append("div").attr("class", "legend-item");
  row.append("div").attr("class", "legend-swatch").style("background", langColor(l));
  row.append("span").text(l);
});

// --- SCALES ---
const fileExtent = d3.extent(graphData.nodes, n => n.files);
const rScale = d3.scaleSqrt().domain([fileExtent[0] || 1, fileExtent[1] || 1]).range([6, 30]);
const linkExtent = d3.extent(graphData.links, l => l.count);
const wScale = d3.scaleLinear().domain([linkExtent[0] || 1, linkExtent[1] || 1]).range([1, 5]);

// --- SIMULATION ---
let simulation, linkSel, nodeSel, labelSel;
let currentView = "directory";

function renderDirectory(filter) {
  g.selectAll("*").remove();
  currentView = "directory";
  d3.select("#back-btn").style("display", "none");

  let nodes = graphData.nodes;
  let links = graphData.links;
  if (filter) {
    const q = filter.toLowerCase();
    const matchIds = new Set();
    nodes.forEach(n => { if (n.id.toLowerCase().includes(q)) matchIds.add(n.id); });
    // also check file nodes
    Object.entries(graphData.fileNodes).forEach(([dir, files]) => {
      files.forEach(f => { if (f.id.toLowerCase().includes(q)) matchIds.add(dir); });
    });
    nodes = nodes.filter(n => matchIds.has(n.id));
    const nodeSet = new Set(nodes.map(n => n.id));
    links = links.filter(l => nodeSet.has(l.source) && nodeSet.has(l.target));
  }

  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(100))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(d => rScale(d.files) + 4));

  linkSel = g.append("g").attr("class", "links").selectAll("line")
    .data(links).join("line")
    .attr("stroke", "#30363d")
    .attr("stroke-width", d => wScale(d.count))
    .attr("marker-end", "url(#arrow)");

  nodeSel = g.append("g").attr("class", "nodes").selectAll("circle")
    .data(nodes).join("circle")
    .attr("r", d => rScale(d.files))
    .attr("fill", d => langColor(d.language))
    .attr("stroke", "#0d1117").attr("stroke-width", 1.5)
    .style("cursor", "pointer")
    .on("mouseover", (e, d) => showTooltip(e, d))
    .on("mouseout", () => tooltip.style("display", "none"))
    .on("click", (e, d) => expandDir(d.id))
    .call(d3.drag().on("start", dragStart).on("drag", dragging).on("end", dragEnd));

  labelSel = g.append("g").attr("class", "labels").selectAll("text")
    .data(nodes).join("text")
    .text(d => d.id.split("/").pop() || d.id)
    .attr("font-size", 10).attr("fill", "#8b949e")
    .attr("text-anchor", "middle").attr("dy", d => rScale(d.files) + 14)
    .style("pointer-events", "none");

  simulation.on("tick", () => {
    linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
           .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    nodeSel.attr("cx", d => d.x).attr("cy", d => d.y);
    labelSel.attr("x", d => d.x).attr("y", d => d.y);
  });
}

function showTooltip(event, d) {
  let html = "<strong>" + d.id + "</strong><br>";
  if (d.type === "directory") {
    html += "Files: " + d.files + "<br>Symbols: " + d.symbols + "<br>Fan-in: " + d.fanIn + "<br>Fan-out: " + d.fanOut + "<br>Language: " + d.language;
  } else {
    html += "Symbols: " + (d.symbols || 0) + "<br>Lines: " + (d.lines || 0);
  }
  tooltip.html(html).style("display", "block")
    .style("left", (event.clientX + 14) + "px")
    .style("top", (event.clientY + 14) + "px");
}

// --- DRILL-DOWN ---
function expandDir(dirId) {
  const files = graphData.fileNodes[dirId];
  if (!files || files.length === 0) return;
  g.selectAll("*").remove();
  currentView = "file";
  d3.select("#back-btn").style("display", "inline-block");
  if (simulation) simulation.stop();

  const fNodes = files.map(f => ({...f, type: "file"}));
  const center = {id: dirId, type: "directory-center", files: fNodes.length, symbols: 0, language: ""};
  const allNodes = [center, ...fNodes];
  const fLinks = fNodes.map(f => ({source: dirId, target: f.id}));

  const sim = d3.forceSimulation(allNodes)
    .force("link", d3.forceLink(fLinks).id(d => d.id).distance(60))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("center", d3.forceCenter(width / 2, height / 2));

  const ls = g.append("g").selectAll("line").data(fLinks).join("line")
    .attr("stroke", "#30363d").attr("stroke-width", 1);

  const ns = g.append("g").selectAll("circle").data(allNodes).join("circle")
    .attr("r", d => d.type === "directory-center" ? 18 : 8)
    .attr("fill", d => d.type === "directory-center" ? "#58a6ff" : "#8b949e")
    .attr("stroke", "#0d1117").attr("stroke-width", 1.5)
    .on("mouseover", (e, d) => showTooltip(e, d))
    .on("mouseout", () => tooltip.style("display", "none"))
    .call(d3.drag().on("start", dragStart).on("drag", dragging).on("end", dragEnd));

  const lb = g.append("g").selectAll("text").data(allNodes).join("text")
    .text(d => d.id.split("/").pop())
    .attr("font-size", 9).attr("fill", "#c9d1d9")
    .attr("text-anchor", "middle").attr("dy", d => (d.type === "directory-center" ? 18 : 8) + 12)
    .style("pointer-events", "none");

  sim.on("tick", () => {
    ls.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    ns.attr("cx", d => d.x).attr("cy", d => d.y);
    lb.attr("x", d => d.x).attr("y", d => d.y);
  });

  simulation = sim;
}

function backToDirectories() { renderDirectory(d3.select("#search").property("value") || null); }

// --- SEARCH ---
let searchTimer;
d3.select("#search").on("input", function() {
  clearTimeout(searchTimer);
  const val = this.value.trim();
  searchTimer = setTimeout(() => {
    if (currentView === "directory") renderDirectory(val || null);
  }, 250);
});

// --- DRAG ---
function dragStart(e, d) { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
function dragging(e, d) { d.fx = e.x; d.fy = e.y; }
function dragEnd(e, d) { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

// --- INIT ---
renderDirectory();
</script>
</body>
</html>
"""


# ── Public API ──────────────────────────────────────────────────────


def generate_interactive_html(
    graph: ProjectGraph,
    output_path: Path,
    node_cap: int = 200,
) -> Path:
    """Generate a self-contained interactive HTML file with a D3.js force graph.

    Parameters
    ----------
    graph:
        The project dependency graph to visualize.
    output_path:
        Where to write the HTML file.
    node_cap:
        Maximum directory-level nodes before aggregation kicks in.

    Returns
    -------
    Path
        The *output_path* that was written.
    """
    logger.info("Building interactive HTML for project '%s'", graph.name)

    data = _build_graph_data(graph, node_cap)

    html = HTML_TEMPLATE
    html = html.replace("{{PROJECT_NAME}}", _escape_html(graph.name))
    html = html.replace("{{GRAPH_DATA}}", json.dumps(data, separators=(",", ":")))
    html = html.replace("{{LANG_COLORS}}", json.dumps(LANGUAGE_COLORS, separators=(",", ":")))
    html = html.replace("{{DEFAULT_COLOR}}", DEFAULT_COLOR)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")

    logger.info("Wrote interactive HTML (%d bytes) to %s", len(html), output_path)
    return output_path


def _escape_html(text: str) -> str:
    """Minimal HTML entity escaping for safe embedding in tags."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
