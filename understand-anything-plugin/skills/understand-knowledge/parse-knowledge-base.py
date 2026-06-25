#!/usr/bin/env python3
"""
Deterministic parser for Karpathy-pattern LLM wikis.

Detects the three-layer pattern (raw sources + wiki markdown + schema),
extracts structure from markdown files, resolves wikilinks, and derives
categories from index.md section headings.

Usage:
    python parse-knowledge-base.py <wiki-directory> [--profile auto|generic|prd-wiki]

Output:
    Writes scan-manifest.json to <wiki-directory>/.understand-anything/intermediate/
"""

import importlib.util
import json
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)")
URI_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
CODE_BLOCK_RE = re.compile(r"```(\w*)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
INDEX_SECTION_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)

PROFILE_GENERIC = "generic"
PROFILE_PRD_WIKI = "prd-wiki"
PROFILE_AUTO = "auto"

# Files that are part of wiki infrastructure, not content articles
INFRA_FILES = {"index.md", "log.md", "claude.md", "agents.md", "soul.md"}
NON_WIKI_CONTENT_DIRS = {".understand-anything", ".git", "raw"}


def load_merge_module():
    merge_path = Path(__file__).with_name("merge-knowledge-graph.py")
    spec = importlib.util.spec_from_file_location("merge_knowledge_graph", merge_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# ---------------------------------------------------------------------------
# Detection: is this a Karpathy-pattern wiki?
# ---------------------------------------------------------------------------

def detect_profile(root: Path, wiki_root: Path) -> str:
    """Detect specialized wiki profile signals."""
    if (root / "raw" / "prd").is_dir():
        return PROFILE_PRD_WIKI
    if (root / "raw" / "testcase").is_dir():
        return PROFILE_PRD_WIKI
    if (wiki_root / "summaries").is_dir():
        return PROFILE_PRD_WIKI
    if (wiki_root / "testcases").is_dir():
        return PROFILE_PRD_WIKI

    for schema_name in ["CLAUDE.md", "AGENTS.md"]:
        for schema_path in [root / schema_name, wiki_root / schema_name]:
            if not schema_path.is_file():
                continue
            text = schema_path.read_text(encoding="utf-8", errors="replace").lower()
            if "prd" in text or "testcase" in text or "测试用例" in text:
                return PROFILE_PRD_WIKI

    for md_file in wiki_root.rglob("*.md"):
        rel_parts = md_file.relative_to(wiki_root).parts
        if any(part in NON_WIKI_CONTENT_DIRS for part in rel_parts[:-1]):
            continue
        frontmatter = extract_frontmatter(md_file.read_text(encoding="utf-8", errors="replace"))
        if frontmatter.get("source_type") == "prd":
            return PROFILE_PRD_WIKI

    return PROFILE_GENERIC


def detect_format(root: Path) -> dict:
    """Detect if directory follows the Karpathy LLM wiki three-layer pattern."""
    signals = {
        "has_index": (root / "index.md").is_file() or (root / "wiki" / "index.md").is_file(),
        "has_log": (root / "log.md").is_file() or (root / "wiki" / "log.md").is_file(),
        "has_raw": (root / "raw").is_dir(),
        "has_schema": any(
            (root / f).is_file() or (root / "wiki" / f).is_file()
            for f in ["CLAUDE.md", "AGENTS.md"]
        ),
    }

    # Find the wiki root — could be the directory itself or a wiki/ subdirectory
    if (root / "wiki").is_dir():
        wiki_root = root / "wiki"
    else:
        wiki_root = root
    signals["profile"] = detect_profile(root, wiki_root)

    # Count markdown files in the wiki root
    md_files = list(wiki_root.rglob("*.md"))
    signals["md_count"] = len(md_files)
    signals["wiki_root"] = str(wiki_root)

    # Primary signal: has index.md + content markdown files
    if signals["has_index"] and signals["md_count"] >= 2:
        signals["detected"] = True
        signals["format"] = "karpathy"
    else:
        signals["detected"] = False
        signals["format"] = "unknown"

    return signals


# ---------------------------------------------------------------------------
# Markdown extraction helpers
# ---------------------------------------------------------------------------

def extract_frontmatter(text: str) -> dict:
    """Extract YAML-ish frontmatter as a simple key-value dict."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            key, _, val = line.partition(":")
            val = val.strip()
            if val.startswith("[") and val.endswith("]"):
                fm[key.strip()] = _parse_inline_array(val)
            else:
                fm[key.strip()] = _strip_quotes(val)
    return fm


def _strip_quotes(value: str) -> str:
    """Remove matching single or double quotes from a scalar value."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _parse_inline_array(value: str) -> list[str]:
    """Parse a small YAML-ish inline array into string values."""
    inner = value[1:-1].strip()
    if not inner:
        return []
    return [_strip_quotes(part.strip()) for part in inner.split(",") if part.strip()]


def extract_wikilinks(text: str) -> list[dict]:
    """Extract all [[target]] and [[target|display]] wikilinks."""
    links = []
    for m in WIKILINK_RE.finditer(text):
        links.append({
            "target": m.group(1).strip(),
            "display": m.group(2).strip() if m.group(2) else None,
        })
    return links


def split_link_fragment(target: str) -> tuple[str, str | None]:
    """Split a markdown link target into path and optional fragment."""
    path, sep, fragment = target.partition("#")
    if not sep:
        return target, None
    return path, fragment


def extract_markdown_links(text: str) -> dict:
    """Extract non-image markdown links, separated into internal and external."""
    links = {"internal": [], "external": []}
    for label, target in _iter_markdown_links(text):
        if URI_SCHEME_RE.match(target):
            links["external"].append(target)
            continue
        path, fragment = split_link_fragment(target)
        links["internal"].append({
            "label": label,
            "target": path or None,
            "fragment": fragment,
        })
    return links


def _iter_markdown_links(text: str):
    """Yield non-image inline markdown links with balanced parentheses."""
    i = 0
    while i < len(text):
        if text[i] != "[" or (i > 0 and text[i - 1] == "!"):
            i += 1
            continue
        label_end = text.find("]", i + 1)
        if label_end == -1 or label_end + 1 >= len(text) or text[label_end + 1] != "(":
            i += 1
            continue
        target_start = label_end + 2
        target_end = _find_markdown_link_target_end(text, target_start)
        if target_end is None:
            i += 1
            continue
        label = text[i + 1:label_end].strip()
        target = _extract_markdown_link_destination(text[target_start:target_end])
        if target:
            yield label, target
        i = target_end + 1


def _find_markdown_link_target_end(text: str, start: int) -> int | None:
    depth = 0
    quote = None
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in {"'", '"'}:
            quote = ch
            continue
        if ch == "(":
            depth += 1
            continue
        if ch == ")":
            if depth == 0:
                return i
            depth -= 1
    return None


def _extract_markdown_link_destination(raw_target: str) -> str:
    raw_target = raw_target.strip()
    if not raw_target:
        return ""
    if raw_target.startswith("<"):
        end = raw_target.find(">")
        if end != -1:
            return raw_target[1:end].strip()

    depth = 0
    for i, ch in enumerate(raw_target):
        if ch == "(":
            depth += 1
        elif ch == ")" and depth > 0:
            depth -= 1
        elif ch.isspace() and depth == 0:
            return raw_target[:i].strip()
    return raw_target


def extract_headings(text: str) -> list[dict]:
    """Extract all markdown headings with level and text."""
    return [
        {"level": len(m.group(1)), "text": m.group(2).strip()}
        for m in HEADING_RE.finditer(text)
    ]


def extract_code_blocks(text: str) -> list[str]:
    """Extract languages from fenced code blocks."""
    return [m.group(1) for m in CODE_BLOCK_RE.finditer(text) if m.group(1)]


def extract_first_paragraph(text: str) -> str:
    """Extract the first non-empty paragraph after frontmatter and H1."""
    # Strip frontmatter
    stripped = FRONTMATTER_RE.sub("", text).strip()
    if not stripped:
        return ""
    lines = stripped.split("\n")

    def _collect_paragraph(start_lines: list[str]) -> str:
        """Collect the first paragraph from the given lines."""
        para: list[str] = []
        for s_raw in start_lines:
            s = s_raw.strip()
            if not s and not para:
                continue  # Skip leading blank lines
            if not s and para:
                break  # End of paragraph
            if s.startswith(">"):
                continue  # Skip blockquotes
            if re.match(r"^[-*_]{3,}\s*$", s):
                continue  # Skip horizontal rules
            if s.startswith("#"):
                if para:
                    break  # End paragraph at next heading
                continue  # Skip headings before paragraph
            para.append(s)
        return " ".join(para)

    # Try: find first paragraph after H1
    for i, line in enumerate(lines):
        if line.strip().startswith("# "):
            result = _collect_paragraph(lines[i + 1:])
            if result:
                if len(result) > 200:
                    return result[:197] + "..."
                return result

    # Fallback: no H1 found, take first paragraph from start
    result = _collect_paragraph(lines)
    if len(result) > 200:
        result = result[:197] + "..."
    return result or ""


def extract_h1(text: str) -> str:
    """Extract the first H1 heading."""
    for m in HEADING_RE.finditer(text):
        if len(m.group(1)) == 1:
            # Strip trailing wiki-style decorations like " — subtitle"
            return m.group(2).strip()
    return ""


# ---------------------------------------------------------------------------
# Index.md parsing — categories come from section headings
# ---------------------------------------------------------------------------

def parse_index(index_path: Path) -> list[dict]:
    """Parse index.md to extract categories from ## headings and their wikilinks."""
    if not index_path.is_file():
        return []
    text = index_path.read_text(encoding="utf-8", errors="replace")
    categories = []
    current_category = None

    for line in text.split("\n"):
        # Detect ## section heading
        sec_match = re.match(r"^##\s+(.+)$", line)
        if sec_match:
            current_category = {
                "name": sec_match.group(1).strip(),
                "articles": [],
            }
            categories.append(current_category)
            continue

        # Collect wikilinks under current section
        if current_category:
            for wl in WIKILINK_RE.finditer(line):
                current_category["articles"].append(wl.group(1).strip())
            for ml in extract_markdown_links(line)["internal"]:
                if ml["target"] and not is_raw_markdown_target(ml["target"]):
                    current_category["articles"].append(ml["target"].strip())

    return categories


# ---------------------------------------------------------------------------
# Log.md parsing — extract operation timeline
# ---------------------------------------------------------------------------

def parse_log(log_path: Path) -> list[dict]:
    """Parse log.md to extract chronological entries."""
    if not log_path.is_file():
        return []
    text = log_path.read_text(encoding="utf-8", errors="replace")
    entries = []
    log_entry_re = re.compile(
        r"^##\s+\[(\d{4}-\d{2}-\d{2})\]\s+(\w+)\s*\|\s*(.+)$", re.MULTILINE
    )
    for m in log_entry_re.finditer(text):
        entries.append({
            "date": m.group(1),
            "operation": m.group(2),
            "title": m.group(3).strip(),
        })
    return entries


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def build_name_to_stem_map(wiki_root: Path) -> dict[str, str]:
    """Build a case-insensitive map from filename stem to relative stem path.

    Full relative paths always map uniquely. Bare basenames map only when
    unambiguous — duplicate basenames are removed so they don't silently
    resolve to the wrong page.
    """
    name_map: dict[str, str] = {}
    # Track which bare basenames appear more than once
    basename_counts: dict[str, int] = {}
    for md_file in wiki_root.rglob("*.md"):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()  # e.g., "decisions/decision-foo"
        basename = md_file.stem            # e.g., "decision-foo"
        # Full relative path always maps uniquely
        name_map[stem.lower()] = stem
        # Track basename for ambiguity detection
        key = basename.lower()
        basename_counts[key] = basename_counts.get(key, 0) + 1
        name_map[key] = stem

    # Remove ambiguous basename entries (appear more than once)
    for key, count in basename_counts.items():
        if count > 1 and key in name_map:
            del name_map[key]

    return name_map


def resolve_wikilink(target: str, name_map: dict[str, str], node_ids: set[str] | None = None) -> str | None:
    """Resolve a wikilink target to an article node ID.

    If node_ids is provided, only resolve to IDs that exist in the set.
    """
    key = target.lower().strip()
    # Skip targets that are clearly not page names (shell flags, etc.)
    if key.startswith("-"):
        return None
    stem = name_map.get(key)
    if stem:
        candidate = f"article:{stem}"
        # If we have a node set, verify the target exists
        if node_ids is not None and candidate not in node_ids:
            return None
        return candidate
    # Try without directory prefix
    for stored_key, stored_stem in name_map.items():
        if stored_key.endswith("/" + key) or stored_key == key:
            candidate = f"article:{stored_stem}"
            if node_ids is not None and candidate not in node_ids:
                return None
            return candidate
    return None


def make_article_like_id(stem: str, frontmatter: dict, rel: Path, profile: str) -> tuple[str, str, str | None]:
    """Return node id, node type, and subtype for a wiki markdown page."""
    page_type = str(frontmatter.get("type", "")).strip().lower()
    source_type = str(frontmatter.get("source_type", "")).strip().lower()
    first_dir = rel.parts[0].lower() if len(rel.parts) > 1 else ""

    if profile == PROFILE_PRD_WIKI:
        if page_type == "testcase" or source_type == "testcase" or first_dir == "testcases":
            return f"testcase:{stem}", "testcase", "testcase_summary"
        if page_type == "summary" or source_type == "prd" or first_dir == "summaries":
            return f"requirement:{stem}", "requirement", "prd_summary"

    return f"article:{stem}", "article", None


def make_source_id(raw_root: Path, raw_file: Path) -> str:
    """Build a stable source node ID from a raw file path."""
    return f"source:{raw_file.relative_to(raw_root).with_suffix('').as_posix()}"


def source_subtype_for_raw(raw_root: Path, raw_file: Path) -> str:
    """Classify raw source files by their first raw/ path segment."""
    rel = raw_file.relative_to(raw_root)
    return rel.parts[0] if rel.parts else "raw"


def source_id_from_source_path(source_path: str) -> str | None:
    """Build a source ID from frontmatter source_path."""
    source_path = str(source_path or "").strip()
    if not source_path:
        return None
    path = Path(source_path)
    if path.parts and path.parts[0] == "raw":
        path = Path(*path.parts[1:])
    return f"source:{path.with_suffix('').as_posix()}"


def normalize_match_text(text: str) -> str:
    """Normalize text for conservative business/detail matching."""
    return re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "", str(text or "")).lower()


