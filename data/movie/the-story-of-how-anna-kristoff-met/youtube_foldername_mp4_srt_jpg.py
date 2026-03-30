# coding: utf-8
"""
YouTube -> <folder>_raw.mp4 / <folder>.mp4 / <folder>.srt / <folder>.jpg
-----------------------------------------------------------------------
功能：
1) 下載 YouTube 影片為 <資料夾名>_raw.mp4
2) 壓縮轉檔為 <資料夾名>.mp4（H264 + AAC）
3) 產生字幕為 <資料夾名>.srt
   - 先試抓 YouTube 字幕 / 自動字幕
   - 若沒有字幕，再試 whisper CLI（若你有安裝）
4) 自動擷取封面為 <資料夾名>.jpg
   - 預設從壓縮後影片第 3 秒截圖
   - 若影片太短會自動退回第 1 秒

需求：
- pip install -U "yt-dlp[default]"
- ffmpeg / ffprobe 已加入 PATH
- 可選：whisper CLI（沒有也能跑，只是沒有字幕時無法轉錄）
  pip install -U openai-whisper
"""

import re
import shutil
import subprocess
from pathlib import Path

ALLOWED_CATEGORIES = ["story", "movie", "music", "news", "pro", "ads", "talk"]


def q(x):
    s = str(x)
    return f'"{s}"' if " " in s else s


def run_cmd(cmd, cwd=None, check=True):
    print("RUN:", " ".join(q(x) for x in cmd))
    p = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore"
    )
    if p.stdout:
        print(p.stdout)
    if p.returncode != 0 and check:
        if p.stderr:
            print(p.stderr)
        raise RuntimeError(f"命令失敗：{' '.join(map(str, cmd))}")
    return p


def require_tool(name):
    if shutil.which(name) is None:
        raise RuntimeError(f"找不到 {name}，請先安裝並加入 PATH。")


def normalize_slug(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"https?://", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


def clear_old_outputs(work_dir: Path):
    folder_name = work_dir.name
    patterns = [
        f"{folder_name}_raw.*",
        f"{folder_name}.*",
        "audio_for_whisper.*",
        "subs_tmp*.*",
    ]
    for pat in patterns:
        for p in work_dir.glob(pat):
            try:
                p.unlink()
                print("刪除舊檔：", p)
            except Exception as e:
                print("無法刪除：", p, e)


def find_deno_exe():
    deno = shutil.which("deno")
    if deno:
        return deno
    roots = [
        Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Packages",
        Path.home() / "AppData" / "Local" / "Programs",
        Path.home() / ".deno" / "bin",
        Path(r"C:\Program Files"),
        Path(r"C:\Program Files (x86)"),
    ]
    for root in roots:
        if not root.exists():
            continue
        try:
            for exe in root.rglob("deno.exe"):
                return str(exe)
        except Exception:
            pass
    return None


def build_video_download_plans(url: str, output_tpl: str):
    plans = []
    plans.append(("firefox cookies", [
        "yt-dlp", "--force-overwrites", "--no-continue",
        "--cookies-from-browser", "firefox",
        "-f", "bv*+ba/b[ext=mp4]/b",
        "--merge-output-format", "mp4",
        "-o", output_tpl, url
    ]))
    plans.append(("chrome cookies", [
        "yt-dlp", "--force-overwrites", "--no-continue",
        "--cookies-from-browser", "chrome",
        "-f", "bv*+ba/b[ext=mp4]/b",
        "--merge-output-format", "mp4",
        "-o", output_tpl, url
    ]))
    deno_exe = find_deno_exe()
    if deno_exe:
        print("找到 Deno：", deno_exe)
        plans.append(("auto deno runtime", [
            "yt-dlp", "--force-overwrites", "--no-continue",
            "--js-runtimes", deno_exe,
            "-f", "bv*+ba/b[ext=mp4]/b",
            "--merge-output-format", "mp4",
            "-o", output_tpl, url
        ]))
    else:
        print("找不到 deno.exe，略過 deno runtime。")
    plans.append(("plain fallback", [
        "yt-dlp", "--force-overwrites", "--no-continue",
        "-f", "bv*+ba/b[ext=mp4]/b",
        "--merge-output-format", "mp4",
        "-o", output_tpl, url
    ]))
    return plans


def download_video_as_raw(url: str, work_dir: Path, raw_mp4: Path) -> Path:
    output_tpl = str(work_dir / f"{work_dir.name}_raw.%(ext)s")
    plans = build_video_download_plans(url, output_tpl)
    last_error = None

    for name, cmd in plans:
        print(f"\n--- 嘗試下載影片：{name} ---")
        try:
            run_cmd(cmd)
            candidates = sorted(work_dir.glob(f"{work_dir.name}_raw.*"))
            for p in candidates:
                if p.suffix.lower() == ".mp4":
                    if p != raw_mp4:
                        if raw_mp4.exists():
                            raw_mp4.unlink()
                        p.rename(raw_mp4)
                    return raw_mp4
            if candidates:
                return candidates[0]
            raise RuntimeError("下載後找不到原始影片")
        except Exception as e:
            print(f"ERROR: {name} 失敗")
            print(str(e))
            last_error = e
            for p in work_dir.glob(f"{work_dir.name}_raw.*"):
                try:
                    p.unlink()
                except Exception:
                    pass
    raise RuntimeError(f"影片全部下載方式都失敗：{last_error}")


def transcode_to_mp4(src: Path, dst: Path, crf: int = 28, preset: str = "medium"):
    if dst.exists():
        try:
            dst.unlink()
        except Exception as e:
            raise RuntimeError(f"無法覆蓋舊輸出：{dst} / {e}")

    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-c:v", "libx264",
        "-preset", preset,
        "-crf", str(crf),
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        str(dst)
    ]
    run_cmd(cmd)

    if not dst.exists():
        raise RuntimeError(f"轉檔完成後找不到輸出檔：{dst}")


