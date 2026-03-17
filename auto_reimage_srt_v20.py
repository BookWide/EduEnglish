# -*- coding: utf-8 -*-
# auto_reimage_srt_v20.py
# v20
# - keep original auto_reimage_srt.py core pipeline
# - add renderMode support: auto / lipsync / kling
# - auto/motion => original reimage + motion pipeline
# - lipsync => use LivePortrait with a fixed driving-bank mp4, then replace audio with current segment mp3
# - kling => use external mp4 if provided, then replace/mix with current segment mp3
# - if lipsync/kling input missing or failed, fallback to normal motion pipeline

import os
import re
import json
import base64
import asyncio
import subprocess
import shutil
from typing import Dict, List, Any, Optional, Tuple

import edge_tts
from openai import OpenAI
from PIL import Image


MODEL = "gpt-image-1"
SIZE = "1536x1024"

ROOT = os.path.dirname(os.path.abspath(__file__))
STORY_ROOT = os.path.join(ROOT, "story")

# ===== existing render settings =====
REIMAGE_MODE = 3
CLEAN_ENABLE = True
BOTTOM_SUBTITLE_RATIO = 0.13
BOTTOM_SUBTITLE_PAD = 4
MASK_TOP_LEFT_LOGO = True
TOP_LEFT_LOGO_W_RATIO = 0.16
TOP_LEFT_LOGO_H_RATIO = 0.12
MASK_TOP_RIGHT_LOGO = False
TOP_RIGHT_LOGO_W_RATIO = 0.16
TOP_RIGHT_LOGO_H_RATIO = 0.12

DEFAULT_VOICE = {
    "voice": "en-US-JennyNeural",
    "rate": "+0%",
    "pitch": "+0Hz",
    "volume": "+0%",
}

# ===== new renderMode settings =====
DEFAULT_RENDER_MODE = "auto"   # auto | lipsync | kling
LIPSYNC_MAX_MP3_SECONDS = 12  # longer than this => fallback to motion

# external mp4 folders inside story/<base>/
EXTERNAL_MP4_DIRS = [
    "kling_output",
    "external_mp4",
    "manual_mp4",
]

# LivePortrait settings
LIVEPORTRAIT_ROOT = os.path.join(ROOT, "LivePortrait")
LIVEPORTRAIT_INFERENCE = os.path.join(LIVEPORTRAIT_ROOT, "inference.py")
LIVEPORTRAIT_DRIVING_DIR = os.path.join(LIVEPORTRAIT_ROOT, "assets", "examples", "driving")
LIVEPORTRAIT_OUTPUT_DIR = os.path.join(LIVEPORTRAIT_ROOT, "animations")

# default driving-bank selection
DRIVING_BANK_DEFAULT = "d11_1s.mp4"
DRIVING_BANK_BY_ROLE = {
    "narration": "d11_1s.mp4",
    "kid": "d11_1s.mp4",
    "child": "d11_1s.mp4",
    "girl": "d11_1s.mp4",
    "boy": "d11_1s.mp4",
}
DRIVING_BANK_BY_EMOTION = {
    "neutral": "d11_1s.mp4",
    "default": "d11_1s.mp4",
}

# driving map json (optional)
# search order:
# 1) story/<base>/out_assets/driving_map.json
# 2) story/<base>/driving_map.json
# format example:
# {
#   "default": "d11_1s.mp4",
#   "boy1": "boy1_question_01.mp4",
#   "boy2": "boy2_neutral_01.mp4",
#   "boy1.question": "boy1_question_02.mp4"
# }
DRIVING_MAP_CANDIDATES = [
    os.path.join("out_assets", "driving_map.json"),
    "driving_map.json",
]


def run(cmd: List[str], cwd: Optional[str] = None):
    subprocess.run(cmd, check=True, cwd=cwd)


def pick_story_base() -> str:
    bases = [d for d in os.listdir(STORY_ROOT) if os.path.isdir(os.path.join(STORY_ROOT, d))]
    if not bases:
        raise RuntimeError("找不到 story\\<base> 資料夾")
    bases.sort()
    return bases[0]