def is_raw_markdown_target(target: str) -> bool:
    """Return true when a local markdown link points at raw source material."""
    parts = Path(str(target or "").lstrip("/")).parts
    return "raw" in parts


def derive_business_from_pathish(value: str) -> str:
    """Derive business segment from raw/testcase paths or testcases filenames."""
    path = Path(str(value or ""))
    parts = path.parts
    if "raw" in parts:
        raw_idx = parts.index("raw")
        if len(parts) > raw_idx + 2 and parts[raw_idx + 1] in {"prd", "testcase"}:
            return parts[raw_idx + 2]
    if len(parts) >= 2 and parts[-2] == "testcases":
        stem = Path(parts[-1]).stem
        return re.split(r"[-_]", stem, maxsplit=1)[0]
    return ""


def derive_page_business(frontmatter: dict, rel: Path) -> str:
    """Prefer explicit frontmatter business, then derive from source_path or file path."""
    explicit = str(frontmatter.get("filename_business", "")).strip()
    if explicit:
        return explicit
    source_business = derive_business_from_pathish(str(frontmatter.get("source_path", "")))
    if source_business:
        return source_business
    return derive_business_from_pathish(rel.as_posix())


def _safe_relative_to(path: Path, parent: Path) -> Path | None:
    try:
        return path.relative_to(parent)
    except ValueError:
        return None