def subtitle_download_plans(url: str, out_base: str):
    common_args = [
        "--skip-download", "--write-sub", "--write-auto-sub",
        "--sub-format", "srt/vtt/best",
        "--sub-langs", "en.*,en,zh.*,zh-Hant,zh-Hans,ja.*,ja",
        "-o", out_base, url
    ]
    plans = []
    plans.append(("firefox subtitles", ["yt-dlp", "--force-overwrites", "--cookies-from-browser", "firefox"] + common_args))
    plans.append(("chrome subtitles", ["yt-dlp", "--force-overwrites", "--cookies-from-browser", "chrome"] + common_args))
    deno_exe = find_deno_exe()
    if deno_exe:
        plans.append(("deno subtitles", ["yt-dlp", "--force-overwrites", "--js-runtimes", deno_exe] + common_args))
    plans.append(("plain subtitles", ["yt-dlp", "--force-overwrites"] + common_args))
    return plans


def convert_sub_to_srt(src_sub: Path, out_srt: Path):
    if out_srt.exists():
        try:
            out_srt.unlink()
        except Exception:
            pass

    if src_sub.suffix.lower() == ".srt":
        shutil.copyfile(src_sub, out_srt)
        return

    run_cmd(["ffmpeg", "-y", "-i", str(src_sub), str(out_srt)])


def try_download_subtitles(url: str, work_dir: Path, final_srt: Path) -> bool:
    tmp_base = str(work_dir / "subs_tmp")
    plans = subtitle_download_plans(url, tmp_base)

    for name, cmd in plans:
        print(f"\n--- 嘗試抓字幕：{name} ---")
        try:
            run_cmd(cmd)
            found = [p for p in sorted(work_dir.glob("subs_tmp*")) if p.is_file()]
            sub_files = [p for p in found if p.suffix.lower() in [".srt", ".vtt", ".ass", ".srv1", ".srv2", ".srv3"]]
            if not sub_files:
                print("沒有抓到字幕檔。")
                continue

            priority = []
            for p in sub_files:
                name_lower = p.name.lower()
                score = 99
                if ".en." in name_lower or name_lower.endswith(".en.srt") or name_lower.endswith(".en.vtt"):
                    score = 0
                elif ".zh" in name_lower:
                    score = 1
                elif ".ja" in name_lower:
                    score = 2
                priority.append((score, p))
            priority.sort(key=lambda x: x[0])
            best = priority[0][1]

            print("找到字幕：", best)
            convert_sub_to_srt(best, final_srt)
            return final_srt.exists()
        except Exception as e:
            print(f"ERROR: {name} 失敗")
            print(str(e))
    return False