def pick_numbered_file(folder: str, base: str, idx: int, idx4: str, ext: str) -> str:
    candidates = [
        os.path.join(folder, f"{base}_{idx4}.{ext}"),
        os.path.join(folder, f"{base}_{idx}.{ext}"),
        os.path.join(folder, f"seg_{idx4}.{ext}"),
        os.path.join(folder, f"{idx4}.{ext}"),
        os.path.join(folder, f"{idx}.{ext}"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return ""


def get_media_duration_seconds(path: str) -> float:
    dur_txt = subprocess.check_output([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ], text=True).strip()
    return float(dur_txt)


def make_silent_mp3(out_path: str, sec: float = 1.0):
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=24000:cl=mono",
        "-t", str(sec),
        "-q:a", "9",
        "-acodec", "libmp3lame",
        out_path,
    ], check=True)


def normalize_voice_cfg(cfg: Dict[str, Any]) -> Dict[str, str]:
    cfg = dict(cfg or {})
    voice = str(cfg.get("voice") or DEFAULT_VOICE["voice"]).strip()
    rate = str(cfg.get("rate") or DEFAULT_VOICE["rate"]).strip()
    pitch = str(cfg.get("pitch") or DEFAULT_VOICE["pitch"]).strip()
    volume = str(cfg.get("volume") or DEFAULT_VOICE["volume"]).strip()

    if rate == "0%":
        rate = "+0%"
    if pitch.lower() == "0hz":
        pitch = "+0Hz"
    if volume == "0%":
        volume = "+0%"

    if not re.match(r"^[+-]?\d+%$", rate):
        rate = DEFAULT_VOICE["rate"]
    if not re.match(r"^[+-]?\d+Hz$", pitch, re.I):
        pitch = DEFAULT_VOICE["pitch"]
    if not re.match(r"^[+-]?\d+%$", volume):
        volume = DEFAULT_VOICE["volume"]

    return {
        "voice": voice,
        "rate": rate,
        "pitch": pitch,
        "volume": volume,
    }


async def edge_tts_save(text: str, cfg: Dict[str, Any], out_path: str):
    text = " ".join(str(text or "").split()).strip()
    cfg = normalize_voice_cfg(cfg)

    if not text:
        print(f"[EMPTY TEXT] -> silent: {os.path.basename(out_path)}")
        make_silent_mp3(out_path, 1.0)
        return

    print(f"[TTS] voice={cfg['voice']} rate={cfg['rate']} pitch={cfg['pitch']} volume={cfg['volume']}")
    print(f"[TEXT] {text[:120]}")

    try:
        communicate = edge_tts.Communicate(
            text=text,
            voice=cfg["voice"],
            rate=cfg["rate"],
            pitch=cfg["pitch"],
            volume=cfg["volume"],
        )
        await communicate.save(out_path)
        if not os.path.exists(out_path) or os.path.getsize(out_path) <= 1024:
            raise RuntimeError("edge-tts produced empty/small mp3")
        return
    except Exception as e:
        print(f"[TTS FAIL 1] {e}")

    try:
        print("[RETRY] fallback narration")
        communicate = edge_tts.Communicate(
            text=text,
            voice=DEFAULT_VOICE["voice"],
            rate=DEFAULT_VOICE["rate"],
            pitch=DEFAULT_VOICE["pitch"],
            volume=DEFAULT_VOICE["volume"],
        )
        await communicate.save(out_path)
        if not os.path.exists(out_path) or os.path.getsize(out_path) <= 1024:
            raise RuntimeError("fallback narration produced empty/small mp3")
        return
    except Exception as e:
        print(f"[TTS FAIL 2] {e}")

    print(f"[SILENT FALLBACK] {os.path.basename(out_path)}")
    make_silent_mp3(out_path, 1.0)


def concat_mp3_files(mp3_parts: List[str], out_mp3: str):
    if not mp3_parts:
        make_silent_mp3(out_mp3, 1.0)
        return

    list_txt = out_mp3 + ".txt"
    with open(list_txt, "w", encoding="utf-8") as f:
        for p in mp3_parts:
            safe = p.replace("\\", "/")
            f.write(f"file '{safe}'\n")

    try:
        run([
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", list_txt,
            "-c", "copy",
            out_mp3,
        ])
    except Exception:
        run([
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", list_txt,
            "-ar", "24000",
            "-ac", "1",
            "-acodec", "libmp3lame",
            out_mp3,
        ])
    finally:
        try:
            os.remove(list_txt)
        except OSError:
            pass