def _node_id_for_stem(stem: str, node_ids: set[str]) -> str | None:
    for prefix in ["requirement", "testcase", "article"]:
        node_id = f"{prefix}:{stem}"
        if node_id in node_ids:
            return node_id
    return None


def resolve_wikilink_to_node(target: str, name_map: dict[str, str], node_ids: set[str]) -> str | None:
    """Resolve a wikilink target to any known page-like node ID."""
    key = target.lower().strip()
    if key.startswith("-"):
        return None
    stem = name_map.get(key)
    if stem:
        return _node_id_for_stem(stem, node_ids)
    for stored_key, stored_stem in name_map.items():
        if stored_key.endswith("/" + key) or stored_key == key:
            return _node_id_for_stem(stored_stem, node_ids)
    return None


def resolve_markdown_target(
    current_rel: Path,
    target: str | None,
    wiki_root: Path,
    root: Path,
    name_map: dict[str, str],
    node_ids: set[str],
) -> str | None:
    """Resolve local markdown links to wiki page nodes or raw source nodes."""
    if not target or URI_SCHEME_RE.match(target):
        return None

    target_path, _fragment = split_link_fragment(target)
    if not target_path:
        return None

    direct_source_id = source_id_from_source_path(target_path)
    if target_path.startswith("raw/") and direct_source_id in node_ids:
        return direct_source_id

    raw_root = root / "raw"
    candidate_paths: list[Path]
    if target_path.startswith("/"):
        stripped = target_path.lstrip("/")
        candidate_paths = [wiki_root / stripped, root / stripped]
    else:
        candidate_paths = [
            wiki_root / current_rel.parent / target_path,
            root / target_path,
        ]

    for candidate in candidate_paths:
        resolved = candidate.resolve()
        raw_rel = _safe_relative_to(resolved, raw_root.resolve())
        if raw_rel is not None:
            source_id = f"source:{raw_rel.with_suffix('').as_posix()}"
            if source_id in node_ids:
                return source_id

        wiki_rel = _safe_relative_to(resolved, wiki_root.resolve())
        if wiki_rel is not None:
            stem = wiki_rel.with_suffix("").as_posix()
            node_id = _node_id_for_stem(stem, node_ids)
            if node_id:
                return node_id

    key = Path(target_path).with_suffix("").as_posix().lower()
    stem = name_map.get(key) or name_map.get(Path(key).name)
    if stem:
        return _node_id_for_stem(stem, node_ids)
    return None


