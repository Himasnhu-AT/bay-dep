#!/usr/bin/env python3
"""Generate references/tools.md from the MCP tool schemas.

The tool list in the skill used to be written by hand, and by the time anyone read it the
argument names had moved. This reads `rust/crates/bay-mcp/src/tools.rs` — the same
`definitions()` the server advertises — so the reference cannot drift from the surface.

It emits NAMES ONLY: no defaults, no example values. A default printed in the skill is a
default the agent copies (measured: 72 of 73 text elements in the video this rewrite exists
because of took a value the skill had printed). The live schema carries the descriptions and
the defaults; that is where they belong.

Usage:  python3 .claude/skills/bay/gen-tools.py [path/to/tools.rs]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SOURCE = REPO / "rust" / "crates" / "bay-mcp" / "src" / "tools.rs"
OUTPUT = HERE / "references" / "tools.md"


def read_string(src: str, i: int) -> tuple[str, int]:
    """Read one Rust string literal starting at the opening quote."""
    assert src[i] == '"', src[i : i + 20]
    out: list[str] = []
    i += 1
    while i < len(src):
        ch = src[i]
        if ch == "\\":
            nxt = src[i + 1]
            if nxt == "\n":  # line continuation: newline and indent are dropped
                i += 2
                while i < len(src) and src[i] in " \t":
                    i += 1
                continue
            out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, nxt))
            i += 2
            continue
        if ch == '"':
            return "".join(out), i + 1
        out.append(ch)
        i += 1
    raise ValueError("unterminated string literal")


def match_braces(src: str, i: int) -> tuple[str, int]:
    """Return the text inside the {...} starting at `i`, and the index past its close."""
    assert src[i] == "{"
    depth, start = 0, i
    while i < len(src):
        ch = src[i]
        if ch == '"':
            _, i = read_string(src, i)
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return src[start + 1 : i], i + 1
        i += 1
    raise ValueError("unterminated brace block")


def top_level_keys(block: str) -> list[str]:
    """Keys at depth 0 of a json! object body."""
    keys: list[str] = []
    depth, i, expect_key = 0, 0, True
    while i < len(block):
        ch = block[i]
        if ch == '"':
            value, j = read_string(block, i)
            if depth == 0 and expect_key:
                keys.append(value)
                expect_key = False
            i = j
            continue
        if ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        elif ch == "," and depth == 0:
            expect_key = True
        i += 1
    return keys


def fragment_keys(src: str, fn: str) -> list[str]:
    at = src.index(f"fn {fn}() -> Value {{")
    at = src.index("json!({", at) + len("json!(")
    body, _ = match_braces(src, at)
    return top_level_keys(body)


def parse(src: str) -> list[dict]:
    fragments = {
        "visual_properties": fragment_keys(src, "visual_properties"),
        "caption_properties": fragment_keys(src, "caption_properties"),
    }
    tools: list[dict] = []
    cursor = src.index("pub fn definitions()")
    pattern = re.compile(r"\btool\(\s*\"")
    while (m := pattern.search(src, cursor)) is not None:
        i = m.end() - 1
        name, i = read_string(src, i)
        while src[i] in ", \n":
            i += 1
        description, i = read_string(src, i)
        # the schema argument: json!({...}) or merge(json!({...}), <fragment>())
        merged = src[i : i + 40].lstrip(", \n\t").startswith("merge(")
        j = src.index("json!(", i) + len("json!(")
        body, after = match_braces(src, j)
        props = top_level_keys(body)
        if merged:
            tail = src[after : src.index("&[", after)]
            for fragment, keys in fragments.items():
                if fragment in tail:
                    props += keys
        req_start = src.index("&[", after)
        req_end = src.index("]", req_start)
        required = re.findall(r'"([^"]+)"', src[req_start:req_end])
        tools.append(
            {
                "name": name,
                "summary": description.split(". ")[0].rstrip(".").replace("|", "/"),
                "required": required,
                "optional": [p for p in props if p not in required],
            }
        )
        cursor = req_end
    return tools


def render(tools: list[dict]) -> str:
    lines = [
        "# Tools",
        "",
        "**Generated — do not hand-edit.** `python3 .claude/skills/bay/gen-tools.py` reads",
        "`rust/crates/bay-mcp/src/tools.rs` and rewrites this file. Regenerate it whenever the tool",
        "surface changes; a hand-maintained copy of an argument list is wrong within a week.",
        "",
        "Argument **names** only. The live schema your client already holds carries the types, the",
        "descriptions and the defaults — read it there, per call. Nothing in this skill prints a",
        "default value, because a printed default is the value that comes back.",
        "",
        "The tool prefix is whatever name the server was registered under (`mcp__bay__…`,",
        "`mcp__vii__…`). Every tool is written bare here for that reason.",
        "",
        f"{len(tools)} tools.",
        "",
        "| tool | required | also takes |",
        "|---|---|---|",
    ]
    for t in tools:
        req = ", ".join(f"`{p}`" for p in t["required"]) or "—"
        opt = ", ".join(f"`{p}`" for p in t["optional"]) or "—"
        lines.append(f"| **{t['name']}** — {t['summary']} | {req} | {opt} |")
    lines += [
        "",
        "Two facts the table cannot show:",
        "",
        "- **`render`, `narrate`, `subtitles_to_video` and `shots_detect` answer with a job id.**",
        "  Poll `job_status` with it until `finished` is true, then read `result`. `job_cancel`",
        "  stops one. Everything else answers in a single call.",
        "- **bay has no scene object.** No tool creates, splits or selects one; a project is one",
        "  scene however long it runs. Structure is expressed in time — see",
        "  [structure.md](structure.md) — not in a container.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    tools = parse(source.read_text())
    OUTPUT.write_text(render(tools))
    print(f"{OUTPUT}: {len(tools)} tools, {len(render(tools).splitlines())} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