def get_reimage_prompt() -> str:
    clean_clause = (
        "Remove any watermark, logo, subtitle text, caption bar, or overlay text completely. "
        "Do not keep any original on-screen text. "
    )
    if REIMAGE_MODE == 1:
        return (
            clean_clause +
            "Re-imagine this frame as a children's storybook illustration. "
            "Keep the same story meaning and a similar composition. "
            "Preserve the main subject and general scene layout. "
            "Slightly improve color, lighting, brush texture, and character design. "
            "Soft cinematic light, storybook style."
        )
    if REIMAGE_MODE == 3:
        return (
            clean_clause +
            "Re-imagine this scene as a children's fantasy storybook illustration. "
            "Keep the same story meaning, but create noticeable variation. "
            "Change composition, camera angle, character pose, environment details, "
            "lighting mood, and scene arrangement. "
            "Use cinematic lighting, dynamic framing, and rich storybook illustration detail."
        )
    return (
        clean_clause +
        "Re-imagine this scene as a children's storybook illustration. "
        "Keep the same story meaning, but make a clear visual variation. "
        "Adjust composition, camera angle, pose, background details, and lighting. "
        "Warm cinematic storybook lighting, soft painted texture, fantasy illustration style."
    )


def _paste_stretched_region(img: Image.Image, src_box: Tuple[int, int, int, int], dst_box: Tuple[int, int, int, int]):
    src = img.crop(src_box)
    dst_w = max(1, dst_box[2] - dst_box[0])
    dst_h = max(1, dst_box[3] - dst_box[1])
    stretched = src.resize((dst_w, dst_h), Image.Resampling.BICUBIC)
    img.paste(stretched, dst_box)