def frontmatter_tags(frontmatter: dict) -> list[str]:
    """Normalize frontmatter tags from comma strings or inline arrays."""
    fm_tags = frontmatter.get("tags", "")
    if isinstance(fm_tags, list):
        return [t.strip() for t in fm_tags if t.strip()]
    return [t.strip() for t in str(fm_tags).split(",") if t.strip()]


def requirement_testcase_match(requirement: dict, testcase: dict) -> bool:
    """Conservatively infer coverage when business matches and titles/details overlap."""
    req_meta = requirement.get("knowledgeMeta", {})
    case_meta = testcase.get("knowledgeMeta", {})
    req_business = normalize_match_text(req_meta.get("business", ""))
    case_business = normalize_match_text(case_meta.get("business", ""))
    if not req_business or req_business != case_business:
        return False

    req_needles = [
        normalize_match_text(req_meta.get("detail", "")),
        normalize_match_text(requirement.get("name", "")),
    ]
    case_haystack = normalize_match_text(" ".join([
        testcase.get("name", ""),
        testcase.get("filePath", ""),
        case_meta.get("sourcePath", ""),
    ]))
    for needle in req_needles:
        if needle and needle in case_haystack:
            return True
    return False


def requirement_match_key(requirement: dict) -> str:
    """Return the normalized requirement detail/name used for coverage specificity."""
    meta = requirement.get("knowledgeMeta", {})
    detail = normalize_match_text(meta.get("detail", ""))
    if detail:
        return detail
    return normalize_match_text(requirement.get("name", ""))


