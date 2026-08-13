#!/usr/bin/env python3
"""Check a card script before it costs a build.

Three things go wrong when you write cards for the music grid, and all three are cheaper to catch
here than after a five-minute render:

1. **A line too long for its chip.** The red plate is sized from a measured advance table; past
   about 25 characters at the `chrome` tier it is wider than the frame.
2. **A content word repeated across consecutive beats.** `check`'s continuity rule reads a word
   that appears in two beats as two different elements as a *rebuild* rather than a carry, and
   reports `broken-continuity` — an error, so the render is refused. This fired three times on
   the first draft of the 1929 script, on "1929" and twice on "fell".
3. **Beats that do not sum to the length of the track.** 115 at 138 BPM.

    python3 audit_cards.py cards1929.json
"""
import json
import re
import sys

TRACK_BEATS = 115
MAX_CHIP = 0.80          # fraction of canvas width, including the chip's own padding
CHIP_PAD = 0.044

# The `chrome` tier, measured off a calibration frame. Same numbers as build1929.py.
ADVANCE = {"upper": 0.0360, "lower": 0.0310, "space": 0.0150, "punct": 0.0140}

# Four characters is the floor the continuity rule uses for a content word, plus a short stop
# list so "the" appearing twice is not treated as a correspondence claim.
STOP = {"the", "and", "for", "was", "were", "that", "this", "with", "from", "have",
        "has", "had", "not", "but", "its", "are", "you", "out", "one", "next"}


def text_width(line):
    total = 0.0
    for ch in line:
        if ch == " ":
            total += ADVANCE["space"]
        elif ch.isupper() or ch.isdigit():
            total += ADVANCE["upper"]
        elif ch.isalpha():
            total += ADVANCE["lower"]
        else:
            total += ADVANCE["punct"]
    return total


def content_words(card):
    out = set()
    for line in card["show"]:
        for token in re.findall(r"[A-Za-z0-9]+", line):
            lowered = token.lower()
            if token.isdigit():
                if len(token) >= 3:
                    out.add(lowered)
            elif len(token) >= 4 and lowered not in STOP:
                out.add(lowered)
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "cards1929.json"
    spec = json.loads(open(path).read())
    cards = spec["cards"]
    problems = 0

    total = sum(c["beats"] for c in cards)
    if total != TRACK_BEATS:
        print(f"BEATS  sum to {total}, not {TRACK_BEATS} — the last card will not land on the "
              f"last beat of the track")
        problems += 1

    for i, card in enumerate(cards):
        for line in card["show"]:
            width = text_width(line) + CHIP_PAD
            if width > MAX_CHIP:
                print(f"WIDE   card {i:2}: chip {width:.3f} of the frame — {line!r} "
                      f"({len(line)} chars)")
                problems += 1

    # Beats are the marked cards; each beat spans from its mark to the next.
    marks = [i for i, c in enumerate(cards) if c.get("mark")] + [len(cards)]
    spans = [(marks[k], marks[k + 1]) for k in range(len(marks) - 1)]
    for (a, b), (c, e) in zip(spans, spans[1:]):
        first = set().union(*(content_words(cards[i]) for i in range(a, b)))
        second = set().union(*(content_words(cards[i]) for i in range(c, e)))
        shared = first & second
        if shared:
            print(f"SHARED beat@{a} and beat@{c} both use {sorted(shared)} — reword one, or "
                  f"check will report broken-continuity and refuse the render")
            problems += 1

    print("clean" if not problems else f"{problems} problem(s)")
    return 1 if problems else 0


sys.exit(main())
