"""Generate references/tools.md from the MCP tool schemas.

The tool list in the skill used to be written by hand, and by the time anyone read it the
argument names had moved. This runs bay-mcp's `dump_tools` example, which serializes the same
`definitions()` the server advertises, so nested schema merges and helper functions cannot drift
from the generated reference.

It emits NAMES ONLY: no defaults, no example values. A default printed in the skill is a
default the agent copies (measured: 72 of 73 text elements in the video this rewrite exists
because of took a value the skill had printed). The live schema carries the descriptions and
the defaults; that is where they belong.

Usage:  python3 skills/bay/gen-tools.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
RUST = REPO / "rust"
OUTPUT = HERE / "references" / "tools.md"
NATIVE_OUTPUT = REPO / "docs" / "native" / "tools.md"
COUNT_FILES = [
    REPO / "docs" / "native" / "editor-capability-audit.md",
    REPO / "docs" / "native" / "reel-recipe.md",
]


def definitions() -> list[dict]:
    """Load the live schemas from Rust's source-of-truth function."""
    process = subprocess.run(
        ["cargo", "run", "--quiet", "-p", "bay-mcp", "--example", "dump_tools"],
        cwd=RUST,
        check=True,
        capture_output=True,
        text=True,
    )
    tools = json.loads(process.stdout)
    if not isinstance(tools, list):
        raise TypeError("dump_tools did not return a JSON array")
    return tools


def parse(definitions: list[dict]) -> list[dict]:
    tools: list[dict] = []
    for definition in definitions:
        schema = definition["inputSchema"]
        props = list(schema.get("properties", {}))
        required = schema.get("required", [])
        description = " ".join(definition["description"].split())
        tools.append(
            {
                "name": definition["name"],
                "summary": description.split(". ", 1)[0].rstrip(".").replace("|", "/"),
                "required": required,
                "optional": [p for p in props if p not in required],
            }
        )
    return tools


def render(tools: list[dict]) -> str:
    lines = [
        "# Tools",
        "",
        "**Generated — do not hand-edit.** `python3 .claude/skills/bay/gen-tools.py` reads",
        "the JSON emitted by bay-mcp's `dump_tools` example and rewrites this file. Regenerate it",
        "whenever the tool surface changes; a hand-maintained argument list is wrong within a week.",
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
        "- **`render`, `narrate`, `subtitles_to_video`, `shots_detect`, `media_index`,",
        "  `auto_reframe`, and `diarize` answer with a job id.**",
        "  Poll `job_status` with it until `finished` is true, then read `result`. `job_cancel`",
        "  stops one. Everything else answers in a single call.",
        "- **bay has no scene object.** No tool creates, splits or selects one; a project is one",
        "  scene however long it runs. Structure is expressed in time — see",
        "  [structure.md](structure.md) — not in a container.",
        "",
    ]
    return "\n".join(lines)


def update_counts(count: int) -> None:
    marker = re.compile(
        r"<!-- bay-tool-count -->\d+<!-- /bay-tool-count -->"
    )
    replacement = f"<!-- bay-tool-count -->{count}<!-- /bay-tool-count -->"
    for path in COUNT_FILES:
        text = path.read_text()
        rewritten, changes = marker.subn(replacement, text)
        if changes == 0:
            raise ValueError(f"{path} has no generated tool-count marker")
        path.write_text(rewritten)


def main() -> int:
    if len(sys.argv) != 1:
        raise SystemExit("usage: python3 skills/bay/gen-tools.py")
    tools = parse(definitions())
    rendered = render(tools)
    for output in [OUTPUT, NATIVE_OUTPUT]:
        output.write_text(rendered)
        print(f"{output}: {len(tools)} tools, {len(rendered.splitlines())} lines")
    update_counts(len(tools))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