def try_whisper_transcribe(video_path: Path, work_dir: Path, final_srt: Path) -> bool:
    whisper_exe = shutil.which("whisper")
    if not whisper_exe:
        print("未安裝 whisper CLI，略過轉錄。")
        return False

    audio_path = work_dir / "audio_for_whisper.wav"
    if audio_path.exists():
        try:
            audio_path.unlink()
        except Exception:
            pass

    print("\n--- 嘗試用 whisper 轉錄 ---")
    run_cmd(["ffmpeg", "-y", "-i", str(video_path), "-vn", "-ac", "1", "-ar", "16000", str(audio_path)])

    if not audio_path.exists():
        return False

    run_cmd([whisper_exe, str(audio_path), "--task", "transcribe", "--model", "base", "--output_format", "srt", "--output_dir", str(work_dir)])

    whisper_srt = work_dir / f"{audio_path.stem}.srt"
    if whisper_srt.exists():
        if final_srt.exists():
            final_srt.unlink()
        shutil.copyfile(whisper_srt, final_srt)
        return True
    return False


def get_duration_seconds(path: Path) -> float:
    p = run_cmd([
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path)
    ])
    try:
        return float((p.stdout if hasattr(p, "stdout") else p).strip())
    except Exception:
        return 0.0


def make_cover_from_video(video_path: Path, jpg_path: Path):
    duration = get_duration_seconds(video_path)
    seek_sec = 3
    if duration and duration < 3:
        seek_sec = 1

    if jpg_path.exists():
        try:
            jpg_path.unlink()
        except Exception:
            pass

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(seek_sec),
        "-i", str(video_path),
        "-frames:v", "1",
        "-vf", "scale='min(1280,iw)':-2",
        "-q:v", "4",
        str(jpg_path)
    ]
    run_cmd(cmd)

    if not jpg_path.exists():
        raise RuntimeError(f"封面產生失敗：{jpg_path}")


def main():
    print("=" * 72)
    print("YouTube -> <folder>_raw.mp4 / <folder>.mp4 / <folder>.srt / <folder>.jpg")
    print("=" * 72)
    print("固定命名：")
    print("1) 原始影片：<資料夾名>_raw.mp4")
    print("2) 壓縮影片：<資料夾名>.mp4")
    print("3) 字幕檔  ：<資料夾名>.srt")
    print("4) 封面圖  ：<資料夾名>.jpg")
    print()

    require_tool("yt-dlp")
    require_tool("ffmpeg")
    require_tool("ffprobe")

    url = input("YouTube URL: ").strip().strip('"').strip("'")
    if not url or ("youtube.com" not in url and "youtu.be" not in url):
        print("網址不正確")
        return

    category = input(f"分類 {ALLOWED_CATEGORIES}: ").strip().lower()
    if category not in ALLOWED_CATEGORIES:
        print("分類錯誤")
        return

    slug_raw = input("slug（英文檔名 / 資料夾名）: ").strip()
    slug = normalize_slug(slug_raw)
    if not slug:
        print("slug 不可空白")
        return

    root = input('ROOT（例如 D:\\bookwide_cloudflare；直接 Enter = 目前資料夾）: ').strip().strip('"')
    root_dir = Path(root) if root else Path.cwd()
    if not root_dir.exists():
        print("ROOT 不存在")
        return

    work_dir = root_dir / "videos" / category / slug
    work_dir.mkdir(parents=True, exist_ok=True)

    clear_old_outputs(work_dir)

    folder_name = work_dir.name
    raw_mp4 = work_dir / f"{folder_name}_raw.mp4"
    final_mp4 = work_dir / f"{folder_name}.mp4"
    final_srt = work_dir / f"{folder_name}.srt"
    cover_jpg = work_dir / f"{folder_name}.jpg"

    print("\n[1/4] 下載影片 ...")
    downloaded = download_video_as_raw(url, work_dir, raw_mp4)
    print("原始影片：", downloaded)

    print("\n[2/4] 壓縮輸出影片 ...")
    transcode_to_mp4(downloaded, final_mp4)
    print("壓縮完成：", final_mp4)

    print("\n[3/4] 產生字幕 ...")
    ok = try_download_subtitles(url, work_dir, final_srt)
    if not ok:
        ok = try_whisper_transcribe(final_mp4, work_dir, final_srt)

    print("\n[4/4] 產生封面 ...")
    make_cover_from_video(final_mp4, cover_jpg)
    print("封面完成：", cover_jpg)

    print("\n全部完成：")
    print("原始影片：", downloaded)
    print("壓縮影片：", final_mp4)
    print("字幕檔  ：", final_srt if final_srt.exists() else "(未產生)")
    print("封面圖  ：", cover_jpg if cover_jpg.exists() else "(未產生)")
    if not ok:
        print("提示：若要在沒有 YouTube 字幕時自動轉錄，先安裝 whisper： pip install -U openai-whisper")
    input("\nENTER EXIT")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\nERROR:", str(e))
        input("\nENTER EXIT")
