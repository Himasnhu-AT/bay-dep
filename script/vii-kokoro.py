#!/usr/bin/env python3
"""vii-kokoro — a Kokoro text-to-speech sidecar for vii.

Same shape as the transcription sidecar in the meeting assistant, and the same reason: the
model runtime (Python + torch, ~2 GB) never links into the editor. This process loads Kokoro
once, holds it hot, and answers loopback HTTP; vii spawns it on demand and talks to it.

    GET  /health   -> {"status": "ok", "sampleRate": 24000, ...}
    GET  /voices   -> {"voices": {...}}
    POST /speak    <- {"text": ..., "voice": ..., "speed": 1.0, "langCode": "a",
                       "outPath": "/abs/path.wav", "peakDb": -2.0}
                   -> {"path": ..., "durationSeconds": ..., "sampleRate": 24000,
                       "words": [{"text": ..., "start": ..., "end": ...}, ...]}

Auth: every request must carry `Authorization: Bearer $VII_KOKORO_TOKEN`. Binding to loopback
is not treated as authentication — any local process could otherwise drive it.

Lifecycle: if `VII_KOKORO_PARENT_PID` is set, the server exits once that process is gone, so a
crashed editor cannot leave a multi-gigabyte model resident.

Usage:
    VII_KOKORO_TOKEN=secret vii-kokoro.py --port 7334 [--host 127.0.0.1]
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

# Kokoro's published voice set, grouped by the lang_code that can speak them. Weights are
# fetched from the Hub on first use, so this is a catalogue, not a list of what is cached.
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


def pipeline_for(lang_code: str):
    """Build (once) and return the KPipeline for a language code."""
    with _lock:
        if lang_code not in _pipelines:
            from kokoro import KPipeline

            _pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")
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

    for result in pipeline(text, voice=voice, speed=speed):
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
        return self.headers.get("Authorization", "") == f"Bearer {self.token}"

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


def watch_parent(parent_pid: int):
    """Exit once the parent is gone, so a crashed editor leaves no resident model behind."""
    while True:
        time.sleep(2.0)
        try:
            os.kill(parent_pid, 0)
        except OSError:
            os._exit(0)


def main() -> int:
    parser = argparse.ArgumentParser(description="Kokoro text-to-speech sidecar for vii")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7334)
    parser.add_argument("--preload", default="", help="lang_code to load at startup")
    args = parser.parse_args()

    token = os.environ.get("VII_KOKORO_TOKEN", "")
    if not token:
        print("VII_KOKORO_TOKEN must be set", file=sys.stderr)
        return 2
    Handler.token = token

    parent = os.environ.get("VII_KOKORO_PARENT_PID")
    if parent and parent.isdigit():
        threading.Thread(target=watch_parent, args=(int(parent),), daemon=True).start()

    if args.preload:
        pipeline_for(args.preload)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    # Announced on stdout so a supervising process can wait for the line instead of polling
    # blindly; vii polls /health anyway, which also proves the token works.
    print(f"vii-kokoro listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
