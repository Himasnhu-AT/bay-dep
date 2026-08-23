#!/usr/bin/env python3
"""Fail if this skill prints a value an agent could copy as a default.

The measurement this exists for: of 73 text elements in the video that caused this rewrite, 72
were set SMALLER than the tool's own default, every one of them a size the skill had printed;
the gutter, the box scale, the ground colour, the type colour, the mono family and all seven
palette hexes are lines of the old `layout.md` and `recipes.md` reproduced exactly. A value in a
fenced block is not an illustration. It is the answer.

So: no fenced block in this skill may contain a hex colour, a float in [0,1], a plausible font
size, or a font family name. Write the SHAPE of the call and let the schema carry the values.

Exempt, deliberately: URLs, ports and IP addresses (an address is not a design value), and
`references/tools.md`, which is generated from the schema and holds argument names only.

Usage:  python3 .claude/skills/bay/lint-skill.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GENERATED = {"tools.md"}

FENCE = re.compile(r"^\s*(```|~~~)")
ADDRESS = re.compile(r"https?://\S+|\b\d{1,3}(?:\.\d{1,3}){3}\b|:\d{2,5}\b")

# Families that ship on macOS, plus the ones the deleted files recommended by name. A named
# family is a chosen family: `Menlo` appeared as a literal in five files and came back on 69 of
# 73 text elements, while `spring-out` — named in prose in five places and never shown as a
# value — came back 4 times in 188 elements.
FAMILIES = """
American Typewriter, Andale Mono, Arial, Athelas, Avenir, Avenir Next, Baskerville, Big Caslon,
Bodoni, Bradley Hand, Brush Script, Chalkboard, Chalkduster, Charter, Cochin, Comic Sans,
Copperplate, Courier, Courier New, Didot, Futura, Geneva, Georgia, Gill Sans, Helvetica,
Helvetica Neue, Herculanum, Hiragino, Hoefler Text, Impact, Iowan Old Style, Lucida Grande,
Marker Felt, Menlo, Monaco, Noteworthy, Optima, Palatino, Papyrus, PingFang, PT Mono, PT Sans,
Rockwell, San Francisco, Savoye, Seravek, SF Mono, SF Pro, SignPainter, Skia, Snell Roundhand,
Superclarendon, Tahoma, Times, Times New Roman, Trattatello, Trebuchet, Verdana, Zapfino
"""
FAMILY = re.compile(
    "|".join(sorted((re.escape(f.strip()) for f in FAMILIES.split(",")), key=len, reverse=True))
)

HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
FLOAT = re.compile(r"(?<![\w.])\d*\.\d+")
INTEGER = re.compile(r"(?<![\w.])\d+(?![\w.])")


def offences(line: str) -> list[str]:
    """What a single line of a fenced block is not allowed to say."""
    clean = ADDRESS.sub(" ", line)
    found = []
    if m := HEX.search(clean):
        found.append(f"hex colour {m.group()}")
    for m in FLOAT.finditer(clean):
        if 0.0 <= float(m.group()) <= 1.0:
            found.append(f"float in [0,1] {m.group()}")
    for m in INTEGER.finditer(clean):
        # A plausible point size. Canvas dimensions and frame rates are not font sizes, but a
        # bare number in this band inside a code block reads as one, so the band is wide.
        if 8 <= int(m.group()) <= 400:
            found.append(f"font-size-shaped integer {m.group()}")
    if m := FAMILY.search(clean):
        found.append(f"font family {m.group()!r}")
    return found


def check(path: Path) -> list[str]:
    problems: list[str] = []
    inside = False
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        if FENCE.match(line):
            inside = not inside
            continue
        if not inside:
            continue
        for offence in offences(line):
            problems.append(f"{path}:{number}: {offence} — in a fenced block: {line.strip()!r}")
    if inside:
        problems.append(f"{path}: unclosed fenced block")
    return problems


def main() -> int:
    files = [p for p in sorted(HERE.rglob("*.md")) if p.name not in GENERATED]
    problems = [problem for path in files for problem in check(path)]
    for problem in problems:
        print(problem)
    print(f"lint-skill: {len(files)} files, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