def filter_specific_requirement_matches(requirements: list[dict]) -> list[dict]:
    """Drop shorter requirement candidates when a longer candidate contains them."""
    keyed = [(requirement, requirement_match_key(requirement)) for requirement in requirements]
    filtered = []
    for requirement, key in keyed:
        if not key:
            filtered.append(requirement)
            continue
        is_less_specific = any(
            key != other_key and key in other_key
            for _other_requirement, other_key in keyed
            if other_key
        )
        if not is_less_specific:
            filtered.append(requirement)
    return filtered


def parse_wiki(root: Path, profile_override: str = PROFILE_AUTO) -> dict:
    """Parse a Karpathy-pattern wiki and produce the scan manifest."""
    root = Path(root).resolve()
    detection = detect_format(root)
    if not detection["detected"]:
        print(json.dumps({"error": "Not a Karpathy-pattern wiki", "detection": detection}),
              file=sys.stderr)
        sys.exit(1)

    if profile_override != PROFILE_AUTO:
        detection["profile"] = profile_override
    profile = detection.get("profile", PROFILE_GENERIC)
    wiki_root = Path(detection["wiki_root"])
    raw_root = root / "raw"

    # Build name resolution map
    name_map = build_name_to_stem_map(wiki_root)

    # Find index.md and log.md
    index_path = wiki_root / "index.md"
    if not index_path.is_file():
        index_path = root / "index.md"
    log_path = wiki_root / "log.md"
    if not log_path.is_file():
        log_path = root / "log.md"

    # Parse index for categories
    categories = parse_index(index_path)
    log_entries = parse_log(log_path)

    # Build category lookup: wikilink target → category name
    category_lookup: dict[str, str] = {}
    for cat in categories:
        for article_target in cat["articles"]:
            category_lookup[article_target.lower()] = cat["name"]
            target_stem = Path(article_target).with_suffix("").as_posix()
            category_lookup[target_stem.lower()] = cat["name"]
            category_lookup[Path(target_stem).name.lower()] = cat["name"]

    # --- Build source nodes first so wiki pages can cite raw files ---
    nodes = []
    edges = []
    warnings = []
    stats = {"articles": 0, "sources": 0, "topics": 0, "wikilinks": 0, "unresolved": 0}
    source_ids: set[str] = set()

    if raw_root.is_dir():
        for raw_file in sorted(raw_root.rglob("*")):
            if raw_file.is_file() and not raw_file.name.startswith("."):
                rel_raw = raw_file.relative_to(root)
                ext = raw_file.suffix.lower()
                size_kb = raw_file.stat().st_size / 1024
                source_id = make_source_id(raw_root, raw_file)
                source_ids.add(source_id)
                source_subtype = source_subtype_for_raw(raw_root, raw_file)
                nodes.append({
                    "id": source_id,
                    "type": "source",
                    "subtype": source_subtype,
                    "name": raw_file.name,
                    "filePath": str(rel_raw),
                    "summary": f"Raw source ({ext or 'unknown'}, {size_kb:.0f} KB)",
                    "tags": ["raw", source_subtype, ext.lstrip(".") or "unknown"],
                    "complexity": "simple",
                    "knowledgeMeta": {
                        "profile": profile,
                        "subtype": source_subtype,
                    },
                })
                stats["sources"] += 1

    # --- Pre-compute page IDs (for cross-link resolution validation) ---
    page_infos = []
    page_node_ids: set[str] = set()

    for md_file in sorted(wiki_root.rglob("*.md")):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()

        # Skip infrastructure files only at wiki root level
        if rel.parent == Path(".") and rel.name.lower() in INFRA_FILES:
            continue

        text = md_file.read_text(encoding="utf-8", errors="replace")
        frontmatter = extract_frontmatter(text)
        node_id, node_type, subtype = make_article_like_id(stem, frontmatter, rel, profile)
        page_node_ids.add(node_id)
        page_infos.append({
            "md_file": md_file,
            "rel": rel,
            "stem": stem,
            "basename": md_file.stem,
            "text": text,
            "frontmatter": frontmatter,
            "node_id": node_id,
            "node_type": node_type,
            "subtype": subtype,
        })

    node_ids = source_ids | page_node_ids

    def add_edge(source: str, target: str | None, edge_type: str, weight: float) -> None:
        if target and source != target:
            edges.append({
                "source": source,
                "target": target,
                "type": edge_type,
                "direction": "forward",
                "weight": weight,
            })

    # --- Build page nodes and deterministic edges ---
    for info in page_infos:
        rel = info["rel"]
        stem = info["stem"]
        basename = info["basename"]
        text = info["text"]
        frontmatter = info["frontmatter"]
        node_id = info["node_id"]
        node_type = info["node_type"]
        subtype = info["subtype"]

        h1 = extract_h1(text)
        wikilinks = extract_wikilinks(text)
        markdown_links = extract_markdown_links(text)
        headings = extract_headings(text)
        code_langs = extract_code_blocks(text)
        summary = extract_first_paragraph(text)
        line_count = text.count("\n") + 1
        word_count = len(text.split())

        # Derive category from index.md lookup
        category = category_lookup.get(basename.lower(), "")
        if not category:
            # Try stem match
            category = category_lookup.get(stem.lower(), "")

        # Derive tags (deduplicated)
        tag_set: set[str] = set()
        if category:
            tag_set.add(category.lower())
        if rel.parent != Path("."):
            tag_set.add(str(rel.parent))
        tag_set.update(frontmatter_tags(frontmatter))
        tags = sorted(tag_set)

        # Complexity from wikilink density
        link_count = len(wikilinks) + len(markdown_links["internal"])
        if link_count > 15:
            complexity = "complex"
        elif link_count > 5:
            complexity = "moderate"
        else:
            complexity = "simple"

        source_type = frontmatter.get("source_type", "")
        source_path = frontmatter.get("source_path", "")
        business = derive_page_business(frontmatter, rel)
        month = frontmatter.get("filename_month", "")
        version = frontmatter.get("filename_version", "")
        detail = frontmatter.get("filename_detail", "")

        knowledge_meta = {
            "profile": profile,
            "wikilinks": [wl["target"] for wl in wikilinks],
            "markdownLinks": markdown_links["internal"],
            "externalLinks": markdown_links["external"],
            "sourceType": source_type,
            "sourcePath": source_path,
            "business": business,
            "month": month,
            "version": version,
            "detail": detail,
            "content": text,
        }
        if subtype:
            knowledge_meta["subtype"] = subtype
        if category:
            knowledge_meta["category"] = category

        nodes.append({
            "id": node_id,
            "type": node_type,
            **({"subtype": subtype} if subtype else {}),
            "name": frontmatter.get("title") or h1 or basename,
            "filePath": f"wiki/{rel}" if wiki_root != root else str(rel),
            "summary": summary or f"Wiki article: {h1 or basename}",
            "tags": tags,
            "complexity": complexity,
            "knowledgeMeta": knowledge_meta,
        })
        stats["articles"] += 1
        stats["wikilinks"] += len(wikilinks)

        # Build edges from wikilinks (resolve against known article IDs)
        for wl in wikilinks:
            target_id = resolve_wikilink_to_node(wl["target"], name_map, node_ids)
            if target_id:
                add_edge(node_id, target_id, "related", 0.7)
            elif not target_id:
                warnings.append(f"Unresolved wikilink: [[{wl['target']}]] in {rel}")
                stats["unresolved"] += 1

        # Build edges from local markdown links.
        for ml in markdown_links["internal"]:
            target_id = resolve_markdown_target(
                rel,
                ml["target"],
                wiki_root,
                root,
                name_map,
                node_ids,
            )
            if not target_id:
                if ml["target"]:
                    warnings.append(f"Unresolved markdown link: {ml['target']} in {rel}")
                    stats["unresolved"] += 1
                continue
            if target_id.startswith("source:"):
                add_edge(node_id, target_id, "cites", 0.8)
            else:
                add_edge(node_id, target_id, "related", 0.7)

        # Frontmatter source_path is an explicit citation.
        if source_path:
            source_id = source_id_from_source_path(source_path)
            if source_id in node_ids:
                add_edge(node_id, source_id, "cites", 0.9)
            else:
                warnings.append(f"Missing source_path target: {source_path} in {rel}")

    # --- Build topic nodes from index.md categories ---
    for cat in categories:
        topic_id = f"topic:{cat['name'].lower().replace(' ', '-')}"
        nodes.append({
            "id": topic_id,
            "type": "topic",
            "name": cat["name"],
            "summary": f"Category from index: {cat['name']} ({len(cat['articles'])} articles)",
            "tags": ["category"],
            "complexity": "simple",
        })
        stats["topics"] += 1

        # categorized_under edges (only resolve to known article nodes)
        for article_target in cat["articles"]:
            article_id = resolve_wikilink_to_node(article_target, name_map, node_ids)
            if not article_id:
                article_id = resolve_markdown_target(
                    Path("index.md"),
                    article_target,
                    wiki_root,
                    root,
                    name_map,
                    node_ids,
                )
            if article_id:
                add_edge(article_id, topic_id, "categorized_under", 0.6)

    # --- Build explicit requirement -> testcase coverage edges ---
    node_type_by_id = {node["id"]: node["type"] for node in nodes}
    for edge in list(edges):
        if edge["type"] != "related":
            continue
        source_type = node_type_by_id.get(edge["source"])
        target_type = node_type_by_id.get(edge["target"])
        if source_type == "requirement" and target_type == "testcase":
            add_edge(edge["source"], edge["target"], "tested_by", 0.9)
        elif source_type == "testcase" and target_type == "requirement":
            add_edge(edge["target"], edge["source"], "tested_by", 0.9)

    requirements = [node for node in nodes if node["type"] == "requirement"]
    testcases = [node for node in nodes if node["type"] == "testcase"]
    for testcase in testcases:
        matched_requirements = [
            requirement
            for requirement in requirements
            if requirement_testcase_match(requirement, testcase)
        ]
        for requirement in filter_specific_requirement_matches(matched_requirements):
            add_edge(requirement["id"], testcase["id"], "tested_by", 0.85)

    # --- Compute backlinks ---
    backlink_map: dict[str, list[str]] = {}
    for edge in edges:
        if edge["type"] == "related":
            target = edge["target"]
            source = edge["source"]
            backlink_map.setdefault(target, []).append(source)
    for node in nodes:
        if node["type"] in {"article", "requirement", "testcase"} and "knowledgeMeta" in node:
            bl = backlink_map.get(node["id"], [])
            node["knowledgeMeta"]["backlinks"] = bl

    # --- Deduplicate edges ---
    seen_edges: set[tuple[str, str, str]] = set()
    deduped_edges = []
    for edge in edges:
        key = (edge["source"], edge["target"], edge["type"])
        if key not in seen_edges:
            seen_edges.add(key)
            deduped_edges.append(edge)

    return {
        "format": "karpathy",
        "profile": detection["profile"],
        "stats": stats,
        "categories": [{"name": c["name"], "count": len(c["articles"])} for c in categories],
        "logEntries": len(log_entries),
        "nodes": nodes,
        "edges": deduped_edges,
        "warnings": warnings[:50],  # Cap warnings
    }


