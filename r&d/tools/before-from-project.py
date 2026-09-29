#!/usr/bin/env python3
"""The "before" of a bay edit: the raw footage, cut on the edit's own frames.

    before-from-project.py <project.bay | project name> <out.mp4> [--list]

For every frame of the project's active timeline it renders the raw source picture and sound
the edit shows at that moment: the same spans, in the same order, at the same durations. The
picture is the source's own full frame scaled to fit the edit's canvas and padded black, with
no punch-in, crop, overlay, graphic, transition or grade. The sound is the same span's own
audio, unmastered and at its recorded level. A frame with no base clip is black and silent.

This is what the website's /compare page needs: both videos one length and cut on the same
frames, because it plays them on one clock (website/src/lib/comparisons.ts).

The base picture, per frame: the lowest video track (not hidden) with an enabled clip of a
video asset covering that frame; a disabled clip is skipped, so a switched angle falls
through to whichever clip is visible. If no video track holds any video-asset clip (a
kinetic-type piece whose picture was dropped and whose voice sits on an audio track), the
audio tracks' video-asset clips are used instead, so the before shows the person speaking.

Timeline time is frames at the timeline's fps; `sourceStartUs` is microseconds into the
source; a clip's source advances `speed` times as fast as the timeline. `--list` prints the
segments and renders nothing. A project name is looked up in ~/Movies/bay by its "name".

Uses Homebrew ffmpeg (/opt/homebrew/bin/ffmpeg, or $FFMPEG). The output's frame count is
asserted equal to the timeline's before the script exits 0.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

FFMPEG = os.environ.get("FFMPEG", "/opt/homebrew/bin/ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "/opt/homebrew/bin/ffprobe")
PROJECTS = Path.home() / "Movies" / "bay"


def load(arg):
    p = Path(arg).expanduser()
    if p.suffix == ".bay" and p.is_file():
        return json.loads(p.read_text()), p
    hits = []
    for f in sorted(PROJECTS.glob("*.bay")):
        try:
            d = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        if d.get("name", "").lower() == arg.lower():
            hits.append((d, f))
    if len(hits) != 1:
        names = ", ".join(str(f.name) for _, f in hits) or "none"
        sys.exit(f"{len(hits)} projects in {PROJECTS} are named {arg!r} ({names}); pass the .bay path")
    return hits[0]


def as_list(x):
    return list(x.values()) if isinstance(x, dict) else list(x or [])


def segments(project):
    assets = {a["id"]: a for a in as_list(project["assets"])}
    tl = next(t for t in as_list(project["timelines"]) if t["id"] == project["activeTimelineId"])
    fps = tl["fps"]
    tracks = [t for t in tl["tracks"] if not t.get("hidden")]

    def picture(item):
        a = assets.get(item.get("assetId"))
        return bool(a) and a.get("kind") == "video" and not item.get("disabled")

    video = [t for t in tracks if t["kind"] == "video" and any(picture(i) for i in t["items"])]
    base = video or [t for t in tracks if t["kind"] == "audio" and any(picture(i) for i in t["items"])]
    if not base:
        sys.exit("no clip of a video asset on any track: nothing to take the before from")

    length = max((i["from"] + i["durationInFrames"] for t in tl["tracks"] for i in t["items"]), default=0)

    def at(f):
        for t in base:
            for i in t["items"]:
                if picture(i) and i["from"] <= f < i["from"] + i["durationInFrames"]:
                    return i
        return None

    # Runs of consecutive frames showing one clip; a run is contiguous in its source by construction.
    out = []
    for f in range(length):
        item = at(f)
        if out and out[-1]["item"] is item:
            out[-1]["frames"] += 1
        else:
            out.append({"item": item, "start": f, "frames": 1})
    for s in out:
        i = s["item"]
        if i is None:
            continue
        speed = i.get("speed") or 1
        s["asset"] = assets[i["assetId"]]
        s["speed"] = speed
        s["sourceStart"] = i["sourceStartUs"] / 1e6 + (s["start"] - i["from"]) / fps * speed
    return tl, fps, length, out


def atempo(speed):
    chain, s = [], speed
    while s > 2:
        chain.append("atempo=2")
        s /= 2
    while s < 0.5:
        chain.append("atempo=0.5")
        s /= 0.5
    chain.append(f"atempo={s:.6f}")
    return ",".join(chain)


def render(tl, fps, length, segs, out):
    w, h = tl["width"], tl["height"]
    fit = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p"
    )
    args, graph, labels = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"], [], []
    for k, s in enumerate(segs):
        n = s["frames"]
        secs = n / fps
        if s["item"] is None:
            graph.append(f"color=c=black:s={w}x{h}:r={fps}:d={secs + 1},format=yuv420p,trim=end_frame={n},setpts=N/({fps}*TB)[v{k}]")
            graph.append(f"anullsrc=r=48000:cl=stereo,atrim=end={secs:.6f}[a{k}]")
        else:
            src = len([a for a in args if a == "-i"])
            speed = s["speed"]
            span = secs * speed
            # Seek `pre` early: ffmpeg's accurate seek drops every frame before the seek point,
            # including the one on screen at it, which put the whole before one frame ahead of
            # the edit (measured on Retention short). Timestamps stay relative to the seek point,
            # so the span starts at `pre`, and `fps` with round=down shows at each timeline frame
            # the latest source frame at or before it, as bay's compositor does.
            pre = min(0.5, s["sourceStart"])
            args += ["-ss", f"{s['sourceStart'] - pre:.6f}", "-t", f"{pre + span + 1:.6f}", "-i", s["asset"]["path"]]
            # Exactly n frames at the timeline's rate: resample, then hold the last if short.
            graph.append(
                f"[{src}:v]setpts=PTS/{speed},fps={fps}:start_time={pre / speed:.6f}:round=down,{fit},"
                f"tpad=stop={n}:stop_mode=clone,trim=end_frame={n},setpts=N/({fps}*TB)[v{k}]"
            )
            if s["asset"].get("hasAudio"):
                tempo = "" if speed == 1 else atempo(speed) + ","
                graph.append(
                    f"[{src}:a]atrim=start={pre:.6f},asetpts=PTS-STARTPTS,{tempo}aresample=48000,"
                    f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
                    f"apad=whole_dur={secs:.6f},atrim=end={secs:.6f},asetpts=N/SR/TB[a{k}]"
                )
            else:
                graph.append(f"anullsrc=r=48000:cl=stereo,atrim=end={secs:.6f}[a{k}]")
        labels.append(f"[v{k}][a{k}]")
    graph.append(f"{''.join(labels)}concat=n={len(segs)}:v=1:a=1[v][a]")
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as g:
        g.write(";\n".join(graph))
    tmp = str(Path(out).with_suffix(".part.mp4"))
    args += [
        "-/filter_complex", g.name, "-map", "[v]", "-map", "[a]",
        "-r", str(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp,
    ]
    subprocess.run(args, check=True)
    os.unlink(g.name)
    got = int(subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", tmp],
        check=True, capture_output=True, text=True,
    ).stdout.strip())
    if got != length:
        os.unlink(tmp)
        sys.exit(f"rendered {got} frames, the timeline has {length}; nothing written")
    os.replace(tmp, out)
    return got


def main():
    argv = [a for a in sys.argv[1:] if a != "--list"]
    if len(argv) != 2:
        sys.exit(__doc__.split("\n\n")[1])
    project, path = load(argv[0])
    tl, fps, length, segs = segments(project)
    print(f"{project['name']} ({path.name}): {length} frames at {fps} fps, {tl['width']}x{tl['height']}, {len(segs)} segments")
    for s in segs:
        where = "black" if s["item"] is None else f"{Path(s['asset']['path']).name} @ {s['sourceStart']:.3f}s x{s['speed']}"
        print(f"  {s['start']:>6} +{s['frames']:<5} {where}")
    if "--list" in sys.argv:
        return
    got = render(tl, fps, length, segs, argv[1])
    print(f"wrote {argv[1]}: {got} frames (timeline {length})")


if __name__ == "__main__":
    main()
