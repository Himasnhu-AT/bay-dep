#!/usr/bin/env python3
"""bay-kokoro — a Kokoro text-to-speech sidecar for bay.

Same shape as the transcription sidecar in the meeting assistant, and the same reason: the
model runtime (Python + torch, ~2 GB) never links into the editor. This process loads Kokoro
once, holds it hot, and answers loopback HTTP; bay spawns it on demand and talks to it.

    GET  /health   -> {"status": "ok", "sampleRate": 24000, ...}
    GET  /voices   -> {"voices": {...}}
    POST /speak    <- {"text": ..., "voice": ..., "speed": 1.0, "langCode": "a",
                       "outPath": "/abs/path.wav", "peakDb": -2.0}
                   -> {"path": ..., "durationSeconds": ..., "sampleRate": 24000,
                       "words": [{"text": ..., "start": ..., "end": ...}, ...]}

Auth: every request must carry `Authorization: Bearer $BAY_KOKORO_TOKEN`. Binding to loopback
is not treated as authentication — any local process could otherwise drive it.

Lifecycle: supervised three ways, most exact first — the parent pipe (`BAY_KOKORO_PARENT_PIPE`),
the parent pid (`BAY_KOKORO_PARENT_PID`), and an idle timeout (`BAY_KOKORO_IDLE_TIMEOUT`). A
crashed editor cannot leave a multi-gigabyte model resident, and a sidecar with none of them
armed says so on stderr rather than running silently forever.

Weights: `--model-dir` points at the files bay provisioned, so nothing is fetched at speak time.

Usage:
    BAY_KOKORO_TOKEN=secret bay-kokoro.py --port 7334 [--host 127.0.0.1]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SAMPLE_RATE = 24_000

# How long the sidecar sits with no requests before exiting. Half an hour keeps a hot model
# around across a working session while bounding how long an orphan can hold the port.
DEFAULT_IDLE_TIMEOUT = 1800

# Kokoro's published voice set, grouped by the lang_code that can speak them. bay pins and
# downloads every one of these, so with --model-dir this is also exactly what is on disk.
VOICES = {
    "a": ["af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
          "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam",
          "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
          "am_puck", "am_santa"],
    "b": ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable",
          "bm_george", "bm_lewis"],
    "e": ["ef_dora", "em_alex", "em_santa"],
    "f": ["ff_siwis"],
    "h": ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
    "i": ["if_sara", "im_nicola"],
    "j": ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"],
    "p": ["pf_dora", "pm_alex", "pm_santa"],
    "z": ["zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian",
          "zm_yunxi", "zm_yunxia", "zm_yunyang"],
}

_pipelines: dict[str, object] = {}
_lock = threading.Lock()
_model = None
# Set from --model-dir. When present, weights are read from disk and nothing is fetched.
MODEL_DIR: str | None = None


def _local_model():
    """Build the KModel once from the weights bay provisioned."""
    global _model
    if _model is None:
        from kokoro import KModel

        _model = KModel(
            config=os.path.join(MODEL_DIR, "config.json"),
            model=os.path.join(MODEL_DIR, "kokoro-v1_0.pth"),
        )
    return _model


def is_known_voice(voice: str) -> bool:
    """Is this one of the voices bay actually ships?"""
    return any(voice in names for names in VOICES.values())


def voice_path(voice: str) -> str | None:
    """Where a voice's tensor lives on disk, if bay provisioned it.

    kokoro's `load_single_voice` takes a path directly when it ends in `.pt`, so handing it one
    is all it takes to keep it off the Hub.

    The name is checked against the catalogue first. It arrives from the request body, and
    joining it into a path unchecked made `../../..` reach outside MODEL_DIR — which is a
    file-existence oracle and an arbitrary local tensor load, neither of which narration needs.
    """
    if not MODEL_DIR or not is_known_voice(voice):
        return None
    path = os.path.join(MODEL_DIR, "voices", f"{voice}.pt")
    return path if os.path.isfile(path) else None


def pipeline_for(lang_code: str):
    """Build (once) and return the KPipeline for a language code.

    With `--model-dir` the weights come from disk: bay pins and downloads them like every other
    artifact, so `runtime_install speech` reports one number that covers everything and the
    first narration does not silently fetch ~339 MB with no progress bar. Without it, the old
    behaviour — fetch from the Hub on first use — still works, which is what keeps an existing
    install running.
    """
    with _lock:
        if lang_code not in _pipelines:
            from kokoro import KPipeline

            if MODEL_DIR:
                _pipelines[lang_code] = KPipeline(lang_code=lang_code, model=_local_model())
            else:
                _pipelines[lang_code] = KPipeline(
                    lang_code=lang_code, repo_id="hexgrad/Kokoro-82M"
                )
        return _pipelines[lang_code]


def write_wav(path: str, samples, peak_db: float | None = None) -> float:
    """Write float samples in [-1, 1] as 16-bit PCM. Returns the duration in seconds.

    `peak_db` normalizes the utterance to that peak in dBFS. Kokoro's raw output varies about
    5 dB from line to line (measured: -4.5 to -9.8 dBFS across six lines of one script), which
    is audible as uneven delivery and makes any fixed mix gain either too quiet or clipping.
    Normalizing per utterance makes the level predictable, so a caller can set one voice gain
    and trust it.
    """
    import numpy as np

    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    if peak_db is not None:
        current = float(np.max(np.abs(audio))) if audio.size else 0.0
        # Silence has no peak to normalize, and scaling it would only amplify noise.
        if current > 1e-6:
            target = 10.0 ** (peak_db / 20.0)
            audio = audio * (target / current)
    # Clip before scaling: a sample above 1.0 would wrap to a loud negative click in int16.
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())
    return len(pcm) / float(SAMPLE_RATE)


def synthesize(
    text: str,
    voice: str,
    speed: float,
    lang_code: str,
    out_path: str,
    peak_db: float | None = -2.0,
) -> dict:
    """Speak `text` into `out_path`, returning its duration and per-word timings."""
    import numpy as np
    import torch

    pipeline = pipeline_for(lang_code)

    pieces: list = []
    words: list[dict] = []
    offset = 0.0  # Kokoro restarts timestamps at 0 for every chunk it splits the text into.

    # Hand kokoro the voice FILE when bay provisioned it: load_single_voice takes a path
    # directly when it ends in .pt, which is what keeps a provisioned install off the Hub.
    voice_arg = voice_path(voice) or voice

    for result in pipeline(text, voice=voice_arg, speed=speed):
        audio = result.audio
        if audio is None:
            continue
        if isinstance(audio, torch.Tensor):
            audio = audio.detach().cpu().numpy()
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)

        for token in getattr(result, "tokens", None) or []:
            start, end = getattr(token, "start_ts", None), getattr(token, "end_ts", None)
            label = (getattr(token, "text", "") or "").strip()
            # A token without both bounds cannot be placed on a timeline. Punctuation-only
            # tokens DO carry timings but are not words: emitting them made a caption builder
            # treat "," as a caption of its own and mis-count words per line.
            if start is None or end is None:
                continue
            if not any(character.isalnum() for character in label):
                continue
            words.append({
                "text": label,
                "start": round(offset + float(start), 4),
                "end": round(offset + float(end), 4),
            })

        pieces.append(audio)
        offset += len(audio) / float(SAMPLE_RATE)

    if not pieces:
        raise ValueError("Kokoro produced no audio for this text")

    duration = write_wav(out_path, np.concatenate(pieces), peak_db)
    return {
        "path": os.path.abspath(out_path),
        "durationSeconds": round(duration, 4),
        "sampleRate": SAMPLE_RATE,
        "voice": voice,
        "langCode": lang_code,
        "speed": speed,
        "peakDb": peak_db,
        "words": words,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    token = ""

    def log_message(self, *_args):  # noqa: D102 - silence per-request stderr noise
        pass

    def _authorized(self) -> bool:
        ok = self.headers.get("Authorization", "") == f"Bearer {self.token}"
        # Only a request we will actually serve counts as the sidecar being wanted. Counting
        # every request meant any local process could hold an orphaned sidecar — and its ~1 GB
        # of resident model — alive indefinitely with unauthenticated pings, which is precisely
        # the failure the idle timeout exists to be the backstop for.
        if ok:
            touch_activity()
        return ok

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        if self.path.startswith("/health"):
            return self._send(200, {
                "status": "ok",
                "sampleRate": SAMPLE_RATE,
                "loadedLanguages": sorted(_pipelines.keys()),
                "pid": os.getpid(),
            })
        if self.path.startswith("/voices"):
            return self._send(200, {"voices": VOICES})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        if not self.path.startswith("/speak"):
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as error:
            return self._send(400, {"error": f"bad request body: {error}"})

        text = (request.get("text") or "").strip()
        out_path = request.get("outPath") or ""
        if not text:
            return self._send(400, {"error": "text is required"})
        if not out_path:
            return self._send(400, {"error": "outPath is required"})

        lang_code = request.get("langCode") or "a"
        voice = request.get("voice") or (VOICES.get(lang_code) or ["af_heart"])[0]
        try:
            speed = float(request.get("speed", 1.0))
        except (TypeError, ValueError):
            return self._send(400, {"error": "speed must be a number"})

        peak_db = request.get("peakDb", -2.0)
        if peak_db is not None:
            try:
                peak_db = float(peak_db)
            except (TypeError, ValueError):
                return self._send(400, {"error": "peakDb must be a number or null"})
            if peak_db > 0.0:
                return self._send(400, {"error": "peakDb must be <= 0 (dBFS)"})

        try:
            started = time.time()
            result = synthesize(text, voice, speed, lang_code, out_path, peak_db)
            result["synthesisSeconds"] = round(time.time() - started, 3)
            return self._send(200, result)
        except Exception as error:  # surfaced to the caller rather than logged and swallowed
            return self._send(500, {"error": f"{type(error).__name__}: {error}"})


_last_activity = time.monotonic()
_activity_lock = threading.Lock()


def touch_activity():
    """Record that someone is still using this sidecar."""
    global _last_activity
    with _activity_lock:
        _last_activity = time.monotonic()


def seconds_idle() -> float:
    with _activity_lock:
        return time.monotonic() - _last_activity


def watch_parent_pipe():
    """Exit when the parent closes our stdin.

    The exact one. The OS closes the pipe however the parent goes away — a clean exit, a crash,
    or `kill -9` — so this cannot be defeated by pid reuse the way `os.kill(ppid, 0)` can: if the
    OS recycles the parent's pid, that check succeeds forever and the watchdog never fires. It
    also needs no per-platform pid introspection, so it behaves the same on Windows.

    Only armed when bay says it has given us a pipe. A hand-run sidecar usually has stdin on a
    tty (read blocks, which is right) but under `< /dev/null` it would read EOF immediately and
    exit before serving anything.
    """
    try:
        while sys.stdin.buffer.read(1):
            pass
    except Exception:
        pass
    os._exit(0)


def watch_parent(parent_pid: int):
    """Exit once the parent is gone, so a crashed editor leaves no resident model behind.

    Kept as a second belt behind the pipe watchdog. Defeated by pid reuse on its own, which is
    one of the two ways a sidecar was observed still holding its port long after every test
    process had exited.
    """
    while True:
        time.sleep(2.0)
        try:
            os.kill(parent_pid, 0)
        except OSError:
            os._exit(0)


def watch_idle(timeout_seconds: float):
    """Exit after `timeout_seconds` with no requests.

    The backstop. Whatever happened to the parent and whichever watchdog failed to fire, a
    sidecar cannot sit on its port indefinitely — which is the failure that was actually
    observed, and which then failed an unrelated test with PortBusy.
    """
    while True:
        time.sleep(min(5.0, max(0.5, timeout_seconds / 4)))
        if seconds_idle() >= timeout_seconds:
            print(
                f"bay-kokoro: exiting after {timeout_seconds:.0f}s idle",
                file=sys.stderr,
                flush=True,
            )
            os._exit(0)


def main() -> int:
    parser = argparse.ArgumentParser(description="Kokoro text-to-speech sidecar for bay")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7334)
    parser.add_argument("--preload", default="", help="lang_code to load at startup")
    parser.add_argument(
        "--model-dir",
        default="",
        help="directory holding config.json, kokoro-v1_0.pth and voices/*.pt",
    )
    args = parser.parse_args()

    global MODEL_DIR
    if args.model_dir and os.path.isdir(args.model_dir):
        MODEL_DIR = args.model_dir

    token = os.environ.get("BAY_KOKORO_TOKEN", "")
    if not token:
        print("BAY_KOKORO_TOKEN must be set", file=sys.stderr)
        return 2
    Handler.token = token

    # Three layers, most exact first. Each is independent, so one failing to arm does not leave
    # the sidecar unsupervised — which is exactly how one came to outlive every process that
    # could have stopped it.
    supervised = []

    if os.environ.get("BAY_KOKORO_PARENT_PIPE") == "1":
        threading.Thread(target=watch_parent_pipe, daemon=True).start()
        supervised.append("parent pipe")

    parent = os.environ.get("BAY_KOKORO_PARENT_PID")
    if parent and parent.isdigit():
        threading.Thread(target=watch_parent, args=(int(parent),), daemon=True).start()
        supervised.append(f"parent pid {parent}")

    idle_timeout = os.environ.get("BAY_KOKORO_IDLE_TIMEOUT", str(DEFAULT_IDLE_TIMEOUT))
    try:
        idle_seconds = float(idle_timeout)
    except ValueError:
        idle_seconds = float(DEFAULT_IDLE_TIMEOUT)
    if idle_seconds > 0:
        touch_activity()
        threading.Thread(target=watch_idle, args=(idle_seconds,), daemon=True).start()
        supervised.append(f"idle {idle_seconds:.0f}s")

    if not supervised:
        # Used to be silent. A sidecar with nothing watching it runs until something kills it,
        # and the whole point of the write-up was that nobody could tell that had happened.
        print(
            "bay-kokoro: WARNING — no parent pipe, no parent pid and no idle timeout. "
            "This process will run until it is killed.",
            file=sys.stderr,
            flush=True,
        )
    else:
        print(f"bay-kokoro: supervised by {', '.join(supervised)}", file=sys.stderr, flush=True)

    if args.preload:
        pipeline_for(args.preload)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    # Announced on stdout so a supervising process can wait for the line instead of polling
    # blindly; bay polls /health anyway, which also proves the token works.
    print(f"bay-kokoro listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