def parse_cli_args(argv: list[str]) -> tuple[Path, str]:
    profile = PROFILE_AUTO
    root_arg = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--profile":
            if i + 1 >= len(argv):
                print("Error: --profile requires auto, generic, or prd-wiki", file=sys.stderr)
                sys.exit(1)
            profile = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--profile="):
            profile = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("--"):
            print(f"Error: Unknown option {arg}", file=sys.stderr)
            sys.exit(1)
        if root_arg is not None:
            print(f"Error: Unexpected path argument {arg}", file=sys.stderr)
            sys.exit(1)
        root_arg = arg
        i += 1

    if root_arg is None:
        print("Usage: parse-knowledge-base.py <wiki-directory> [--profile auto|generic|prd-wiki]", file=sys.stderr)
        sys.exit(1)
    if profile not in {PROFILE_AUTO, PROFILE_GENERIC, PROFILE_PRD_WIKI}:
        print("Error: --profile must be auto, generic, or prd-wiki", file=sys.stderr)
        sys.exit(1)
    return Path(root_arg).resolve(), profile


def main():
    root, profile_override = parse_cli_args(sys.argv[1:])
    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    manifest = parse_wiki(root, profile_override=profile_override)

    # Write output
    out_dir = root / ".understand-anything" / "intermediate"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "scan-manifest.json"
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    assembled_graph = load_merge_module().merge(root)
    output_dir = root / ".understand-anything"
    final_graph_path = output_dir / "knowledge-graph.json"
    final_graph_path.write_text(
        json.dumps(assembled_graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # Report to stderr
    s = manifest["stats"]
    print(f"[parse] Karpathy wiki: {s['articles']} articles, {s['sources']} sources, "
          f"{s['topics']} topics, {s['wikilinks']} wikilinks "
          f"({s['unresolved']} unresolved)", file=sys.stderr)
    print(f"[parse] Output: {out_path}", file=sys.stderr)
    print(f"[parse] Final graph: {final_graph_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