def clean_frame_for_reimage(in_img_path: str, out_img_path: str):
    img = Image.open(in_img_path).convert("RGB")
    w, h = img.size

    sub_h = int(h * BOTTOM_SUBTITLE_RATIO) + BOTTOM_SUBTITLE_PAD
    sub_h = max(8, min(sub_h, h // 3))
    src_y1 = max(0, h - sub_h * 2)
    src_y2 = max(src_y1 + 1, h - sub_h)
    _paste_stretched_region(img, (0, src_y1, w, src_y2), (0, h - sub_h, w, h))

    if MASK_TOP_LEFT_LOGO:
        logo_w = max(16, int(w * TOP_LEFT_LOGO_W_RATIO))
        logo_h = max(16, int(h * TOP_LEFT_LOGO_H_RATIO))
        src_box = (logo_w, 0, min(w, logo_w * 2), min(h, logo_h))
        dst_box = (0, 0, logo_w, logo_h)
        _paste_stretched_region(img, src_box, dst_box)

    if MASK_TOP_RIGHT_LOGO:
        logo_w = max(16, int(w * TOP_RIGHT_LOGO_W_RATIO))
        logo_h = max(16, int(h * TOP_RIGHT_LOGO_H_RATIO))
        src_box = (max(0, w - logo_w * 2), 0, w - logo_w, min(h, logo_h))
        dst_box = (w - logo_w, 0, w, logo_h)
        _paste_stretched_region(img, src_box, dst_box)

    img.save(out_img_path, "JPEG", quality=95)
    print(f"[CLEAN] {os.path.basename(in_img_path)} -> {os.path.basename(out_img_path)}")


def reimage_one(client: OpenAI, in_img_path: str, out_img_path: str):
    with open(in_img_path, "rb") as f:
        img_bytes = f.read()

    res = client.images.edit(
        model=MODEL,
        image=[(os.path.basename(in_img_path), img_bytes, "image/jpeg")],
        prompt=get_reimage_prompt(),
        size=SIZE,
    )

    b64 = res.data[0].b64_json
    with open(out_img_path, "wb") as f:
        f.write(base64.b64decode(b64))


def combine_from_jpg_with_motion(img_path: str, mp3_path: str, out_mp4_path: str):
    fps = 30
    out_w, out_h = 1536, 1024
    dur = get_media_duration_seconds(mp3_path)
    frames = max(1, int(dur * fps))
    vf = (
        f"scale={out_w}:{out_h},setsar=1,"
        f"zoompan="
        f"z='min(zoom+0.0008,1.10)':"
        f"x='x+0.35':"
        f"y='y+0.20':"
        f"d={frames}:"
        f"s={out_w}x{out_h}:"
        f"fps={fps}"
    )

    run([
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", img_path,
        "-i", mp3_path,
        "-t", f"{dur:.3f}",
        "-vf", vf,
        "-r", str(fps),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "96k",
        "-shortest",
        out_mp4_path,
    ])


def combine_from_mp4_with_bg_and_voice(video_path: str, mp3_path: str, out_mp4_path: str):
    out_w, out_h = 1536, 1024
    dur = get_media_duration_seconds(mp3_path)
    vf = f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease,pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    af = (
        "[0:a]aformat=channel_layouts=stereo,volume=0.35[bg];"
        "[1:a]aformat=channel_layouts=stereo,volume=1.00[vo];"
        "[bg][vo]amix=inputs=2:duration=first:dropout_transition=0[m]"
    )
    run([
        "ffmpeg", "-y",
        "-stream_loop", "-1",
        "-i", video_path,
        "-i", mp3_path,
        "-t", f"{dur:.3f}",
        "-vf", vf,
        "-filter_complex", af,
        "-map", "0:v:0",
        "-map", "[m]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        out_mp4_path,
    ])


def mux_video_with_voice(video_path: str, mp3_path: str, out_mp4_path: str):
    dur = get_media_duration_seconds(mp3_path)
    run([
        "ffmpeg", "-y",
        "-stream_loop", "-1",
        "-i", video_path,
        "-i", mp3_path,
        "-t", f"{dur:.3f}",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        out_mp4_path,
    ])


def load_json_if_exists(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_voice_map(story_dir: str) -> Dict[str, Any]:
    vm_path = os.path.join(story_dir, "out_assets", "voice_map.json")
    if not os.path.exists(vm_path):
        raise RuntimeError(f"找不到 voice_map.json：{vm_path}")
    with open(vm_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_srt_update_meta(story_dir: str) -> Optional[Dict[str, Any]]:
    return load_json_if_exists(os.path.join(story_dir, "out_assets", "srt_update.meta.json"))


def get_voice_library(voice_map: Dict[str, Any]) -> Dict[str, Any]:
    lib = voice_map.get("voice_library") or voice_map.get("voiceLibrary") or {}
    if not isinstance(lib, dict):
        lib = {}

    if "narration" not in lib:
        default_cfg = voice_map.get("default") or {}
        if default_cfg:
            lib["narration"] = {
                "name": "旁白",
                "voice": default_cfg.get("voice", DEFAULT_VOICE["voice"]),
                "rate": default_cfg.get("rate", DEFAULT_VOICE["rate"]),
                "pitch": default_cfg.get("pitch", DEFAULT_VOICE["pitch"]),
                "volume": default_cfg.get("volume", DEFAULT_VOICE["volume"]),
            }
        else:
            lib["narration"] = dict(DEFAULT_VOICE)

    return lib


def get_segments_map(voice_map: Dict[str, Any]) -> Dict[str, Any]:
    segs = voice_map.get("segments") or voice_map.get("segmentMap") or {}
    if not isinstance(segs, dict):
        segs = {}
    return segs


def get_library_cfg(voice_map: Dict[str, Any], key: str) -> Dict[str, str]:
    lib = get_voice_library(voice_map)
    cfg = lib.get(key)
    if not cfg:
        cfg = lib.get("narration") or DEFAULT_VOICE
    return normalize_voice_cfg(cfg)


def valid_role_key(voice_map: Dict[str, Any], key: str) -> str:
    lib = get_voice_library(voice_map)
    key = str(key or "").strip()
    if key and key in lib:
        return key
    return "narration"


def normalize_render_mode(value: Any) -> str:
    v = str(value or DEFAULT_RENDER_MODE).strip().lower()
    if v not in {"auto", "motion", "lipsync", "kling", "original"}:
        v = DEFAULT_RENDER_MODE
    return v


def load_driving_map(story_dir: str) -> Dict[str, str]:
    data: Dict[str, str] = {}
    for rel in DRIVING_MAP_CANDIDATES:
        p = os.path.join(story_dir, rel)
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if isinstance(k, str) and isinstance(v, str) and v.strip():
                        data[k.strip()] = v.strip()
                print(f"[DRIVING MAP] loaded: {p} keys={list(data.keys())}")
                return data
        except Exception as e:
            print(f"[DRIVING MAP FAIL] {p}: {e}")
    return data


def resolve_speaking_ref(seg: Dict[str, Any], voice_map: Dict[str, Any]) -> str:
    multi = seg.get("multiVoice") or []
    if isinstance(multi, list):
        for part in multi:
            if not isinstance(part, dict):
                continue
            ref = valid_role_key(voice_map, part.get("ref"))
            if ref != "narration":
                return ref
    return valid_role_key(voice_map, seg.get("voiceRef") or seg.get("role"))


def resolve_segment_render_mode(seg: Dict[str, Any]) -> str:
    multi = seg.get("multiVoice") or []
    if isinstance(multi, list):
        for part in multi:
            if not isinstance(part, dict):
                continue
            rm = normalize_render_mode(part.get("renderMode") or part.get("render"))
            if rm == "lipsync":
                return "lipsync"
            if rm == "kling":
                return "kling"
    return normalize_render_mode(seg.get("renderMode") or seg.get("render") or DEFAULT_RENDER_MODE)


def choose_driving_bank(seg: Dict[str, Any], voice_map: Dict[str, Any], story_dir: str) -> str:
    speaking_ref = resolve_speaking_ref(seg, voice_map)
    emotion = str(seg.get("emotion") or seg.get("mood") or "default").strip().lower()
    driving_map = load_driving_map(story_dir)

    if speaking_ref and emotion:
        key = f"{speaking_ref}.{emotion}"
        fname = driving_map.get(key)
        if fname:
            p = os.path.join(LIVEPORTRAIT_DRIVING_DIR, fname)
            if os.path.exists(p):
                print(f"[DRIVING] {key} -> {fname}")
                return p

    if speaking_ref:
        fname = driving_map.get(speaking_ref)
        if fname:
            p = os.path.join(LIVEPORTRAIT_DRIVING_DIR, fname)
            if os.path.exists(p):
                print(f"[DRIVING] {speaking_ref} -> {fname}")
                return p

    fname = driving_map.get("default")
    if fname:
        p = os.path.join(LIVEPORTRAIT_DRIVING_DIR, fname)
        if os.path.exists(p):
            print(f"[DRIVING] default -> {fname}")
            return p

    role_lc = str(speaking_ref).lower()
    for k, fname in DRIVING_BANK_BY_ROLE.items():
        if k in role_lc:
            p = os.path.join(LIVEPORTRAIT_DRIVING_DIR, fname)
            if os.path.exists(p):
                print(f"[DRIVING] role fallback {speaking_ref} -> {fname}")
                return p

    if emotion in DRIVING_BANK_BY_EMOTION:
        p = os.path.join(LIVEPORTRAIT_DRIVING_DIR, DRIVING_BANK_BY_EMOTION[emotion])
        if os.path.exists(p):
            print(f"[DRIVING] emotion fallback {emotion} -> {os.path.basename(p)}")
            return p

    p = os.path.join(LIVEPORTRAIT_DRIVING_DIR, DRIVING_BANK_DEFAULT)
    print(f"[DRIVING] hard default -> {os.path.basename(p)}")
    return p


def ensure_liveportrait_source_jpg(in_img_path: str, out_img_path: str):
    img = Image.open(in_img_path).convert("RGB")
    img.save(out_img_path, "JPEG", quality=95)


def run_liveportrait_once(source_img: str, driving_mp4: str, out_noaudio_mp4: str):
    if not os.path.exists(LIVEPORTRAIT_INFERENCE):
        raise RuntimeError(f"找不到 LivePortrait inference.py：{LIVEPORTRAIT_INFERENCE}")
    if not os.path.exists(source_img):
        raise RuntimeError(f"找不到 source 圖：{source_img}")
    if not os.path.exists(driving_mp4):
        raise RuntimeError(f"找不到 driving mp4：{driving_mp4}")

    os.makedirs(LIVEPORTRAIT_OUTPUT_DIR, exist_ok=True)

    cmd = [
        "python",
        LIVEPORTRAIT_INFERENCE,
        "--source", source_img,
        "--driving", driving_mp4,
    ]
    print(f"[LIPSYNC] run LivePortrait: {' '.join(cmd)}")
    run(cmd, cwd=LIVEPORTRAIT_ROOT)

    source_base = os.path.splitext(os.path.basename(source_img))[0]
    driving_base = os.path.splitext(os.path.basename(driving_mp4))[0]
    generated = os.path.join(LIVEPORTRAIT_OUTPUT_DIR, f"{source_base}--{driving_base}.mp4")

    if not os.path.exists(generated):
        raise RuntimeError(f"LivePortrait 沒有輸出：{generated}")

    shutil.copyfile(generated, out_noaudio_mp4)
    print(f"[LIPSYNC OUT] {out_noaudio_mp4}")


def find_external_mp4(story_dir: str, idx: int, idx4: str, base: str) -> str:
    for d in EXTERNAL_MP4_DIRS:
        folder = os.path.join(story_dir, d)
        if not os.path.isdir(folder):
            continue
        p = pick_numbered_file(folder, base, idx, idx4, "mp4")
        if p:
            return p
    return ""


async def generate_remp3_from_voice_map(story_dir: str, base: str):
    voice_map = load_voice_map(story_dir)
    lib = get_voice_library(voice_map)
    seg_map = get_segments_map(voice_map)
    mp3_dir = os.path.join(story_dir, "remp3_output")
    os.makedirs(mp3_dir, exist_ok=True)

    print("[VOICE LIB KEYS]", list(lib.keys()))
    print("[SEG COUNT]", len(seg_map))

    for idx4 in sorted(seg_map.keys()):
        seg = seg_map[idx4] or {}
        out_mp3 = os.path.join(mp3_dir, f"{base}_{idx4}.mp3")

        if os.path.exists(out_mp3) and os.path.getsize(out_mp3) > 1024:
            print(f"[SKIP MP3] exists: {os.path.basename(out_mp3)}")
            continue

        parts = []
        multi_enabled = bool(seg.get("multiVoiceEnabled"))
        multi_list = seg.get("multiVoice") or []

        if multi_enabled and isinstance(multi_list, list) and len(multi_list) > 0:
            print(f"[MULTI] idx={idx4} parts={len(multi_list)}")
            for j, p in enumerate(multi_list, start=1):
                ptxt = " ".join(str((p or {}).get("text") or "").split()).strip()
                pref = valid_role_key(voice_map, (p or {}).get("ref"))
                cfg = get_library_cfg(voice_map, pref)
                part_path = os.path.join(mp3_dir, f"{base}_{idx4}_part{j:02d}.mp3")
                print(f"[SEG] idx={idx4} part={j} role={pref} cfg={cfg} text={ptxt[:100]}")
                await edge_tts_save(ptxt, cfg, part_path)
                if os.path.exists(part_path) and os.path.getsize(part_path) > 0:
                    parts.append(part_path)

            if parts:
                concat_mp3_files(parts, out_mp3)
                for p in parts:
                    try:
                        os.remove(p)
                    except OSError:
                        pass
                continue
            else:
                print(f"[MULTI EMPTY -> FALLBACK SINGLE] idx={idx4}")

        role = valid_role_key(voice_map, seg.get("voiceRef") or seg.get("role"))
        cfg = get_library_cfg(voice_map, role)
        txt = " ".join(str(seg.get("text") or "").split()).strip()
        print(f"[SINGLE] idx={idx4} role={role} cfg={cfg} text={txt[:100]}")
        await edge_tts_save(txt, cfg, out_mp3)


def sec_to_srt(t: float) -> str:
    if t < 0:
        t = 0
    h = int(t // 3600)
    t -= h * 3600
    m = int(t // 60)
    t -= m * 60
    s = int(t)
    ms = int(round((t - s) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_updated_srt(story_dir: str, base: str):
    meta = load_srt_update_meta(story_dir)
    if not meta:
        print("[NO srt_update.meta.json] skip srt_update.srt")
        return

    seg_meta = meta.get("segments") or {}
    if not seg_meta:
        print("[EMPTY srt_update.meta.json] skip srt_update.srt")
        return

    mp3_dir = os.path.join(story_dir, "remp3_output")
    out_srt = os.path.join(story_dir, "srt_update.srt")

    cur = 0.0
    lines = []
    for i, idx4 in enumerate(sorted(seg_meta.keys()), start=1):
        info = seg_meta[idx4] or {}
        txt = " ".join(str(info.get("text") or "").split()).strip()
        if not txt:
            txt = "..."
        mp3_path = os.path.join(mp3_dir, f"{base}_{idx4}.mp3")
        if os.path.exists(mp3_path):
            dur = max(0.1, get_media_duration_seconds(mp3_path))
        else:
            dur = 1.0

        use_new = bool(info.get("update_srt_timing", True))
        if use_new:
            start = cur
            end = cur + dur
            cur = end
        else:
            start = float(info.get("start", cur))
            end = float(info.get("end", start + dur))
            cur = max(cur, end)

        lines.append(str(i))
        lines.append(f"{sec_to_srt(start)} --> {sec_to_srt(end)}")
        lines.append(txt)
        lines.append("")

    with open(out_srt, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"[WRITE] {out_srt}")


def build_motion_segment(client: OpenAI, seg_path: str, clean_img: str, re_img: str, mp3_path: str, out_mp4: str):
    src_for_reimage = seg_path
    if CLEAN_ENABLE:
        if not os.path.exists(clean_img):
            clean_frame_for_reimage(seg_path, clean_img)
        src_for_reimage = clean_img

    if not os.path.exists(re_img):
        print(f"[REIMAGE mode={REIMAGE_MODE}] {os.path.basename(src_for_reimage)} -> {os.path.basename(re_img)}")
        reimage_one(client, src_for_reimage, re_img)
    else:
        print(f"[SKIP] reimage exists: {os.path.basename(re_img)}")

    print(f"[USE JPG+MOTION] {os.path.basename(re_img)} + {os.path.basename(mp3_path)} -> {os.path.basename(out_mp4)}")
    combine_from_jpg_with_motion(re_img, mp3_path, out_mp4)


def build_lipsync_segment(
    client: OpenAI,
    base: str,
    idx4: str,
    seg: Dict[str, Any],
    seg_path: str,
    clean_img: str,
    re_img: str,
    mp3_path: str,
    out_mp4: str,
    tmp_lp_dir: str,
    voice_map: Dict[str, Any],
    story_dir: str,
):
    mp3_dur = get_media_duration_seconds(mp3_path)
    if mp3_dur > LIPSYNC_MAX_MP3_SECONDS:
        print(f"[LIPSYNC SKIP] mp3 too long ({mp3_dur:.2f}s) -> fallback motion")
        build_motion_segment(client, seg_path, clean_img, re_img, mp3_path, out_mp4)
        return

    src_for_reimage = seg_path
    if CLEAN_ENABLE:
        if not os.path.exists(clean_img):
            clean_frame_for_reimage(seg_path, clean_img)
        src_for_reimage = clean_img

    if not os.path.exists(re_img):
        print(f"[REIMAGE for LIPSYNC] {os.path.basename(src_for_reimage)} -> {os.path.basename(re_img)}")
        reimage_one(client, src_for_reimage, re_img)
    else:
        print(f"[SKIP] reimage exists for lipsync: {os.path.basename(re_img)}")

    source_lp = os.path.join(tmp_lp_dir, f"{base}_{idx4}_lp_source.jpg")
    ensure_liveportrait_source_jpg(re_img, source_lp)

    # source image is always taken from reimage output; only lipsync segments use driving bank
    driving_mp4 = choose_driving_bank(seg, voice_map, story_dir)
    if not os.path.exists(driving_mp4):
        print(f"[LIPSYNC NO DRIVING] {driving_mp4} -> fallback motion")
        build_motion_segment(client, seg_path, clean_img, re_img, mp3_path, out_mp4)
        return

    lp_raw = os.path.join(tmp_lp_dir, f"{base}_{idx4}_lp_raw.mp4")
    try:
        run_liveportrait_once(source_lp, driving_mp4, lp_raw)
        mux_video_with_voice(lp_raw, mp3_path, out_mp4)
    except Exception as e:
        print(f"[LIPSYNC FAIL] {e} -> fallback motion")
        build_motion_segment(client, seg_path, clean_img, re_img, mp3_path, out_mp4)


def build_kling_segment(story_dir: str, base: str, idx: int, idx4: str, mp3_path: str, out_mp4: str) -> bool:
    ext_mp4 = find_external_mp4(story_dir, idx, idx4, base)
    if not ext_mp4:
        print(f"[KLING WAIT] no external mp4 for idx={idx4}")
        return False
    print(f"[USE KLING MP4] {os.path.basename(ext_mp4)} + {os.path.basename(mp3_path)} -> {os.path.basename(out_mp4)}")
    mux_video_with_voice(ext_mp4, mp3_path, out_mp4)
    return True


def main():
    print("[MAIN START]")

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("NO OPENAI_API_KEY（請先設定環境變數 OPENAI_API_KEY）")

    client = OpenAI(api_key=api_key)
    base = pick_story_base()
    story_dir = os.path.join(STORY_ROOT, base)

    seg_dir = os.path.join(story_dir, "out_assets")
    mp3_dir = os.path.join(story_dir, "remp3_output")
    re_dir = os.path.join(story_dir, "reimage_output")
    final_dir = os.path.join(story_dir, "final_new_mp4")
    clean_dir = os.path.join(story_dir, "reimage_clean_input")
    tmp_lp_dir = os.path.join(story_dir, "lipsync_temp")

    os.makedirs(mp3_dir, exist_ok=True)
    os.makedirs(re_dir, exist_ok=True)
    os.makedirs(final_dir, exist_ok=True)
    os.makedirs(clean_dir, exist_ok=True)
    os.makedirs(tmp_lp_dir, exist_ok=True)

    asyncio.run(generate_remp3_from_voice_map(story_dir, base))
    build_updated_srt(story_dir, base)

    voice_map = load_voice_map(story_dir)
    seg_map = get_segments_map(voice_map)

    seg_files = sorted([f for f in os.listdir(seg_dir) if re.match(r"^seg_\d{4}\.jpg$", f)])
    if not seg_files:
        raise RuntimeError(f"out_assets 找不到 seg_XXXX.jpg：{seg_dir}")

    for seg in seg_files:
        idx4 = seg.split("_")[1].split(".")[0]
        idx = int(idx4)
        seg_path = os.path.join(seg_dir, seg)
        clean_img = os.path.join(clean_dir, f"{base}_{idx4}_clean.jpg")
        re_mp4 = os.path.join(re_dir, f"{base}_{idx4}.mp4")
        re_img = os.path.join(re_dir, f"{base}_{idx4}.jpg")
        mp3_path = pick_numbered_file(mp3_dir, base, idx, idx4, "mp3")
        seg_cfg = seg_map.get(idx4) or {}

        if not mp3_path:
            raise RuntimeError(f"缺 mp3：{mp3_dir}\\{base}_{idx4}.mp3 或 {base}_{idx}.mp3")

        out_mp4 = os.path.join(final_dir, f"{base}_{idx4}.mp4")
        if os.path.exists(out_mp4):
            print(f"[SKIP] final exists: {os.path.basename(out_mp4)}")
            continue

        render_mode = resolve_segment_render_mode(seg_cfg)
        print(f"[RENDER MODE] idx={idx4} -> {render_mode}")

        if os.path.exists(re_mp4) and render_mode in {"auto", "motion", "original"}:
            print(f"[USE MP4+BG+VO] {os.path.basename(re_mp4)} + {os.path.basename(mp3_path)} -> {os.path.basename(out_mp4)}")
            combine_from_mp4_with_bg_and_voice(re_mp4, mp3_path, out_mp4)
            continue

        if render_mode == "kling":
            ok = build_kling_segment(story_dir, base, idx, idx4, mp3_path, out_mp4)
            if ok:
                continue
            print("[KLING FALLBACK] -> motion")
            build_motion_segment(client, seg_path, clean_img, re_img, mp3_path, out_mp4)
            continue

        if render_mode == "lipsync":
            build_lipsync_segment(
                client=client,
                base=base,
                idx4=idx4,
                seg=seg_cfg,
                seg_path=seg_path,
                clean_img=clean_img,
                re_img=re_img,
                mp3_path=mp3_path,
                out_mp4=out_mp4,
                tmp_lp_dir=tmp_lp_dir,
                voice_map=voice_map,
                story_dir=story_dir,
            )
            continue

        if os.path.exists(re_mp4):
            print(f"[USE MP4+BG+VO] {os.path.basename(re_mp4)} + {os.path.basename(mp3_path)} -> {os.path.basename(out_mp4)}")
            combine_from_mp4_with_bg_and_voice(re_mp4, mp3_path, out_mp4)
            continue

        build_motion_segment(client, seg_path, clean_img, re_img, mp3_path, out_mp4)

    print("[DONE]")


if __name__ == "__main__":
    main()
