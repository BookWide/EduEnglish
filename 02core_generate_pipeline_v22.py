# coding: utf-8
"""
auto_publish_v14_5_learning_ready.py
-------------------------
批次 CSV(slug+url) → BookWide 教材產檔 V14.5（learning-ready）

修正：
1) 非 music 壓縮時加入縮尺寸 / 降 fps / bitrate cap，避免壓完還很大
2) 壓縮成功後可刪除 <slug>_raw.mp4，避免資料夾同時卡兩支大檔
3) JSON 逐檔保護：某一個 GPT JSON 失敗，不會讓後面全部中止
4) JSON 失敗時自動寫入 fallback 檔，不會只剩 cues
5) index JSON 直接補 duration_sec / difficulty_level / dialogue / speaking
6) 所有錯誤會寫入 _errors 資料夾，方便追查
7) V22 SAFE STOP：任何教材失敗，02 以 returncode=1 結束，讓 00 停止後續上架
8) V41 MUSIC 補缺模式：完整教材 SKIP；半套只補 JSON；壞 cues 刪依賴 JSON 重建
9) V42 MUSIC 補缺強化：cues 缺檔也視為壞 JSON 狀態，先刪依賴 JSON 再從 SRT 重建
"""

import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_GIT_REPO = SCRIPT_DIR
DEFAULT_OUTPUT_ROOT = SCRIPT_DIR / "output_v3" / "relay_data"
DEFAULT_REVIEW_CSV = SCRIPT_DIR / "output_v3" / "youtube_list_review.csv"
TEACHER_REVIEW_CSV = SCRIPT_DIR / "output_v3" / "teacher_youtube_list_review.csv"
DEFAULT_CATEGORY = "auto"
AUTO_SKIP_DUPLICATES = True
DEFAULT_MODEL = "gpt-4.1-mini"
DEFAULT_WHISPER_MODEL = "tiny.en"

# === V36 MUSIC Whisper 多國語言修正 ===
# 一般英文教材仍可維持 tiny.en；music 依語言選模型。
# 英文 music 可用 small.en；日文/韓文/泰文/尼泊爾文等必須用 multilingual small。
# 可用環境變數強制：BOOKWIDE_MUSIC_WHISPER_MODEL=small / medium
MUSIC_WHISPER_MODEL = (
    os.environ.get("BOOKWIDE_MUSIC_WHISPER_MODEL", "").strip()
    or ""
)
ALLOWED_CATEGORIES = ["auto", "story", "movie", "music", "news", "pro"]
DELETE_RAW_AFTER_SUCCESS = True
MAX_VIDEO_WIDTH = 1280
TARGET_FPS = 24
VIDEO_CRF = 31
VIDEO_PRESET = "veryfast"
VIDEO_MAXRATE = "1600k"
VIDEO_BUFSIZE = "3200k"
AUDIO_BITRATE = "96k"

# === MUSIC KTV 伴奏版設定（最小改動） ===
# 只在 category == "music" 時產生：<slug>_karaoke.mp4
# 可用環境變數關閉：BOOKWIDE_ENABLE_MUSIC_KARAOKE=0
ENABLE_MUSIC_KARAOKE = (
    os.environ.get("BOOKWIDE_ENABLE_MUSIC_KARAOKE", "1").strip().lower()
    not in ("0", "false", "no", "off")
)
DEMUCS_MODEL = os.environ.get("BOOKWIDE_DEMUCS_MODEL", "htdemucs").strip() or "htdemucs"
KEEP_DEMUCS_WORKDIR = (
    os.environ.get("BOOKWIDE_KEEP_DEMUCS_WORKDIR", "0").strip().lower()
    in ("1", "true", "yes", "on")
)

# === MUSIC 中文 / 日文導唱 MP4（整合 17music_ktv_only_fill） ===
# 只在 category == "music" 時產生：
#   <slug>_karaoke.mp4  純伴奏
#   <slug>_zh.mp4       中文導唱
#   <slug>_ja.mp4       日文導唱
# 可用環境變數關閉：BOOKWIDE_ENABLE_MUSIC_GUIDE_TTS=0
ENABLE_MUSIC_GUIDE_TTS = (
    os.environ.get("BOOKWIDE_ENABLE_MUSIC_GUIDE_TTS", os.environ.get("BOOKWIDE_ENABLE_GUIDE_TTS", "0")).strip().lower()
    not in ("0", "false", "no", "off")
)
MUSIC_GUIDE_ZH_VOICE = os.environ.get("BOOKWIDE_TTS_ZH_VOICE", "zh-TW-HsiaoChenNeural")
MUSIC_GUIDE_JA_VOICE = os.environ.get("BOOKWIDE_TTS_JA_VOICE", "ja-JP-NanamiNeural")
MUSIC_GUIDE_TTS_VOLUME = float(os.environ.get("BOOKWIDE_TTS_VOLUME", "0.48"))
MUSIC_GUIDE_MAX_LINES = int(os.environ.get("BOOKWIDE_MAX_TTS_LINES", "120"))
MIN_MUSIC_GUIDE_BYTES = 100_000


# === V23 MUSIC MP3 語音包（取代中文/日文導唱 MP4，降低容量） ===
# 只在 category == "music" 時產生：
#   audio/en/0000.mp3, 0001.mp3 ...
#   audio/zh/0000.mp3, 0001.mp3 ...
#   music-audio-<slug>.json
# 預設只產 en,zh；若需要日文：BOOKWIDE_MUSIC_MP3_LANGS=en,zh,ja
ENABLE_MUSIC_LINE_MP3 = (
    os.environ.get("BOOKWIDE_ENABLE_MUSIC_LINE_MP3", "1").strip().lower()
    not in ("0", "false", "no", "off")
)
MUSIC_LINE_MP3_LANGS = [
    x.strip().lower()
    for x in os.environ.get("BOOKWIDE_MUSIC_MP3_LANGS", "en,zh").split(",")
    if x.strip().lower() in ("en", "zh", "ja")
]
MUSIC_LINE_MP3_VOICES = {
    "en": os.environ.get("BOOKWIDE_TTS_EN_VOICE", "en-US-AriaNeural"),
    "zh": os.environ.get("BOOKWIDE_TTS_ZH_VOICE", MUSIC_GUIDE_ZH_VOICE),
    "ja": os.environ.get("BOOKWIDE_TTS_JA_VOICE", MUSIC_GUIDE_JA_VOICE),
}
MIN_MUSIC_LINE_MP3_BYTES = int(os.environ.get("BOOKWIDE_MIN_LINE_MP3_BYTES", "900"))

OPENAI_RETRIES = 3

# === BookWide LOCAL MULTILANG ===
LOCAL_LANG_LABELS = {
    "ja": "日文", "jp": "日文",
    "it": "義大利文", "es": "西班牙文", "fr": "法文", "de": "德文",
    "ko": "韓文", "zh": "中文", "zh-tw": "中文", "ne": "尼泊爾文", "hi": "印地文", "da": "丹麥文",
    "pt": "葡文", "th": "泰文", "vi": "越文", "id": "印尼文",
}

def bw_local_lang() -> str:
    raw = (os.environ.get("BW_LOCAL_LANG") or os.environ.get("BOOKWIDE_LOCAL_LANG") or "ja").strip().lower()
    raw = raw.replace("_", "-").split("-")[0]
    return raw or "ja"

def bw_local_label() -> str:
    lang = bw_local_lang()
    return (os.environ.get("BW_LOCAL_LABEL") or os.environ.get("BOOKWIDE_LOCAL_LABEL") or LOCAL_LANG_LABELS.get(lang, lang)).strip()

# local_pron 統一規則：
# - 前台「讀」當地語時，一律優先讀 local_pron / <lang>_pron（羅馬拼音）。
# - local_pron 不放 IPA，不加 /.../；IPA 只留給英文 ipa 欄位。
# - 拉丁字母語言（丹麥/法/義/西/德等）可用去重音後的當地語原文當羅馬拼音。
# - 非拉丁字母語言（尼泊爾/印地/泰/韓等）必須由 GPT 產 Latin romanization。
LATIN_LOCAL_LANGS = {
    "da", "sv", "no", "nb", "nn", "fi", "is",
    "it", "es", "fr", "de", "pt", "vi", "id",
    "nl", "pl", "tr", "cs", "sk", "sl", "hr", "ro", "hu",
}
LOCAL_ROMAN_CHAR_MAP = str.maketrans({
    "æ": "ae", "Æ": "Ae",
    "ø": "o",  "Ø": "O",
    "å": "aa", "Å": "Aa",
    "ð": "d",  "Ð": "D",
    "þ": "th", "Þ": "Th",
    "ß": "ss",
    "œ": "oe", "Œ": "Oe",
})

def bw_strip_ipa_wrapper(v: str) -> str:
    s = str(v or "").strip()
    if len(s) >= 2 and s.startswith("/") and s.endswith("/"):
        return s[1:-1].strip()
    return s

def bw_has_non_latin_script(v: str) -> bool:
    s = str(v or "")
    # CJK / kana / hangul / devanagari / thai 等常見非拉丁文字
    return bool(re.search(r"[\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]", s))

def bw_romanize_latin_text(v: str) -> str:
    import unicodedata
    s = bw_strip_ipa_wrapper(str(v or ""))
    s = s.translate(LOCAL_ROMAN_CHAR_MAP)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"\s+", " ", s).strip()
    return s

def bw_should_auto_romanize(lang: str, local_text: str) -> bool:
    lang = (lang or "").lower()
    if lang in LATIN_LOCAL_LANGS:
        return True
    # 只要原文沒有非拉丁文字，也可直接當羅馬拼音使用。
    return bool(local_text) and not bw_has_non_latin_script(local_text)

def bw_pick_roman_pron(d: Dict[str, Any], lang: str, local_text: str, prefix: str = "") -> str:
    keys = [
        f"{prefix}local_pron" if prefix else "local_pron",
        f"{prefix}{lang}_pron" if prefix else f"{lang}_pron",
        f"{prefix}romanization" if prefix else "romanization",
        f"{prefix}romaji" if prefix else "romaji",
    ]
    # 日文才允許把 kana 當讀音；其他語言不把假名/IPA 當羅馬拼音。
    if lang in ("ja", "jp"):
        keys.append(f"{prefix}kana" if prefix else "kana")

    existing = ""
    for k in keys:
        val = str(d.get(k) or "").strip()
        if val:
            existing = val
            break

    if lang not in ("ja", "jp") and bw_should_auto_romanize(lang, local_text):
        # 拉丁字母語言不要保留 IPA /.../；直接用可讀羅馬字。
        return bw_romanize_latin_text(local_text)

    if existing:
        return bw_strip_ipa_wrapper(existing)

    return ""

def bw_local_instruction() -> str:
    lang = bw_local_lang()
    label = bw_local_label()

    if lang == "en":
        return (
            "本教材的當地語言是英文（代碼 en）。\n"
            "ja / answer_ja / ja_example / ja物件永遠必須保留真正自然日文，不可改成英文。\n"
            "local / en 可放英文原文或英文解釋。\n"
            "英文不需要羅馬拼音：local_pron / en_pron / local_example_pron / answer_local_pron 一律留空。\n"
            "不可把英文原文重複寫成羅馬拼音。\n"
            "每筆仍須寫 local_lang='en'、local_label='英文'。"
        )

    return (
        f"本教材的第三語/當地語言是 {label}（代碼 {lang}）。\n"
        "ja / answer_ja / ja_example / ja物件永遠保留真正自然日文，不可被當地語覆蓋。\n"
        f"local / {lang} 欄位才放自然的{label}。\n"
        f"每筆寫 local_lang='{lang}', local_label='{label}'。\n"
        f"local_pron / {lang}_pron 使用 Latin letters，不可使用 IPA。\n"
        "日文欄與當地語欄必須分開。"
    )


def bw_apply_local_fields(obj: Any) -> Any:
    lang = bw_local_lang()
    label = bw_local_label()
    if lang in ("ja", "jp"):
        return obj

    def patch_item(d: Dict[str, Any]) -> None:
        # V49：英文歌 / 英文教材時，ja 是「日文意思」，不能被 local/en 覆蓋成英文。
        if lang == "en":
            local_text = str(d.get("local") or d.get("en") or d.get("text") or "").strip()
            if local_text:
                d["local"] = local_text
                d["en"] = local_text
            # 英文不需要羅馬拼音，避免 Talk 顯示第三行重複英文。
            d["local_pron"] = ""
            d["en_pron"] = ""
        else:
            local_text = str(d.get("local") or d.get(lang) or d.get("ja") or "").strip()
            if local_text:
                d["local"] = local_text
                d[lang] = local_text
                d["ja"] = local_text
                pron = bw_pick_roman_pron(d, lang, local_text)
                if pron:
                    d["local_pron"] = pron
                    d[f"{lang}_pron"] = pron

        d["local_lang"] = lang
        d["local_label"] = label

        # quiz answer compatibility
        ans = str(d.get("answer_local") or d.get(f"answer_{lang}") or d.get("answer_ja") or "").strip()
        if ans:
            d["answer_local"] = ans
            d[f"answer_{lang}"] = ans
            if lang != "en":
                d["answer_ja"] = ans
            if lang == "en":
                d["answer_local_pron"] = ""
                d["answer_en_pron"] = ""
            else:
                ans_pron = bw_pick_roman_pron(d, lang, ans, prefix="answer_")
                if ans_pron:
                    d["answer_local_pron"] = ans_pron
                    d[f"answer_{lang}_pron"] = ans_pron

        # vocab examples compatibility
        ex = str(d.get("local_example") or d.get(f"{lang}_example") or d.get("ja_example") or "").strip()
        if ex:
            d["local_example"] = ex
            d[f"{lang}_example"] = ex
            if lang != "en":
                d["ja_example"] = ex
            if lang == "en":
                d["local_example_pron"] = ""
                d["en_example_pron"] = ""
            else:
                ex_pron = bw_pick_roman_pron(d, lang, ex, prefix="example_")
                if ex_pron:
                    d["local_example_pron"] = ex_pron
                    d[f"{lang}_example_pron"] = ex_pron

    if isinstance(obj, list):
        for x in obj:
            if isinstance(x, dict):
                patch_item(x)
    elif isinstance(obj, dict):
        obj["local_lang"] = lang
        obj["local_label"] = label
        if isinstance(obj.get("dialogue"), list):
            for x in obj["dialogue"]:
                if isinstance(x, dict):
                    patch_item(x)
        if lang == "en":
            if isinstance(obj.get("en"), dict):
                obj["local"] = obj.get("en")
            # 不動 obj["ja"]；ja 在英文歌代表日文意思。
        elif isinstance(obj.get("ja"), dict):
            obj["local"] = obj.get("ja")
            obj[lang] = obj.get("ja")
        elif isinstance(obj.get(lang), dict):
            obj["local"] = obj.get(lang)
            obj["ja"] = obj.get(lang)
    return obj


# === V31 MUSIC native/roman 相容欄位 ===
# 新版 Music cues 固定提供：native / roman / en / zh。
# 舊欄位 local/local_pron/ja 仍保留，避免舊 player 或其他分類壞掉。
def bw_apply_native_roman_fields(obj: Any, category: str = "") -> Any:
    lang = bw_local_lang()
    label = bw_local_label()
    is_music = str(category or "").strip().lower().split("/", 1)[0] == "music"

    def patch(d: Dict[str, Any]) -> None:
        if not isinstance(d, dict):
            return

        en_text = str(d.get("en") or d.get("text") or "").strip()
        local_text = str(d.get("local") or d.get(lang) or d.get("ja") or "").strip()
        kana_text = str(d.get("kana") or d.get("ja_kana") or d.get("furigana") or "").strip()
        pron_text = str(
            d.get("local_pron") or d.get(f"{lang}_pron") or
            d.get("roman") or d.get("romanization") or d.get("romaji") or ""
        ).strip()

        if is_music:
            # V35：music 的 native 必須是原唱語言。
            # 韓文：native=ko/local，不可讓 GPT 的英文 native 蓋掉。
            # 日文：native=ja/local，輔助用 kana。
            native_text = local_text or str(d.get("native") or "").strip() or en_text
        else:
            native_text = str(d.get("native") or "").strip() or en_text

        if native_text:
            d["native"] = native_text

        if lang in ("ja", "jp"):
            if kana_text:
                d["kana"] = kana_text
            # 日文歌不要顯示羅馬拼音；保留 local_pron/ja_pron 給相容或 TTS。
            d.pop("roman", None)
        else:
            if not pron_text and local_text:
                pron_text = bw_pick_roman_pron(d, lang, local_text)
            if not pron_text and native_text:
                pron_text = bw_pick_roman_pron(d, lang, native_text)
            if pron_text:
                pron_text = bw_strip_ipa_wrapper(pron_text)
                d["roman"] = pron_text
                if not d.get("local_pron"):
                    d["local_pron"] = pron_text
                if not d.get(f"{lang}_pron"):
                    d[f"{lang}_pron"] = pron_text

        if is_music:
            d["lyrics_mode"] = "native_roman_en_zh"
            d["local_lang"] = str(d.get("local_lang") or lang)
            d["local_label"] = str(d.get("local_label") or label)

    if isinstance(obj, list):
        for x in obj:
            if isinstance(x, dict):
                patch(x)
    elif isinstance(obj, dict):
        arr = obj.get("cues") if isinstance(obj.get("cues"), list) else None
        if arr is not None:
            for x in arr:
                if isinstance(x, dict):
                    patch(x)
        else:
            patch(obj)
    return obj



# === V44 MUSIC 三格式固定 schema ===
# 由 Production-Center 的 local_lang 決定 Music cues 格式：
# 1) en：英文歌舊格式 en / zh / ja；native/local 同 en；roman/local_pron 空。
# 2) ja：日文歌 native(日文) / kana(假名) / en / zh；roman 空。
# 3) zh：中文歌 native(中文) / pinyin / en / ja；zh 同 native，不重複當翻譯。
# 4) 其他：原文 native / roman / en / zh；韓文、泰文、尼泊爾文等都比照此格式。
def _bw_text_has_english(v: str) -> bool:
    return bool(re.search(r"[A-Za-z]{2,}", str(v or "")))

def _bw_text_has_japanese(v: str) -> bool:
    return bool(re.search(r"[\u3040-\u30FF\u3400-\u9FFF]", str(v or "")))

def _bw_text_has_hangul(v: str) -> bool:
    return bool(re.search(r"[\uAC00-\uD7AF]", str(v or "")))

def _bw_text_has_chinese(v: str) -> bool:
    return bool(re.search(r"[\u4E00-\u9FFF]", str(v or "")))

def _bw_pick_first_text(*vals: Any) -> str:
    for v in vals:
        s = str(v or "").strip()
        if s:
            return s
    return ""

def _bw_pick_native_for_lang(d: Dict[str, Any], lang: str) -> str:
    lang = (lang or "").lower()
    candidates = [
        str(d.get("native") or "").strip(),
        str(d.get("local") or "").strip(),
        str(d.get(lang) or "").strip(),
        str(d.get("ja") or "").strip(),
    ]
    if lang in ("ja", "jp"):
        for s in candidates:
            if _bw_text_has_japanese(s):
                return s
    elif lang == "ko":
        for s in candidates:
            if _bw_text_has_hangul(s):
                return s
    elif lang in ("zh", "zh-tw", "zh-cn", "cn"):
        # 中文歌：zh 是原唱中文，不是翻譯；優先 local / zh / native / text。
        for s in [candidates[1], str(d.get("zh") or "").strip(), candidates[0], str(d.get("text") or "").strip(), candidates[3]]:
            if s and _bw_text_has_chinese(s):
                return s
        for s in [candidates[1], str(d.get("zh") or "").strip(), candidates[0], str(d.get("text") or "").strip(), candidates[3]]:
            if s:
                return s
    else:
        # 其他語言：優先 local / <lang> / native。避免 en 被拿去當 native。
        for s in [candidates[1], candidates[2], candidates[0], candidates[3]]:
            if s:
                return s
    return _bw_pick_first_text(*candidates)

def normalize_music_cue_schema(obj: Any) -> Any:
    """
    產檔端固定 Music cues schema，避免 player 一直容錯。
    注意：這裡以 Production-Center 傳入的 BW_LOCAL_LANG / BOOKWIDE_LOCAL_LANG 為準。
    """
    arr = obj if isinstance(obj, list) else (obj.get("cues") if isinstance(obj, dict) else None)
    if not isinstance(arr, list):
        return obj

    lang = bw_local_lang()
    label = bw_local_label()
    lang_norm = "ja" if lang == "jp" else lang

    for d in arr:
        if not isinstance(d, dict):
            continue

        time_text = str(d.get("time") or "").strip()
        en_text = _bw_pick_first_text(d.get("en"), d.get("english"), d.get("translation_en"))
        zh_text = _bw_pick_first_text(d.get("zh"), d.get("zh_tw"), d.get("translation_zh"))

        if lang_norm == "en":
            # 英文歌：回舊格式 en / zh / ja。
            # 如果 GPT 把英文歌詞放在 native，en 空，補回 en。
            native_candidate = str(d.get("native") or "").strip()
            if not en_text and _bw_text_has_english(native_candidate):
                en_text = native_candidate
            if not en_text:
                en_text = _bw_pick_first_text(d.get("text"), native_candidate)

            ja_text = _bw_pick_first_text(d.get("ja"), d.get("local_ja"), d.get("translation_ja"))
            # 若 ja 被舊 local 流程誤蓋成英文，留空，避免前台顯示重複英文。
            if ja_text and en_text and _bw_norm_line_for_quality(ja_text) == _bw_norm_line_for_quality(en_text):
                ja_text = ""

            d.clear()
            d.update({
                "time": time_text,
                "en": en_text,
                "zh": zh_text,
                "ja": ja_text,
                "native": en_text,
                "roman": "",
                "local": en_text,
                "local_pron": "",
                "local_lang": "en",
                "local_label": "英文",
                "lyrics_mode": "en_zh_ja",
            })
            continue

        if lang_norm in ("ja", "jp"):
            # 日文歌：native 日文、kana 假名、en、zh。
            native_text = _bw_pick_native_for_lang(d, "ja")
            kana_text = _bw_pick_first_text(d.get("kana"), d.get("local_pron"), d.get("ja_pron"), d.get("furigana"))
            # 若 native 仍被 GPT 放成英文，但 ja/local 有日文，_bw_pick_native_for_lang 已會優先日文。
            d["time"] = time_text
            d["native"] = native_text
            d["kana"] = kana_text
            d["roman"] = ""
            d["en"] = en_text
            d["zh"] = zh_text
            d["ja"] = native_text
            d["local"] = native_text
            d["local_pron"] = kana_text
            d["ja_pron"] = kana_text
            d["local_lang"] = "ja"
            d["local_label"] = "日文"
            d["lyrics_mode"] = "ja_kana_en_zh"
            continue

        if lang_norm in ("zh", "zh-tw", "zh-cn", "cn"):
            # 中文歌：native/zh 是中文原詞；pinyin/roman 是拼音；en 英文意思；ja 日文意思。
            native_text = _bw_pick_native_for_lang(d, "zh")
            pinyin_text = _bw_pick_first_text(
                d.get("pinyin"),
                d.get("roman"),
                d.get("local_pron"),
                d.get("zh_pron"),
                d.get("zh_tw_pron"),
                d.get("romanization"),
            )
            pinyin_text = bw_strip_ipa_wrapper(pinyin_text)
            ja_text = _bw_pick_first_text(d.get("ja"), d.get("translation_ja"), d.get("jp"))
            # 若 ja 被誤放成中文原文，先留空，避免重複。
            if ja_text and native_text:
                # V47：中文/日文經 _bw_norm_line_for_quality 可能同為空，不能只靠 norm。
                # 但 raw 完全相同時一定是 GPT 把中文原詞塞進 ja，必須清掉給後面 repair 補日文意思。
                _ja_raw = re.sub(r"\s+", "", ja_text)
                _native_raw = re.sub(r"\s+", "", native_text)
                _zh_raw = re.sub(r"\s+", "", zh_text)
                _ja_norm = _bw_norm_line_for_quality(ja_text)
                _native_norm = _bw_norm_line_for_quality(native_text)
                if (_ja_raw and (_ja_raw == _native_raw or _ja_raw == _zh_raw)) or (_ja_norm and _native_norm and _ja_norm == _native_norm):
                    ja_text = ""
            d["time"] = time_text
            d["native"] = native_text
            d["pinyin"] = pinyin_text
            d["roman"] = pinyin_text
            d["en"] = en_text
            d["zh"] = native_text
            d["ja"] = ja_text
            d["local"] = native_text
            d["local_pron"] = pinyin_text
            d["zh_pron"] = pinyin_text
            d["local_lang"] = "zh"
            d["local_label"] = "中文"
            d["lyrics_mode"] = "zh_pinyin_en_ja"
            continue

        # 韓文與其他語言：native 原文、roman 羅馬拼音、en、zh。
        native_text = _bw_pick_native_for_lang(d, lang_norm)
        roman_text = _bw_pick_first_text(
            d.get("roman"),
            d.get("local_pron"),
            d.get(f"{lang_norm}_pron"),
            d.get("romanization"),
            d.get("romaji"),
        )
        if not roman_text and native_text:
            roman_text = bw_pick_roman_pron(d, lang_norm, native_text)
        roman_text = bw_strip_ipa_wrapper(roman_text)

        d["time"] = time_text
        d["native"] = native_text
        d["roman"] = roman_text
        d["en"] = en_text
        d["zh"] = zh_text
        # 舊欄位相容：ja/local 都放原文，不再讓 player 猜。
        d["ja"] = native_text
        d["local"] = native_text
        d[lang_norm] = native_text
        d["local_pron"] = roman_text
        d[f"{lang_norm}_pron"] = roman_text
        d["local_lang"] = lang_norm
        d["local_label"] = label
        d["lyrics_mode"] = "native_roman_en_zh"

    return obj

def validate_music_cue_schema(obj: Any, slug: str = "") -> None:
    arr = obj if isinstance(obj, list) else (obj.get("cues") if isinstance(obj, dict) else None)
    if not isinstance(arr, list) or not arr:
        raise RuntimeError("MUSIC schema 檢查失敗：cues 空白或不是陣列")

    lang = bw_local_lang()
    lang_norm = "ja" if lang == "jp" else lang

    bad: List[str] = []
    for i, d in enumerate(arr, start=1):
        if not isinstance(d, dict):
            bad.append(f"#{i} 不是物件")
            continue
        en = str(d.get("en") or "").strip()
        zh = str(d.get("zh") or "").strip()
        native = str(d.get("native") or "").strip()
        if not str(d.get("time") or "").strip():
            bad.append(f"#{i} 缺 time")
        if not en:
            bad.append(f"#{i} 缺 en")
        if not zh:
            bad.append(f"#{i} 缺 zh")
        if not native:
            bad.append(f"#{i} 缺 native")

        if lang_norm == "en":
            if d.get("lyrics_mode") != "en_zh_ja":
                bad.append(f"#{i} 英文歌 lyrics_mode 不是 en_zh_ja")
            ja_text = str(d.get("ja") or "").strip()
            if not ja_text:
                bad.append(f"#{i} 英文歌缺 ja 日文意思")
            else:
                _ja_raw = re.sub(r"\s+", "", ja_text).lower()
                _en_raw = re.sub(r"\s+", "", en).lower()
                _native_raw = re.sub(r"\s+", "", native).lower()
                if _ja_raw and (_ja_raw == _en_raw or _ja_raw == _native_raw):
                    bad.append(f"#{i} 英文歌 ja 不可照抄英文原詞")
            if native and en and _bw_norm_line_for_quality(native) != _bw_norm_line_for_quality(en):
                bad.append(f"#{i} 英文歌 native 必須等於 en")
        elif lang_norm in ("ja", "jp"):
            if d.get("lyrics_mode") != "ja_kana_en_zh":
                bad.append(f"#{i} 日文歌 lyrics_mode 不是 ja_kana_en_zh")
            if not str(d.get("kana") or "").strip():
                bad.append(f"#{i} 日文歌缺 kana 假名")
            if str(d.get("roman") or "").strip():
                bad.append(f"#{i} 日文歌 roman 必須留空")
        elif lang_norm in ("zh", "zh-tw", "zh-cn", "cn"):
            if d.get("lyrics_mode") != "zh_pinyin_en_ja":
                bad.append(f"#{i} 中文歌 lyrics_mode 不是 zh_pinyin_en_ja")
            if not str(d.get("pinyin") or d.get("roman") or "").strip():
                bad.append(f"#{i} 中文歌缺 pinyin/roman 拼音")
            ja_text = str(d.get("ja") or "").strip()
            if not ja_text:
                bad.append(f"#{i} 中文歌缺 ja 日文意思")
            elif native and ja_text == native:
                bad.append(f"#{i} 中文歌 ja 不可照抄中文原詞")
            elif zh and ja_text == zh:
                bad.append(f"#{i} 中文歌 ja 不可照抄 zh 中文原詞")
            if native and zh and _bw_norm_line_for_quality(native) != _bw_norm_line_for_quality(zh):
                bad.append(f"#{i} 中文歌 zh 必須等於 native")
        else:
            if d.get("lyrics_mode") != "native_roman_en_zh":
                bad.append(f"#{i} 外語歌 lyrics_mode 不是 native_roman_en_zh")
            if not str(d.get("roman") or "").strip():
                bad.append(f"#{i} 外語歌缺 roman")
    if bad:
        raise RuntimeError("MUSIC schema 檢查失敗：" + (f" slug={slug} " if slug else " ") + "；".join(bad[:12]))



def repair_en_music_cues_with_openai(api_key: str, obj: Any, slug: str = "") -> Any:
    """
    V48 英文歌二次補欄位：
    英文歌固定 en / zh / ja；若 GPT 或舊流程讓 ja 空白、或 ja 照抄英文，
    這裡只補缺少的日文意思，避免前台「英文 / 中文 / 日文」只剩兩行。
    """
    lang = bw_local_lang()
    if lang != "en":
        return obj

    arr = obj if isinstance(obj, list) else (obj.get("cues") if isinstance(obj, dict) else None)
    if not isinstance(arr, list) or not arr:
        return obj

    missing_rows: List[Dict[str, str]] = []
    for i, d in enumerate(arr):
        if not isinstance(d, dict):
            continue
        en = str(d.get("en") or d.get("native") or d.get("text") or "").strip()
        zh = str(d.get("zh") or "").strip()
        ja = str(d.get("ja") or "").strip()
        if ja and en:
            _ja_raw = re.sub(r"\s+", "", ja).lower()
            _en_raw = re.sub(r"\s+", "", en).lower()
            _native_raw = re.sub(r"\s+", "", str(d.get("native") or "")).lower()
            _ja_norm = _bw_norm_line_for_quality(ja)
            _en_norm = _bw_norm_line_for_quality(en)
            if (_ja_raw and (_ja_raw == _en_raw or _ja_raw == _native_raw)) or (_ja_norm and _en_norm and _ja_norm == _en_norm):
                ja = ""
                d["ja"] = ""
        if en and not ja:
            missing_rows.append({
                "idx": str(i),
                "time": str(d.get("time") or "").strip(),
                "en": en,
                "zh": zh,
                "ja": ja,
            })

    if not missing_rows:
        return obj

    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你只會輸出 JSON。請補齊英文歌 cues 缺少的日文意思。"
                    "輸出必須是 JSON 陣列，每筆只包含 idx,time,ja。"
                    "ja 必須是自然日文意思，不可空白，不可照抄英文，不可放中文。"
                    "保留歌詞語氣，短句即可。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(missing_rows, ensure_ascii=False),
            },
        ],
        "temperature": 0.1,
    }

    try:
        raw = openai_chat(api_key, payload)
        fixed = json.loads(raw)
        if isinstance(fixed, dict) and isinstance(fixed.get("items"), list):
            fixed = fixed["items"]
        if not isinstance(fixed, list):
            raise RuntimeError("OpenAI 補英文歌 ja 回傳不是陣列")

        by_idx: Dict[int, Dict[str, Any]] = {}
        by_time: Dict[str, Dict[str, Any]] = {}
        for item in fixed:
            if not isinstance(item, dict):
                continue
            try:
                idx = int(str(item.get("idx") or "").strip())
                by_idx[idx] = item
            except Exception:
                pass
            t = str(item.get("time") or "").strip()
            if t:
                by_time[t] = item

        for i, d in enumerate(arr):
            if not isinstance(d, dict):
                continue
            item = by_idx.get(i) or by_time.get(str(d.get("time") or "").strip())
            if not isinstance(item, dict):
                continue
            ja = str(item.get("ja") or "").strip()
            en = str(d.get("en") or d.get("native") or "").strip()
            if ja:
                _ja_raw = re.sub(r"\s+", "", ja).lower()
                _en_raw = re.sub(r"\s+", "", en).lower()
                _native_raw = re.sub(r"\s+", "", str(d.get("native") or "")).lower()
                _ja_norm = _bw_norm_line_for_quality(ja)
                _en_norm = _bw_norm_line_for_quality(en)
                if not ((_ja_raw and (_ja_raw == _en_raw or _ja_raw == _native_raw)) or (_ja_norm and _en_norm and _ja_norm == _en_norm)):
                    d["ja"] = ja

        obj = normalize_music_cue_schema(obj)
        print(f"[V48 EN MUSIC REPAIR] 已補英文歌 ja：{len(missing_rows)} 列")
        return obj
    except Exception as e:
        print(f"[V48 EN MUSIC REPAIR] 補英文歌 ja 失敗，交由 schema 檢查停止：{e}")
        return obj


def repair_zh_music_cues_with_openai(api_key: str, obj: Any, slug: str = "") -> Any:
    """
    V45 中文歌二次補欄位：
    GPT 有時會產出 zh/pinyin/en，但漏掉 ja，導致 validate_music_cue_schema 擋下。
    local_lang=zh 時，這裡只針對缺 pinyin 或 ja 的列做二次補齊，避免整首重跑。
    """
    lang = bw_local_lang()
    if lang not in ("zh", "zh-tw", "zh-cn", "cn"):
        return obj

    arr = obj if isinstance(obj, list) else (obj.get("cues") if isinstance(obj, dict) else None)
    if not isinstance(arr, list) or not arr:
        return obj

    missing_rows: List[Dict[str, str]] = []
    for i, d in enumerate(arr):
        if not isinstance(d, dict):
            continue
        native = str(d.get("native") or d.get("zh") or d.get("local") or d.get("text") or "").strip()
        en = str(d.get("en") or "").strip()
        pinyin = str(d.get("pinyin") or d.get("roman") or d.get("local_pron") or "").strip()
        ja = str(d.get("ja") or "").strip()
        # ja 若等於中文原詞，視為缺日文意思。
        if ja and native:
            # V47：raw 完全相同也要擋；中文/日文 norm 可能同為空，不能只靠 norm。
            _ja_raw = re.sub(r"\s+", "", ja)
            _native_raw = re.sub(r"\s+", "", native)
            _zh_raw = re.sub(r"\s+", "", str(d.get("zh") or ""))
            _ja_norm = _bw_norm_line_for_quality(ja)
            _native_norm = _bw_norm_line_for_quality(native)
            if (_ja_raw and (_ja_raw == _native_raw or _ja_raw == _zh_raw)) or (_ja_norm and _native_norm and _ja_norm == _native_norm):
                ja = ""
                d["ja"] = ""
        if native and (not pinyin or not ja):
            missing_rows.append({
                "idx": str(i),
                "time": str(d.get("time") or "").strip(),
                "zh": native,
                "en": en,
                "pinyin": pinyin,
                "ja": ja,
            })

    if not missing_rows:
        return obj

    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你只會輸出 JSON。請補齊中文歌 cues 缺少的漢語拼音與日文意思。"
                    "輸出必須是 JSON 陣列，每筆只包含 idx,time,pinyin,ja。"
                    "pinyin 使用漢語拼音 Latin letters，不加聲調符號也可。"
                    "ja 必須是自然日文意思，不可空白，不可照抄中文。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(missing_rows, ensure_ascii=False),
            },
        ],
        "temperature": 0.1,
    }

    try:
        raw = openai_chat(api_key, payload)
        fixed = json.loads(raw)
        if isinstance(fixed, dict) and isinstance(fixed.get("items"), list):
            fixed = fixed["items"]
        if not isinstance(fixed, list):
            raise RuntimeError("OpenAI 補 ja/pinyin 回傳不是陣列")

        by_idx: Dict[int, Dict[str, Any]] = {}
        by_time: Dict[str, Dict[str, Any]] = {}
        for item in fixed:
            if not isinstance(item, dict):
                continue
            try:
                idx = int(str(item.get("idx") or "").strip())
                by_idx[idx] = item
            except Exception:
                pass
            t = str(item.get("time") or "").strip()
            if t:
                by_time[t] = item

        for i, d in enumerate(arr):
            if not isinstance(d, dict):
                continue
            item = by_idx.get(i) or by_time.get(str(d.get("time") or "").strip())
            if not isinstance(item, dict):
                continue
            pinyin = str(item.get("pinyin") or "").strip()
            ja = str(item.get("ja") or "").strip()
            native = str(d.get("native") or d.get("zh") or d.get("local") or "").strip()
            if pinyin:
                d["pinyin"] = pinyin
                d["roman"] = pinyin
                d["local_pron"] = pinyin
                d["zh_pron"] = pinyin
            if ja:
                _ja_raw = re.sub(r"\s+", "", ja)
                _native_raw = re.sub(r"\s+", "", native)
                _zh_raw = re.sub(r"\s+", "", str(d.get("zh") or ""))
                _ja_norm = _bw_norm_line_for_quality(ja)
                _native_norm = _bw_norm_line_for_quality(native)
                # V47：OpenAI 補回來仍照抄中文時，不寫入，讓 schema 擋下重新處理。
                if not ((_ja_raw and (_ja_raw == _native_raw or _ja_raw == _zh_raw)) or (native and _ja_norm and _native_norm and _ja_norm == _native_norm)):
                    d["ja"] = ja

        # 二次 normalize，確保相容欄位一致。
        obj = normalize_music_cue_schema(obj)
        print(f"[V45 ZH MUSIC REPAIR] 已補中文歌 pinyin/ja：{len(missing_rows)} 列")
        return obj
    except Exception as e:
        print(f"[V45 ZH MUSIC REPAIR] 補中文歌 pinyin/ja 失敗，交由 schema 檢查停止：{e}")
        return obj





# === V32 MUSIC mantra / meditation 防假歌詞 ===
# 梵音、咒語、冥想音樂常沒有可靠逐字字幕；Whisper 會把它亂聽成英文歌詞。
# 這裡偵測「字幕內容過少 / Music 佔位過多 / 重複音節過多」時，
# 不再送 GPT 硬編歌詞，改產生誠實的意境 cues。
def bw_is_music_transcript_unreliable(segments: List[Dict[str, str]], slug: str = "") -> bool:
    # V40：韓文/日文/中文/泰文等非拉丁歌詞不能因為英文 words=0 就判成 mantra。
    # 只要 SRT 裡有足夠原文歌詞，就交給正常 cues chunk 流程，讓 GPT 產 en/zh/roman。
    if not segments:
        return True
    texts = [str(x.get("text") or "").strip() for x in segments if str(x.get("text") or "").strip()]
    if not texts:
        return True

    native_re = re.compile(r"[\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]")
    native_lines = sum(1 for t in texts if native_re.search(t))
    native_chars = sum(len(re.findall(native_re, t)) for t in texts)
    native_ratio = native_lines / max(1, len(texts))
    if native_chars >= 20 and native_ratio >= 0.35:
        return False

    joined = " ".join(texts).strip()
    norm = re.sub(r"[^a-zA-Z\u4e00-\u9fff ]+", " ", joined).lower()
    words = [w for w in norm.split() if w]
    if not words:
        return True
    bad = {"music", "lyrics", "song", "audio", "instrumental", "foreign", "chanting", "mantra", "om", "aum", "ah", "hmm", "mmm"}
    bad_count = sum(1 for w in words if w in bad)
    unique_ratio = len(set(words)) / max(1, len(words))
    meaningful = [w for w in words if w not in bad and len(w) >= 3]
    # 1小時咒語常只有少量重複聲音；這種不要硬編逐字歌詞。
    if bad_count / max(1, len(words)) >= 0.35:
        return True
    if len(words) >= 30 and unique_ratio < 0.18:
        return True
    if len(meaningful) < max(8, int(len(words) * 0.18)):
        return True
    return False


def fallback_music_meditation_cues(segments: List[Dict[str, str]], youtube_url: str = "") -> List[Dict[str, Any]]:
    usable = [x for x in (segments or []) if str(x.get("time") or "").strip()]
    if not usable:
        usable = [{"time": "00:00:00", "text": ""}]
    # 避免一小時產上百行空泛 cues；取最多 24 個時間點。
    step = max(1, len(usable) // 24)
    picked = usable[::step][:24]
    out: List[Dict[str, Any]] = []
    for i, seg in enumerate(picked):
        item = {
            "time": str(seg.get("time") or "00:00:00").strip(),
            "native": "Mantra / meditative chanting",
            "roman": "",
            "en": "Meditative chanting; no reliable word-for-word lyrics available.",
            "zh": "冥想吟唱／咒語音樂；目前沒有可靠逐字歌詞，建議以旋律、節奏與意境理解。",
            "ja": "",
            "local": "",
            "local_pron": "",
            "local_lang": bw_local_lang(),
            "local_label": bw_local_label(),
            "lyrics_mode": "music_meditation_no_fake_lyrics",
        }
        if i == 0 and youtube_url:
            item["source_url"] = youtube_url
        out.append(item)
    return out

# === V30 MOVIE / LONG VIDEO CUES 完整性修正 ===
# 舊版把整支長片 SRT 一次丟給 GPT 產 cues。
# 長片（例如 86 分鐘）會出現「GPT 回合法 JSON，但只回前 6 分鐘」的半套 cues。
# 改成：
# 1) 長字幕 cues 分批產生再合併
# 2) 寫入前檢查 cues 最後時間是否覆蓋 SRT
# 3) 續跑時也檢查舊 cues，截斷檔會自動刪掉重生
CUES_CHUNK_SIZE = int(os.environ.get("BOOKWIDE_CUES_CHUNK_SIZE", "80"))
CUES_MIN_CHUNK_SIZE = 20
CUES_MAX_ACCEPTED_TAIL_GAP_SEC = int(os.environ.get("BOOKWIDE_CUES_MAX_TAIL_GAP_SEC", "300"))

# === V39 MUSIC cues 分批修正 ===
# 韓文/日文 music 若一次把 35~80 行丟 GPT，常只回前半首，導致 cues_last 遠小於 srt_last。
# music cues 預設改成小批次生成，避免只產到前段。
MUSIC_CUES_CHUNK_SIZE = int(os.environ.get("BOOKWIDE_MUSIC_CUES_CHUNK_SIZE", "12"))

ENABLE_GPU_AUTO = True
NVENC_PRESET = "p3"
NVENC_CQ = "20"
NVENC_RC = "vbr"
WHISPER_FP16 = True


DOMAIN_KEYWORDS = {
    "healthcare": ["doctor", "clinic", "hospital", "nurse", "patient", "medical", "appointment", "symptom", "diagnosis", "prescription", "insurance", "emergency"],
    "education": ["teacher", "student", "classroom", "school", "lesson", "parent", "instruction", "question"],
    "business": ["meeting", "client", "presentation", "email", "office", "schedule", "negotiation", "call"],
    "engineering": ["engineer", "technical", "system", "debug", "documentation", "deployment", "factory", "process"],
    "service": ["customer", "restaurant", "hotel", "reservation", "checkout", "order", "complaint", "front desk"],
    "student": ["school life", "homework", "group work", "self introduction", "campus", "daily conversation"],
    "lifestyle": ["airport", "travel", "shopping", "restaurant", "directions", "transportation", "hotel"],
    "finance": ["finance", "bank", "accounting", "budget", "invoice", "report", "analyst"],
    "marketing": ["marketing", "brand", "campaign", "promotion", "social media", "audience"],
    "it": ["software", "system", "it support", "data", "code", "server", "bug"],
    "legal": ["legal", "law", "contract", "compliance", "case", "agreement"],
    "manufacturing": ["factory", "production", "warehouse", "quality", "inspection", "operator"],
}

DOMAIN_ROLE_MAP = {
    "healthcare": ["nurse", "physician", "clinic_staff", "patient"],
    "education": ["elementary_teacher", "junior_teacher", "senior_teacher", "tutor", "student"],
    "business": ["sales", "customer_service", "office_staff", "manager", "client"],
    "engineering": ["mechanical_engineer", "process_engineer", "quality_engineer", "product_engineer", "field_service_engineer"],
    "service": ["restaurant_staff", "hotel_staff", "retail_staff", "reception", "customer"],
    "student": ["high_school", "college", "graduate", "student"],
    "lifestyle": ["daily", "travel", "business_trip", "customer"],
    "finance": ["accountant", "bank_clerk", "financial_analyst"],
    "marketing": ["marketing_staff", "social_media_manager", "brand_specialist"],
    "it": ["software_engineer", "it_support", "data_analyst"],
    "legal": ["lawyer", "paralegal", "legal_assistant"],
    "manufacturing": ["production_operator", "warehouse_staff", "quality_inspector"],
}

DOMAIN_LESSON_TYPES = {
    "healthcare": ["appointment", "patient_checkin", "symptoms", "medical_history", "diagnosis", "prescription", "insurance", "emergency", "patient_instruction"],
    "education": ["classroom_greeting", "giving_instructions", "asking_questions", "checking_understanding", "correcting_mistakes", "praising_students", "classroom_management", "parent_meeting"],
    "business": ["meeting", "presentation", "negotiation", "email_communication", "phone_call", "client_discussion", "reporting", "schedule_management"],
    "engineering": ["technical_explanation", "system_description", "problem_debugging", "instructions_following", "documentation", "team_sync", "deployment"],
    "service": ["greeting_customer", "taking_order", "handling_complaints", "suggesting_products", "payment_checkout", "reservation", "customer_support"],
    "student": ["self_introduction", "school_life", "asking_help", "homework_discussion", "group_work", "daily_conversation"],
    "lifestyle": ["airport", "hotel_checkin", "restaurant", "shopping", "asking_directions", "transportation", "emergency_travel"],
    "finance": ["reporting", "presentation", "meeting", "client_discussion"],
    "marketing": ["presentation", "meeting", "client_discussion", "reporting"],
    "it": ["technical_explanation", "system_description", "problem_debugging", "documentation"],
    "legal": ["client_discussion", "meeting", "documentation", "reporting"],
    "manufacturing": ["technical_explanation", "instructions_following", "documentation", "team_sync"],
}

DOMAIN_SCENE_TAGS = {
    "healthcare": ["medical", "daily"],
    "education": ["teaching", "daily"],
    "business": ["meeting", "client"],
    "engineering": ["factory", "technical"],
    "service": ["client", "daily"],
    "student": ["daily", "teaching"],
    "lifestyle": ["travel", "daily"],
    "finance": ["office", "report"],
    "marketing": ["presentation", "client"],
    "it": ["technical", "office"],
    "legal": ["office", "client"],
    "manufacturing": ["factory", "technical"],
}


DOMAIN_PREFIX = {
    "healthcare": "hc",
    "education": "edu",
    "business": "biz",
    "engineering": "eng",
    "service": "svc",
    "student": "stu",
    "lifestyle": "life",
    "finance": "fin",
    "marketing": "mkt",
    "it": "it",
    "legal": "law",
    "manufacturing": "mfg",
}

LESSON_SHORT = {
    "appointment": "appt",
    "patient_checkin": "check",
    "symptoms": "sym",
    "medical_history": "hist",
    "diagnosis": "diag",
    "prescription": "med",
    "insurance": "ins",
    "emergency": "emg",
    "patient_instruction": "inst",
    "classroom_greeting": "greet",
    "giving_instructions": "instr",
    "asking_questions": "ask",
    "checking_understanding": "under",
    "correcting_mistakes": "fix",
    "praising_students": "praise",
    "classroom_management": "class",
    "parent_meeting": "parent",
    "meeting": "meet",
    "presentation": "pres",
    "negotiation": "nego",
    "email_communication": "email",
    "phone_call": "call",
    "client_discussion": "client",
    "reporting": "report",
    "schedule_management": "sched",
    "technical_explanation": "tech",
    "system_description": "sys",
    "problem_debugging": "debug",
    "instructions_following": "follow",
    "documentation": "doc",
    "team_sync": "sync",
    "deployment": "deploy",
    "greeting_customer": "greet",
    "taking_order": "order",
    "handling_complaints": "compl",
    "suggesting_products": "suggest",
    "payment_checkout": "pay",
    "reservation": "book",
    "customer_support": "support",
    "self_introduction": "intro",
    "school_life": "school",
    "asking_help": "help",
    "homework_discussion": "home",
    "group_work": "group",
    "daily_conversation": "daily",
    "airport": "air",
    "hotel_checkin": "hotel",
    "restaurant": "rest",
    "shopping": "shop",
    "asking_directions": "dir",
    "transportation": "trans",
    "emergency_travel": "emg",
}

def make_short_slug(domain_code: str, lesson_type: str, idx: int) -> str:
    prefix = DOMAIN_PREFIX.get(domain_code, "gen")
    short = LESSON_SHORT.get(lesson_type, sanitize_name(lesson_type)[:6] or "gen")
    return f"{prefix}-{short}-{idx:02d}"


def collect_youtube_ids_from_dir(folder: Path) -> List[str]:
    ids: List[str] = []
    if not folder.exists() or not folder.is_dir():
        return ids

    marker_files = [
        folder / "youtube_id.txt",
        folder / "youtube-id.txt",
        folder / "source_url.txt",
        folder / "source-url.txt",
    ]
    for p in marker_files:
        try:
            if not p.exists():
                continue
            raw = p.read_text(encoding="utf-8", errors="ignore").strip()
            yid = raw if len(raw) == 11 and re.fullmatch(r"[A-Za-z0-9_-]{11}", raw) else extract_youtube_id(raw)
            if yid:
                ids.append(yid)
        except Exception:
            pass

    json_patterns = [
        "index-*.json",
        "meta-*.json",
        "ai-*.json",
        "quiz-*.json",
        "vocab-*.json",
        "cues-*.json",
        "*.dialogue.json",
        "speaking-*.json",
    ]
    for pat in json_patterns:
        for jp in folder.glob(pat):
            try:
                obj = json.loads(jp.read_text(encoding="utf-8", errors="ignore"))
                if isinstance(obj, dict):
                    yid = str(obj.get("youtube_id") or "").strip()
                    if yid:
                        ids.append(yid)
                    for k in ("youtube_url", "source_url", "url"):
                        src = str(obj.get(k) or "").strip()
                        if src:
                            hit = extract_youtube_id(src)
                            if hit:
                                ids.append(hit)
                elif isinstance(obj, list):
                    for item in obj[:10]:
                        if not isinstance(item, dict):
                            continue
                        for k in ("youtube_id",):
                            yid = str(item.get(k) or "").strip()
                            if yid:
                                ids.append(yid)
                        for k in ("youtube_url", "source_url", "url"):
                            src = str(item.get(k) or "").strip()
                            if src:
                                hit = extract_youtube_id(src)
                                if hit:
                                    ids.append(hit)
            except Exception:
                pass
    out: List[str] = []
    seen = set()
    for yid in ids:
        if yid and yid not in seen:
            out.append(yid)
            seen.add(yid)
    return out


def find_existing_by_youtube_id(output_root: Path, category: str, youtube_id: str) -> Optional[Path]:
    if not youtube_id or not output_root.exists():
        return None

    candidates: List[Path] = []
    category_dir = output_root / category
    if category_dir.exists():
        candidates.extend(sorted([p for p in category_dir.iterdir() if p.is_dir()]))

    for child in candidates:
        ids = collect_youtube_ids_from_dir(child)
        if youtube_id in ids:
            return child
    return None


def write_youtube_markers(work_dir: Path, youtube_id: str, source_url: str) -> None:
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        (work_dir / "youtube_id.txt").write_text((youtube_id or "").strip(), encoding="utf-8")
    except Exception:
        pass
    try:
        (work_dir / "source_url.txt").write_text((source_url or "").strip(), encoding="utf-8")
    except Exception:
        pass


def unique_backup_dir(path: Path) -> Path:
    ts = time.strftime("%Y%m%d_%H%M%S")
    base = path.parent / f"{path.name}_backup_{ts}"
    candidate = base
    i = 2
    while candidate.exists():
        candidate = path.parent / f"{path.name}_backup_{ts}_{i}"
        i += 1
    return candidate


def ask_duplicate_action(existing: Path, youtube_id: str, clean_url: str) -> str:
    print("\n[DUPLICATE]")
    print(f"youtube_id = {youtube_id}")
    print(f"來源 = {clean_url}")
    print(f"found = {existing.name}")
    if AUTO_SKIP_DUPLICATES:
        print("[AUTO SKIP] 重複影片，自動略過")
        return "skip"
    print("[S] Skip（預設） / [R] Redo with backup / [O] Overwrite directly")
    choice = input("請選擇 (S/R/O，預設 S): ").strip().lower()
    if choice in ("r", "redo"):
        return "redo"
    if choice in ("o", "overwrite"):
        return "overwrite"
    return "skip"

def find_existing_by_title(output_root: Path, category: str, title: str) -> Optional[Path]:
    norm = sanitize_name(title)
    if not norm or not output_root.exists():
        return None
    folder = output_root / category
    if not folder.exists():
        return None
    for child in sorted(folder.iterdir()):
        if not child.is_dir():
            continue
        for idx_path in child.glob("index-*.json"):
            try:
                obj = json.loads(idx_path.read_text(encoding="utf-8", errors="ignore"))
                idx_title = sanitize_name(str(obj.get("title") or ""))
                if idx_title and idx_title == norm:
                    return child
            except Exception:
                pass
    return None

def lesson_completion_report(work_dir: Path, slug: str, category: str = "", youtube_id: str = "") -> Tuple[bool, List[str]]:
    """
    V29 INCOMPLETE RETRY：
    舊版只看「有 mp4 + index」就算完成，會讓上次失敗殘檔被 AUTO SKIP。
    現在改成必須確認前台真正會用到的教材檔完整，才算可跳過。
    """
    missing: List[str] = []
    if not work_dir.exists():
        return False, ["folder"]

    slug = str(slug or work_dir.name or "").strip()
    category = str(category or "").strip().lower()

    def file_ok(path: Path, min_bytes: int) -> bool:
        try:
            return path.exists() and path.stat().st_size > min_bytes
        except Exception:
            return False

    final_mp4 = work_dir / f"{slug}.mp4"
    final_srt = work_dir / f"{slug}.srt"
    if not file_ok(final_mp4, 200_000):
        missing.append(final_mp4.name)
    if not file_ok(final_srt, 30):
        missing.append(final_srt.name)

    json_targets = [
        work_dir / f"index-{slug}.json",
        work_dir / f"cues-{slug}.json",
        work_dir / f"quiz-{slug}.json",
        work_dir / f"vocab-{slug}.json",
        work_dir / f"ai-{slug}.json",
        work_dir / f"{slug}.dialogue.json",
        work_dir / f"speaking-{slug}.json",
    ]
    for p in json_targets:
        if not json_exists_ok(p):
            missing.append(p.name)

    # V30：即使 cues JSON 語法合法，也要確認它真的覆蓋到 SRT 結尾。
    # 避免半套 cues 被誤判為完整教材，AUTO SKIP 後永遠不重建。
    cues_path = work_dir / f"cues-{slug}.json"
    if cues_path.exists() and final_srt.exists():
        try:
            srt_segments_for_check = parse_srt_text(final_srt.read_text(encoding="utf-8", errors="ignore"))
            cues_obj_for_check = json.loads(cues_path.read_text(encoding="utf-8", errors="ignore"))
            validate_cues_time_coverage(cues_obj_for_check, srt_segments_for_check, category, slug, None)
        except Exception:
            label = f"{cues_path.name}(字幕不完整)"
            if label not in missing:
                missing.append(label)

    # 只對已有 youtube_id 的核心 JSON 做來源一致性保護；
    # dialogue / speaking 可能是 fallback，這裡不強制綁 youtube_id。
    if youtube_id:
        source_checked = [
            work_dir / f"index-{slug}.json",
            work_dir / f"cues-{slug}.json",
            work_dir / f"quiz-{slug}.json",
            work_dir / f"vocab-{slug}.json",
            work_dir / f"ai-{slug}.json",
        ]
        for p in source_checked:
            if p.exists() and not json_matches_youtube(p, youtube_id):
                label = f"{p.name}(youtube_id不符)"
                if label not in missing:
                    missing.append(label)

    return (len(missing) == 0), missing


def should_skip_existing_lesson(work_dir: Path, slug: str = "", category: str = "", youtube_id: str = "") -> bool:
    complete, _missing = lesson_completion_report(work_dir, slug or work_dir.name, category, youtube_id)
    return complete


def has_valid_music_karaoke(work_dir: Path, slug: str) -> bool:
    """MUSIC 補齊用：已有 <slug>_karaoke.mp4 才算 KTV 伴奏完成。"""
    p = work_dir / f"{slug}_karaoke.mp4"
    try:
        return p.exists() and p.stat().st_size > 100_000
    except Exception:
        return False


def has_valid_music_guide_mp4(work_dir: Path, slug: str, lang: str) -> bool:
    """中文/日文導唱完成判斷：<slug>_zh.mp4 / <slug>_ja.mp4。"""
    p = work_dir / f"{slug}_{lang}.mp4"
    try:
        return p.exists() and p.stat().st_size > MIN_MUSIC_GUIDE_BYTES
    except Exception:
        return False


def has_valid_music_ktv_pack(work_dir: Path, slug: str) -> bool:
    """MUSIC 完整包：伴奏 + 中文導唱 + 日文導唱。"""
    if not has_valid_music_karaoke(work_dir, slug):
        return False
    if not ENABLE_MUSIC_GUIDE_TTS:
        return True
    return has_valid_music_guide_mp4(work_dir, slug, "zh") and has_valid_music_guide_mp4(work_dir, slug, "ja")


def json_matches_youtube(json_path: Path, expected_youtube_id: str) -> bool:
    if not json_path.exists() or not expected_youtube_id:
        return False
    try:
        obj = json.loads(json_path.read_text(encoding="utf-8", errors="ignore"))
        if isinstance(obj, dict):
            yid = str(obj.get("youtube_id") or "").strip()
            if yid:
                return yid == expected_youtube_id
        elif isinstance(obj, list):
            for item in obj[:5]:
                if isinstance(item, dict):
                    src = str(item.get("source_url") or "").strip()
                    if src:
                        return extract_youtube_id(src) == expected_youtube_id
    except Exception:
        return False
    return False

def remove_mismatched_jsons(work_dir: Path, slug: str, expected_youtube_id: str) -> None:
    if not work_dir.exists() or not expected_youtube_id:
        return
    targets = [
        work_dir / f"index-{slug}.json",
        work_dir / f"cues-{slug}.json",
        work_dir / f"quiz-{slug}.json",
        work_dir / f"vocab-{slug}.json",
        work_dir / f"ai-{slug}.json",
        work_dir / f"meta-{slug}.json",
    ]
    for p in targets:
        if p.exists() and not json_matches_youtube(p, expected_youtube_id):
            try:
                print(f"[REBUILD] 刪除舊錯檔：{p.name}")
                p.unlink()
            except Exception:
                pass


# === V41 MUSIC 補缺模式 ===
# 已成功教材直接 SKIP；半套教材只補缺。
# 若 cues 是 Mantra fallback / 尾段不足 / 品質不合格，需刪掉依賴 cues 的 JSON/MP3，
# 但保留 mp4 / srt / karaoke / vocals，避免重抓 YouTube 與重跑 Whisper/Demucs。
def remove_music_json_dependents(work_dir: Path, slug: str, reason: str = "") -> None:
    if not work_dir.exists():
        return
    patterns = [
        f"cues-{slug}.json",
        f"quiz-{slug}.json",
        f"vocab-{slug}.json",
        f"ai-{slug}.json",
        f"index-{slug}.json",
        f"meta-{slug}.json",
        f"{slug}.dialogue.json",
        f"speaking-{slug}.json",
        f"music-audio-{slug}.json",
    ]
    # 逐句 MP3 是依 cues 時間/文字產生的；cues 重建時也要重建。
    audio_dir = work_dir / "audio"
    for pat in patterns:
        for target in work_dir.glob(pat):
            try:
                if target.is_file():
                    target.unlink()
                    print(f"[V41 REBUILD JSON ONLY] 刪除舊 JSON：{target.name}" + (f" reason={reason}" if reason else ""))
            except Exception as e:
                print(f"[V41 REBUILD JSON ONLY] 刪除失敗：{target} -> {e}")
    # 只刪 line mp3 子資料夾，不刪 vocals.mp3 / no_vocals.mp3。
    for lang_dir in (audio_dir / "en", audio_dir / "zh", audio_dir / "ja"):
        if lang_dir.exists() and lang_dir.is_dir():
            try:
                shutil.rmtree(lang_dir)
                print(f"[V41 REBUILD JSON ONLY] 刪除舊逐句 MP3：{lang_dir}")
            except Exception as e:
                print(f"[V41 REBUILD JSON ONLY] 刪除逐句 MP3 失敗：{lang_dir} -> {e}")


def music_cues_has_mantra_fallback(obj: Any) -> bool:
    arr = _bw_cues_array(obj)
    if not arr:
        return False
    total = 0
    mantra = 0
    for item in arr:
        if not isinstance(item, dict):
            continue
        hay = " ".join(str(item.get(k) or "") for k in ("native", "roman", "en", "zh", "local_pron", "ko_pron", "lyrics_mode"))
        if not hay.strip():
            continue
        total += 1
        low = hay.lower()
        if (
            "mantra / meditative chanting" in low
            or "meditative chanting" in low
            or "no reliable word-for-word lyrics" in low
            or "冥想吟唱" in hay
            or "music_meditation_no_fake_lyrics" in low
        ):
            mantra += 1
    return total > 0 and (mantra / total) >= 0.50

def next_short_index(output_root: Path, category: str, domain_code: str, lesson_type: str) -> int:
    folder = output_root / category
    folder.mkdir(parents=True, exist_ok=True)
    prefix = f"{DOMAIN_PREFIX.get(domain_code, 'gen')}-{LESSON_SHORT.get(lesson_type, sanitize_name(lesson_type)[:6] or 'gen')}-"
    nums = []
    if folder.exists():
        for p in folder.iterdir():
            if not p.is_dir():
                continue
            m = re.match(rf"^{re.escape(prefix)}(\d+)$", p.name)
            if m:
                nums.append(int(m.group(1)))
    return max(nums, default=0) + 1


def infer_domain_code(category: str, slug: str, title: str) -> str:
    hay = f"{category} {slug} {title}".lower()
    best_domain = "lifestyle"
    best_score = 0
    for domain, keywords in DOMAIN_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in hay)
        if score > best_score:
            best_score = score
            best_domain = domain
    if best_score == 0:
        mapping = {
            "story": "student",
            "movie": "lifestyle",
            "music": "student",
            "news": "business",
            "pro": "education",
        }
        return mapping.get((category or "").lower(), "lifestyle")
    return best_domain


def infer_lesson_type(domain_code: str, slug: str, title: str) -> str:
    hay = f"{slug} {title}".lower()
    for lesson_type in DOMAIN_LESSON_TYPES.get(domain_code, []):
        key = lesson_type.replace("_", " ")
        if lesson_type in hay or key in hay:
            return lesson_type
    # domain-specific weak matching
    aliases = {
        "patient_checkin": ["check in", "check-in", "reception", "front desk"],
        "medical_history": ["history"],
        "patient_instruction": ["instruction", "instructions", "advice"],
        "classroom_greeting": ["greeting"],
        "asking_directions": ["directions"],
        "transportation": ["train", "bus", "subway", "transport"],
    }
    for lesson_type, words in aliases.items():
        if lesson_type in DOMAIN_LESSON_TYPES.get(domain_code, []):
            if any(w in hay for w in words):
                return lesson_type
    items = DOMAIN_LESSON_TYPES.get(domain_code, [])
    return items[0] if items else "general"


def infer_role_codes(domain_code: str, slug: str, title: str) -> List[str]:
    hay = f"{slug} {title}".lower()
    roles = []
    for role in DOMAIN_ROLE_MAP.get(domain_code, []):
        if role.replace("_", " ") in hay or role in hay:
            roles.append(role)
    if roles:
        return roles
    defaults = {
        "healthcare": ["nurse", "patient"],
        "education": ["elementary_teacher", "student"],
        "business": ["office_staff", "client"],
        "engineering": ["product_engineer", "field_service_engineer"],
        "service": ["customer_service", "customer"],
        "student": ["student"],
        "lifestyle": ["travel", "daily"],
    }
    return defaults.get(domain_code, ["daily"])




def infer_order_from_slug(slug: str) -> int:
    m = re.search(r'(\d+)$', slug or "")
    return int(m.group(1)) if m else 1


def normalize_role_codes(values: Any, domain_code: str) -> List[str]:
    if isinstance(values, list):
        out = [str(x).strip() for x in values if str(x).strip()]
        return out or infer_role_codes(domain_code, "", "")
    if isinstance(values, str) and values.strip():
        parts = [x.strip() for x in re.split(r"[,|/]", values) if x.strip()]
        return parts or infer_role_codes(domain_code, "", "")
    return infer_role_codes(domain_code, "", "")


def normalize_scene_tags(values: Any, domain_code: str) -> List[str]:
    if isinstance(values, list):
        out = [str(x).strip() for x in values if str(x).strip()]
        return out or DOMAIN_SCENE_TAGS.get(domain_code, ["daily"])
    if isinstance(values, str) and values.strip():
        parts = [x.strip() for x in re.split(r"[,|/]", values) if x.strip()]
        return parts or DOMAIN_SCENE_TAGS.get(domain_code, ["daily"])
    return DOMAIN_SCENE_TAGS.get(domain_code, ["daily"])


def parse_slug_parts_for_learning(slug: str) -> Tuple[str, str, str, str, str]:
    parts = [x.strip().lower() for x in str(slug or "").split("-") if x.strip()]

    # canonical TED 規格：ted-talk-talk-<id4>
    if len(parts) >= 4 and parts[0] == "ted" and parts[1] == "talk":
        return "ted", "ted_talk", "talk", "talk", slug

    domain_short = parts[0] if len(parts) > 0 else "gen"
    target_role = parts[1] if len(parts) > 1 else "general"
    lesson_short = parts[2] if len(parts) > 2 else "talk"
    scene = parts[3] if len(parts) > 3 else "general"
    return domain_short, target_role, lesson_short, scene, slug


def enrich_index_metadata(obj: Dict[str, Any], slug: str, category: str, youtube_url: str, segments: List[Dict[str, str]]) -> Dict[str, Any]:
    title = str(obj.get("title") or slug.replace("-", " "))
    difficulty_level = obj.get("difficulty_level", 2)
    try:
        difficulty_level = int(difficulty_level)
    except Exception:
        difficulty_level = 2

    domain_short, target_role, lesson_short, scene, short_slug = parse_slug_parts_for_learning(slug)

    order = 1  # 固定值，禁止從 slug 尾碼推 order
    short_slug = slug

    legacy_domain_map = {
        "hc": "healthcare",
        "edu": "education",
        "biz": "business",
        "eng": "engineering",
        "svc": "service",
        "stu": "student",
        "life": "lifestyle",
        "ted": "ted_talk",
    }
    domain_long = legacy_domain_map.get(domain_short, "lifestyle")

    existing_scene_tags = normalize_scene_tags(obj.get("scene_tags"), domain_long)
    scene_tags = existing_scene_tags if existing_scene_tags else [scene]

    if domain_long == "ted_talk" or str(slug).startswith("ted-talk-talk-"):
        obj["domain_code"] = "ted_talk"
        obj["target_role"] = "ted_talk"
        obj["profile_role_code"] = "ted_talk"
        obj["role_codes"] = ["ted_talk"]
        obj["dialog_roles"] = ["ted_talk"]
        obj["lesson_type"] = "talk"
        obj["scene"] = scene if scene else "talk"
        obj["scene_tags"] = scene_tags if scene_tags else ["daily"]
    else:
        role_codes = normalize_role_codes(obj.get("role_codes"), domain_long)
        if not role_codes:
            role_codes = [target_role]

        obj["domain_code"] = domain_long if domain_short == "ted" else domain_short
        obj["target_role"] = target_role
        obj["profile_role_code"] = target_role
        obj["role_codes"] = role_codes
        obj["dialog_roles"] = list(role_codes)
        obj["lesson_type"] = lesson_short
        obj["scene"] = scene
        obj["scene_tags"] = scene_tags

    obj["order"] = order
    obj["slug"] = short_slug
    obj["video"] = f"{R2_PUBLIC_BASE}/videos/{category}/{short_slug}.mp4"
    obj["cover"] = f"{R2_PUBLIC_BASE}/assets/{category}/{short_slug}.jpg"
    obj["cues"] = {"zh": f"./cues-{short_slug}.json"}
    obj["vocab"] = f"./vocab-{short_slug}.json"
    obj["quiz"] = f"./quiz-{short_slug}.json"
    obj["ai"] = f"./ai-{short_slug}.json"
    obj["duration_sec"] = compute_duration_sec_from_srt(segments)
    obj.setdefault("difficulty_level", difficulty_level)
    obj["dialogue"] = f"./{short_slug}.dialogue.json"
    obj["speaking"] = f"./speaking-{short_slug}.json"
    return obj


def load_env_file(env_path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    if not env_path.exists():
        return data
    text = env_path.read_text(encoding="utf-8", errors="ignore")
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip().strip('"').strip("'")
    return data


def load_env() -> Dict[str, str]:
    merged: Dict[str, str] = {}
    candidates = [SCRIPT_DIR / ".env", Path.cwd() / ".env", SCRIPT_DIR.parent / ".env"]
    for p in candidates:
        env = load_env_file(p)
        for k, v in env.items():
            if k not in merged:
                merged[k] = v
    return merged


ENV = load_env()
R2_PUBLIC_BASE = (
    os.environ.get("BOOKWIDE_R2_PUBLIC_BASE")
    or ENV.get("BOOKWIDE_R2_PUBLIC_BASE")
    or "https://pub-578e9e060a104f24b6865e26eb941648.r2.dev"
)


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def has_nvidia_gpu() -> bool:
    if not ENABLE_GPU_AUTO:
        return False
    try:
        if command_exists("nvidia-smi"):
            p = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, encoding="utf-8", errors="ignore")
            return p.returncode == 0 and bool((p.stdout or "").strip())
    except Exception:
        pass
    return False


def ffmpeg_has_encoder(name: str) -> bool:
    try:
        p = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, encoding="utf-8", errors="ignore")
        return p.returncode == 0 and name in (p.stdout or "")
    except Exception:
        return False


def can_use_nvenc() -> bool:
    return has_nvidia_gpu() and ffmpeg_has_encoder("h264_nvenc")


def can_use_whisper_cuda() -> bool:
    if not has_nvidia_gpu():
        return False
    try:
        import torch  # type: ignore
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def build_video_encode_args() -> List[str]:
    if can_use_nvenc():
        return [
            "-c:v", "h264_nvenc",
            "-preset", NVENC_PRESET,
            "-rc", "constqp",
            "-cq", NVENC_CQ,
            "-b:v", "0",
            "-maxrate", VIDEO_MAXRATE,
            "-bufsize", VIDEO_BUFSIZE,
            "-pix_fmt", "yuv420p",
        ]
    return [
        "-c:v", "libx264",
        "-preset", VIDEO_PRESET,
        "-crf", str(VIDEO_CRF),
        "-maxrate", VIDEO_MAXRATE,
        "-bufsize", VIDEO_BUFSIZE,
        "-pix_fmt", "yuv420p",
    ]


def build_still_video_encode_args() -> List[str]:
    if can_use_nvenc():
        return [
            "-c:v", "h264_nvenc",
            "-preset", NVENC_PRESET,
            "-rc", NVENC_RC,
            "-cq", "30",
            "-b:v", "0",
            "-pix_fmt", "yuv420p",
        ]
    return [
        "-c:v", "libx264",
        "-preset", VIDEO_PRESET,
        "-crf", "30",
        "-tune", "stillimage",
        "-pix_fmt", "yuv420p",
    ]


def log_gpu_mode() -> None:
    if can_use_nvenc():
        print("[GPU] FFmpeg 使用 NVIDIA NVENC")
    else:
        print("[GPU] FFmpeg 使用 CPU libx264")
    if can_use_whisper_cuda():
        print("[GPU] Whisper 使用 CUDA")
    else:
        print("[GPU] Whisper 使用 CPU")


def q(x: Any) -> str:
    s = str(x)
    return f'"{s}"' if " " in s else s


def run_cmd(cmd: List[str], check: bool = True, cwd: Optional[Path] = None) -> subprocess.CompletedProcess:
    print("RUN:", " ".join(q(x) for x in cmd))
    p = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    if p.stdout:
        print(p.stdout)
    if p.returncode != 0:
        if p.stderr:
            print(p.stderr)
        if check:
            raise RuntimeError(f"命令失敗：{' '.join(map(str, cmd))}")
    return p


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(f"找不到 {name}，請先安裝並加入 PATH。")


def normalize_slug(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"https?://", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


def sanitize_name(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


def extract_youtube_id(url: str) -> str:
    url = (url or "").strip()
    patterns = [
        r"(?:v=)([A-Za-z0-9_-]{11})",
        r"(?:youtu\.be/)([A-Za-z0-9_-]{11})",
        r"(?:embed/)([A-Za-z0-9_-]{11})",
        r"(?:shorts/)([A-Za-z0-9_-]{11})",
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return ""


def clean_youtube_url(url: str) -> str:
    raw = (url or "").strip().strip('"').strip("'")
    if not raw:
        return raw
    yt_id = extract_youtube_id(raw)
    if yt_id:
        return f"https://www.youtube.com/watch?v={yt_id}"
    try:
        p = urlparse(raw)
        qs = parse_qs(p.query)
        keep = {}
        for k in ("v",):
            if k in qs and qs[k]:
                keep[k] = qs[k][0]
        new_query = urlencode(keep)
        return urlunparse((p.scheme, p.netloc, p.path, p.params, new_query, "")) if new_query else raw
    except Exception:
        return raw


def get_video_title(url: str) -> str:
    p = run_cmd(["yt-dlp", "--get-title", url], check=False)
    title = (p.stdout or "").strip().splitlines()
    return title[0].strip() if title else ""


# === V24 MUSIC TITLE FIX ===
# MUSIC 首頁片名必須用 YouTube 真標題，不再讓 GPT / fallback 寫成
# 「音樂欣賞 / 音樂教學影片 / 音樂之旅 / music / slug」。
BAD_MUSIC_TITLES = {
    "",
    "music",
    "音樂欣賞",
    "音樂教學影片",
    "音樂之旅",
    "繁體中文標題（若不確定可用英文）",
}


def clean_music_title(title: str) -> str:
    t = str(title or "").strip()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\s*-\s*YouTube\s*$", "", t, flags=re.I)
    return t[:180]


def is_bad_music_title(title: str, slug: str = "") -> bool:
    t = clean_music_title(title)
    s = str(slug or "").strip()
    if t in BAD_MUSIC_TITLES:
        return True
    if s and t.lower() == s.lower():
        return True
    return False


def best_music_title(youtube_title: str, slug: str) -> str:
    t = clean_music_title(youtube_title)
    if t and not is_bad_music_title(t, slug):
        return t
    return str(slug or "Music").strip() or "Music"


def patch_music_title_files(work_dir: Path, slug: str, youtube_url: str, youtube_title: str) -> None:
    """
    修 index/meta 的 title，讓後續 03 GitHub / 05 Supabase 寫 assets 時讀到正確歌名。
    可重複執行；即使舊教材已存在、被 skip，也會先修 title。
    """
    title = best_music_title(youtube_title, slug)
    if not title:
        return
    youtube_id = extract_youtube_id(youtube_url)
    for jp in (work_dir / f"index-{slug}.json", work_dir / f"meta-{slug}.json"):
        if not jp.exists():
            continue
        try:
            obj = json.loads(jp.read_text(encoding="utf-8", errors="ignore"))
            if not isinstance(obj, dict):
                continue
            old_title = str(obj.get("title") or "").strip()
            if is_bad_music_title(old_title, slug) or old_title != title:
                obj["title"] = title
                obj["youtube_url"] = youtube_url or obj.get("youtube_url", "")
                obj["youtube_id"] = youtube_id or obj.get("youtube_id", "")
                write_json(jp, obj)
                print(f"[MUSIC TITLE FIX] {jp.name}: {old_title or '(empty)'} -> {title}")
        except Exception as e:
            print(f"[MUSIC TITLE FIX] 更新失敗：{jp.name} -> {e}")



# === V25 PUBLIC TITLE FIX ===
# story / movie / music / news 的首頁片名一律鎖定 YouTube 真標題。
# 避免 GPT 依 domain/role 產生「健康諮詢預約」這類職業課程標題。
PUBLIC_TITLE_LOCK_CATEGORIES = {"story", "movie", "music", "news"}
BAD_PUBLIC_TITLES = BAD_MUSIC_TITLES | {
    "健康諮詢預約",
    "繁體中文標題",
    "繁體中文標題（若不確定可用英文）",
    "教材影片",
    "學習影片",
    "電影教學影片",
    "電影欣賞",
    "故事教學影片",
    "故事欣賞",
    "新聞教學影片",
    "新聞欣賞",
}


def base_category_of(category: str) -> str:
    return str(category or "").strip().lower().split("/", 1)[0]


def should_lock_public_title(category: str) -> bool:
    return base_category_of(category) in PUBLIC_TITLE_LOCK_CATEGORIES


def clean_public_title(title: str) -> str:
    t = str(title or "").strip()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\s*-\s*YouTube\s*$", "", t, flags=re.I)
    return t[:180]


def is_bad_public_title(title: str, slug: str = "") -> bool:
    t = clean_public_title(title)
    s = str(slug or "").strip()
    if not t:
        return True
    if t in BAD_PUBLIC_TITLES:
        return True
    if s and t.lower() == s.lower():
        return True
    return False


def best_public_title(youtube_title: str, slug: str, category: str = "") -> str:
    t = clean_public_title(youtube_title)
    if t and not is_bad_public_title(t, slug):
        return t
    return str(slug or base_category_of(category) or "Video").strip() or "Video"


def patch_public_title_files(work_dir: Path, slug: str, category: str, youtube_url: str, youtube_title: str) -> None:
    """
    修 index/meta 的 title，讓後續 03 GitHub / 05 Supabase 寫 assets 時讀到 YouTube 真標題。
    適用：story / movie / music / news。pro 不動。
    """
    if not should_lock_public_title(category):
        return
    title = best_public_title(youtube_title, slug, category)
    if not title:
        return
    youtube_id = extract_youtube_id(youtube_url)
    for jp in (work_dir / f"index-{slug}.json", work_dir / f"meta-{slug}.json"):
        if not jp.exists():
            continue
        try:
            obj = json.loads(jp.read_text(encoding="utf-8", errors="ignore"))
            if not isinstance(obj, dict):
                continue
            old_title = str(obj.get("title") or "").strip()
            if old_title != title or is_bad_public_title(old_title, slug):
                obj["title"] = title
                obj["category"] = base_category_of(category) or obj.get("category", category)
                obj["youtube_url"] = youtube_url or obj.get("youtube_url", "")
                obj["youtube_id"] = youtube_id or obj.get("youtube_id", "")
                write_json(jp, obj)
                print(f"[PUBLIC TITLE FIX] {jp.name}: {old_title or '(empty)'} -> {title}")
        except Exception as e:
            print(f"[PUBLIC TITLE FIX] 更新失敗：{jp.name} -> {e}")

def get_browser_list() -> List[Optional[str]]:
    return ["firefox", "chrome", None]


def build_video_download_plans(url: str, output_tpl: str) -> List[List[str]]:
    fmt = "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b"
    plans: List[List[str]] = []
    for browser in get_browser_list():
        cmd = ["yt-dlp", "--force-overwrites", "--no-continue"]
        if browser:
            cmd += ["--cookies-from-browser", browser]
        cmd += ["-f", fmt, "--merge-output-format", "mp4", "-o", output_tpl, url]
        plans.append(cmd)
    return plans


def build_audio_download_plans(url: str, output_tpl: str) -> List[List[str]]:
    plans: List[List[str]] = []
    for browser in get_browser_list():
        cmd = ["yt-dlp", "--force-overwrites", "--no-continue"]
        if browser:
            cmd += ["--cookies-from-browser", browser]
        cmd += [
            "-f", "bestaudio/best",
            "--extract-audio",
            "--audio-format", "mp3",
            "--write-thumbnail",
            "--convert-thumbnails", "jpg",
            "-o", output_tpl,
            url,
        ]
        plans.append(cmd)
    return plans


def clear_old_outputs(work_dir: Path) -> None:
    folder_name = work_dir.name
    patterns = [
        f"{folder_name}_raw.*",
        f"{folder_name}.mp4",
        f"{folder_name}.mp3",
        f"{folder_name}.m4a",
        f"{folder_name}.wav",
        f"{folder_name}.srt",
        f"{folder_name}.jpg",
        "audio.wav",
        "audio.srt",
        "_tmp_cover_*.jpg",
        "cues-*.json",
        "quiz-*.json",
        "vocab-*.json",
        "ai-*.json",
        "index-*.json",
        "*.dialogue.json",
        "speaking-*.json",
        "_errors\\*",
    ]
    for pat in patterns:
        for p in work_dir.glob(pat):
            try:
                if p.is_file():
                    p.unlink()
                    print("刪除舊檔：", p)
            except Exception:
                pass


def ensure_error_dir(work_dir: Path) -> Path:
    p = work_dir / "_errors"
    p.mkdir(parents=True, exist_ok=True)
    return p


def write_error_file(work_dir: Path, name: str, text: str) -> None:
    error_dir = ensure_error_dir(work_dir)
    (error_dir / name).write_text(text, encoding="utf-8", errors="ignore")


def find_first_existing(work_dir: Path, patterns: List[str]) -> Optional[Path]:
    for pat in patterns:
        candidates = sorted(work_dir.glob(pat))
        if candidates:
            return candidates[0]
    return None


def exists_ok(path: Path, min_bytes: int = 1024) -> bool:
    try:
        return path.exists() and path.stat().st_size >= min_bytes
    except Exception:
        return False


def json_exists_ok(path: Path) -> bool:
    if not exists_ok(path, 2):
        return False
    try:
        json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        return True
    except Exception:
        return False


def resume_or_download_video(url: str, work_dir: Path, raw_mp4: Path) -> Path:
    existing = find_first_existing(work_dir, [f"{work_dir.name}_raw*.mp4"])
    if existing and exists_ok(existing, 200_000):
        if existing != raw_mp4:
            if raw_mp4.exists():
                raw_mp4.unlink()
            existing.rename(raw_mp4)
        print("[續跑] 已有 raw 影片，略過下載：", raw_mp4)
        return raw_mp4

    output_tpl = str(work_dir / f"{work_dir.name}_raw.%(ext)s")
    last_error: Optional[Exception] = None
    for cmd in build_video_download_plans(url, output_tpl):
        try:
            run_cmd(cmd)
            found = find_first_existing(work_dir, [f"{work_dir.name}_raw*.mp4"])
            if found:
                if found != raw_mp4:
                    if raw_mp4.exists():
                        raw_mp4.unlink()
                    found.rename(raw_mp4)
                return raw_mp4
        except Exception as e:
            last_error = e
    raise RuntimeError(f"影片全部下載方式都失敗：{last_error}")


def resume_or_download_audio(url: str, work_dir: Path, raw_audio_base: Path) -> Path:
    existing = find_first_existing(work_dir, [
        f"{work_dir.name}_raw*.mp3",
        f"{work_dir.name}_raw*.m4a",
        f"{work_dir.name}_raw*.webm",
        f"{work_dir.name}_raw*.opus",
    ])
    if existing and exists_ok(existing, 100_000):
        target = raw_audio_base.with_suffix(existing.suffix.lower())
        if existing != target:
            if target.exists():
                target.unlink()
            existing.rename(target)
        print("[續跑] 已有 raw 音訊，略過下載：", target)
        return target

    output_tpl = str(work_dir / f"{work_dir.name}_raw.%(ext)s")
    last_error: Optional[Exception] = None
    for cmd in build_audio_download_plans(url, output_tpl):
        try:
            run_cmd(cmd)
            found = find_first_existing(work_dir, [
                f"{work_dir.name}_raw*.mp3",
                f"{work_dir.name}_raw*.m4a",
                f"{work_dir.name}_raw*.webm",
                f"{work_dir.name}_raw*.opus",
            ])
            if found:
                target = raw_audio_base.with_suffix(found.suffix.lower())
                if found != target:
                    if target.exists():
                        target.unlink()
                    found.rename(target)
                return target
        except Exception as e:
            last_error = e
    raise RuntimeError(f"音訊全部下載方式都失敗：{last_error}")


def compress_to_mp4(src: Path, dst: Path, crf: int = VIDEO_CRF, preset: str = VIDEO_PRESET) -> None:
    if dst.exists():
        dst.unlink()
    vf = f"scale='if(gt(iw,{MAX_VIDEO_WIDTH}),{MAX_VIDEO_WIDTH},iw)':-2,fps={TARGET_FPS}"
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-vf", vf,
    ]
    cmd += build_video_encode_args()
    cmd += [
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-b:a", AUDIO_BITRATE,
        str(dst)
    ]
    run_cmd(cmd)
    if not exists_ok(dst, 200_000):
        raise RuntimeError("壓縮失敗，沒有產出有效 mp4")


def image_to_video_with_audio(image_path: Path, audio_path: Path, dst_mp4: Path) -> None:
    if dst_mp4.exists():
        dst_mp4.unlink()
    run_cmd([
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", str(image_path),
        "-i", str(audio_path),
        "-vf", f"fps={TARGET_FPS},scale='min({MAX_VIDEO_WIDTH},iw)':-2",
        "-c:v", "libx264",
        "-preset", VIDEO_PRESET,
        "-crf", "30",
        "-tune", "stillimage",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", AUDIO_BITRATE,
        "-shortest",
        "-movflags", "+faststart",
        str(dst_mp4),
    ])
    if not exists_ok(dst_mp4, 100_000):
        raise RuntimeError("合成 mp4 失敗")


def bw_whisper_language_for(category: str) -> str:
    if str(category or "").strip().lower().split("/", 1)[0] == "music":
        lang = bw_local_lang()
        if lang in ("jp",):
            return "ja"
        if lang in ("ja", "ko", "zh", "en", "fr", "de", "es", "it", "pt", "vi", "th", "id", "hi", "ne"):
            return lang
    return "en"


def bw_whisper_model_for(category: str, language: str, fallback_model: str) -> str:
    """
    V36：music 多國不能用 .en 模型。
    - 英文 music：small.en
    - 日文/韓文/泰文/尼泊爾文等：small（multilingual）
    - 若環境變數硬指定 small.en，但語言不是英文，自動改成 small。
    """
    cat = str(category or "").strip().lower().split("/", 1)[0]
    lang = str(language or "").strip().lower()
    if cat == "music":
        env_model = str(os.environ.get("BOOKWIDE_MUSIC_WHISPER_MODEL") or "").strip()
        if env_model:
            if lang not in ("en", "") and env_model.endswith(".en"):
                return env_model[:-3] or "small"
            return env_model
        return "small.en" if lang in ("en", "") else "small"
    return fallback_model


def bw_music_whisper_meta_path(work_dir: Path, slug: str) -> Path:
    return work_dir / f"{slug}.music_whisper.json"


def bw_delete_music_generated_jsons_for_regen(work_dir: Path, slug: str) -> None:
    """MUSIC SRT 需要重抓時，刪掉依舊 SRT 產生的 JSON/MP3 索引，避免前台吃到舊錯檔。"""
    patterns = [
        f"cues-{slug}.json",
        f"quiz-{slug}.json",
        f"vocab-{slug}.json",
        f"ai-{slug}.json",
        f"index-{slug}.json",
        f"{slug}.dialogue.json",
        f"speaking-{slug}.json",
        f"music-audio-{slug}.json",
    ]
    for name in patterns:
        target = work_dir / name
        if target.exists():
            try:
                target.unlink()
                print(f"[MUSIC WHISPER] 刪除舊 JSON/索引，稍後依新 SRT 重生：{name}")
            except Exception as e:
                print(f"[MUSIC WHISPER] 刪除舊檔失敗：{target} -> {e}")


def bw_read_music_whisper_meta(work_dir: Path, slug: str) -> Dict[str, Any]:
    meta_path = bw_music_whisper_meta_path(work_dir, slug)
    try:
        if meta_path.exists():
            obj = json.loads(meta_path.read_text(encoding="utf-8", errors="ignore"))
            return obj if isinstance(obj, dict) else {}
    except Exception:
        pass
    return {}


def bw_write_music_whisper_meta(work_dir: Path, slug: str, model: str, language: str, media_path: Path) -> None:
    obj = {
        "slug": slug,
        "model": str(model or ""),
        "language": str(language or ""),
        "local_lang": bw_local_lang(),
        "local_label": bw_local_label(),
        "media": str(media_path.name if media_path else ""),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    try:
        write_json(bw_music_whisper_meta_path(work_dir, slug), obj)
    except Exception as e:
        print(f"[MUSIC WHISPER] 寫入 meta 失敗：{e}")


def bw_prepare_music_srt_for_expected_whisper(
    work_dir: Path,
    slug: str,
    final_srt: Path,
    expected_model: str,
    expected_language: str,
) -> None:
    """
    V37 MUSIC SRT 重抓保護：
    舊版韓文/日文/泰文 music 可能用 tiny.en 產生 SRT。
    若目前預期 model/language 已改成 multilingual small，但資料夾裡已有舊 SRT，
    不能直接 [續跑] 略過，否則後面 JSON 仍會用壞字幕。
    """
    if not final_srt.exists():
        return

    lang = str(expected_language or "").strip().lower()
    model = str(expected_model or "").strip()
    meta = bw_read_music_whisper_meta(work_dir, slug)
    old_lang = str(meta.get("language") or "").strip().lower()
    old_model = str(meta.get("model") or "").strip()

    # 沒有 meta 的舊 SRT：如果是非英文 music，或現在應使用 music 專用模型，就視為舊版殘留。
    no_meta = not old_lang and not old_model
    incompatible = bool(old_lang or old_model) and (old_lang != lang or old_model != model)
    should_regen = False
    reason = ""
    if incompatible:
        should_regen = True
        reason = f"meta 不符 old={old_model}/{old_lang} expected={model}/{lang}"
    elif no_meta and (lang not in ("en", "") or model not in (DEFAULT_WHISPER_MODEL, "tiny.en")):
        should_regen = True
        reason = f"舊 SRT 無 meta，現在 music 應使用 {model}/{lang}"

    if not should_regen:
        return

    ts = time.strftime("%Y%m%d_%H%M%S")
    backup = final_srt.with_name(f"{slug}.srt_before_music_whisper_{ts}")
    try:
        final_srt.rename(backup)
        print(f"[MUSIC WHISPER] {reason}")
        print(f"[MUSIC WHISPER] 已備份舊 SRT，將重新辨識：{backup.name}")
    except Exception:
        try:
            final_srt.unlink()
            print(f"[MUSIC WHISPER] {reason}")
            print("[MUSIC WHISPER] 舊 SRT 無法備份，已刪除，將重新辨識")
        except Exception as e:
            raise RuntimeError(f"MUSIC SRT 需要重抓但無法移除舊檔：{e}")

    bw_delete_music_generated_jsons_for_regen(work_dir, slug)
    try:
        write_error_file(work_dir, "music_whisper_regen.txt", reason)
    except Exception:
        pass


def whisper_srt(media_path: Path, work_dir: Path, final_srt: Path, model: str = DEFAULT_WHISPER_MODEL, language: str = "en") -> None:
    whisper_exe = shutil.which("whisper")
    if not whisper_exe:
        raise RuntimeError("未安裝 whisper CLI，請先安裝：pip install -U openai-whisper")

    wav = work_dir / "audio.wav"
    if wav.exists():
        wav.unlink()

    run_cmd([
        "ffmpeg", "-y", "-i", str(media_path),
        "-vn", "-ac", "1", "-ar", "16000",
        str(wav)
    ])

    run_cmd([
        whisper_exe, str(wav),
        "--task", "transcribe",
        "--model", model,
        "--language", language,
        "--output_format", "srt",
        "--output_dir", str(work_dir)
    ])

    out = work_dir / "audio.srt"
    if not out.exists():
        raise RuntimeError("Whisper 未產生 SRT")

    if final_srt.exists():
        final_srt.unlink()
    shutil.move(str(out), str(final_srt))

    if wav.exists():
        try:
            wav.unlink()
        except Exception:
            pass


def get_duration_seconds(path: Path) -> float:
    p = run_cmd([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path)
    ])
    try:
        return float((p.stdout or "").strip())
    except Exception:
        return 0.0


def get_video_stream_bitrate(path: Path) -> int:
    """Return video stream bitrate in bps. 0 means ffprobe could not report it."""
    try:
        p = run_cmd([
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=bit_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path)
        ], check=False)
        raw = (p.stdout or "").strip().splitlines()
        for line in raw:
            line = line.strip()
            if line.isdigit():
                return int(line)
    except Exception:
        pass
    return 0


def is_valid_moving_mp4(path: Path, min_video_bitrate: int = 150_000) -> bool:
    """Guard against MUSIC static-cover mp4 files: audio plays but image does not move."""
    if not exists_ok(path, 200_000):
        return False
    br = get_video_stream_bitrate(path)
    if br >= min_video_bitrate:
        return True
    # If bitrate is unavailable, use a conservative size/duration heuristic.
    dur = get_duration_seconds(path)
    try:
        size = path.stat().st_size
    except Exception:
        size = 0
    if dur > 0:
        total_bps = int(size * 8 / dur)
        return total_bps >= 350_000
    return False


def make_cover_from_video(video_path: Path, jpg_path: Path) -> None:
    duration = get_duration_seconds(video_path)
    if duration <= 0:
        raise RuntimeError("無法取得影片長度")
    seek_points = [duration * 0.15, duration * 0.35, duration * 0.55, duration * 0.75]
    temp_imgs: List[Path] = []
    for i, sec in enumerate(seek_points):
        temp = jpg_path.with_name(f"_tmp_cover_{i}.jpg")
        run_cmd([
            "ffmpeg", "-y", "-ss", str(sec), "-i", str(video_path),
            "-frames:v", "1", "-vf", f"scale='min({MAX_VIDEO_WIDTH},iw)':-2", "-q:v", "4", str(temp)
        ])
        if temp.exists() and temp.stat().st_size > 5000:
            temp_imgs.append(temp)
    if not temp_imgs:
        raise RuntimeError("封面抓取失敗")
    best = max(temp_imgs, key=lambda p: p.stat().st_size)
    if jpg_path.exists():
        jpg_path.unlink()
    shutil.move(str(best), str(jpg_path))
    for p in temp_imgs:
        if p.exists() and p != jpg_path:
            try:
                p.unlink()
            except Exception:
                pass


def make_cover_from_thumbnail_or_default(work_dir: Path, slug: str, jpg_path: Path) -> None:
    thumb = find_first_existing(work_dir, [
        f"{work_dir.name}_raw*.jpg", f"{work_dir.name}_raw*.jpeg", f"{work_dir.name}_raw*.png",
        f"{slug}_raw*.jpg", f"{slug}_raw*.jpeg", f"{slug}_raw*.png",
    ])
    if thumb and thumb.exists():
        if jpg_path.exists():
            jpg_path.unlink()
        if thumb.suffix.lower() != ".jpg":
            run_cmd(["ffmpeg", "-y", "-i", str(thumb), "-vf", f"scale='min({MAX_VIDEO_WIDTH},iw)':-2", "-q:v", "4", str(jpg_path)])
        else:
            shutil.copyfile(thumb, jpg_path)
        return
    run_cmd([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=1", "-frames:v", "1", str(jpg_path)
    ])


def parse_srt_text(raw: str) -> List[Dict[str, str]]:
    lines = raw.replace("\r", "").split("\n")
    segments: List[Dict[str, str]] = []
    buffer = {"time": "", "end_time": "", "text": ""}

    def push() -> None:
        nonlocal buffer
        if buffer["time"] and buffer["text"]:
            item = {"time": buffer["time"].strip(), "text": buffer["text"].strip()}
            # 保留 SRT 結束時間，供 MUSIC 品質檢查抓出「前段一大坨字幕」
            if buffer.get("end_time"):
                item["end_time"] = buffer["end_time"].strip()
            segments.append(item)
        buffer = {"time": "", "end_time": "", "text": ""}

    for line in lines:
        line = line.strip()
        if re.fullmatch(r"\d+", line):
            continue
        m = re.match(r"(\d{2}:\d{2}:\d{2}),\d{3}\s*-->\s*(\d{2}:\d{2}:\d{2}),\d{3}", line)
        if m:
            if buffer["time"] or buffer["text"]:
                push()
            buffer["time"] = m.group(1)
            buffer["end_time"] = m.group(2)
        elif line == "":
            if buffer["time"] or buffer["text"]:
                push()
        else:
            buffer["text"] += ((" " if buffer["text"] else "") + line)
    if buffer["time"] or buffer["text"]:
        push()
    return segments



def _bw_norm_line_for_quality(s: str) -> str:
    s = str(s or "").strip().lower()
    s = re.sub(r"[\[\]\(\)♪♫♬]+", " ", s)
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _bw_meaningful_word_count(s: str) -> int:
    stop = {"music", "lyrics", "song", "audio", "instrumental", "foreign", "applause", "uh", "um"}
    words = re.findall(r"[a-z][a-z']+", _bw_norm_line_for_quality(s))
    return sum(1 for w in words if w not in stop and len(w) >= 2)


def _bw_has_native_lyric_script(s: str) -> bool:
    """
    MUSIC SRT 品質檢查用：
    韓文/日文/中文/泰文/尼泊爾文等非拉丁歌詞，不能只用英文 meaningful_words 判斷。
    只要有明顯原文文字，就視為有歌詞內容，不因英文詞少而誤殺。
    """
    return bool(re.search(
        r"[\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]",
        str(s or "")
    ))


def _bw_native_script_char_count(s: str) -> int:
    return len(re.findall(
        r"[\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]",
        str(s or "")
    ))


def validate_music_srt_quality(segments: List[Dict[str, str]], work_dir: Path, slug: str) -> None:
    """
    MUSIC 專用保護：
    歌曲 Whisper 常把整首聽成「Music / ♪ Music ♪」。
    這種 SRT 不能拿去產 cues JSON，否則前台會變成 Music / 音樂 / 音樂。
    發現疑似壞 SRT 時直接停止，不寫 JSON、不推 GitHub。
    """
    if not segments:
        raise RuntimeError("MUSIC SRT 品質檢查失敗：沒有字幕內容")

    texts = [str(x.get("text") or "").strip() for x in segments if str(x.get("text") or "").strip()]
    if not texts:
        raise RuntimeError("MUSIC SRT 品質檢查失敗：字幕全空")

    norm = [_bw_norm_line_for_quality(x) for x in texts]
    bad_tokens = {"music", "lyrics", "song", "audio", "instrumental", "foreign", "applause"}
    bad_line_count = 0
    for raw, n in zip(texts, norm):
        # V38 MUSIC SRT QUALITY hard fix:
        # 韓文/日文/中文/泰文等非拉丁歌詞，經英文 normalize 後可能變空字串。
        # 只要 raw 本行有原文文字，就不能因為 n == "" 被算成 bad line。
        if _bw_has_native_lyric_script(raw):
            compact_native = re.sub(r"""[\s♪♫\-＿_.,!?！？。、《》〈〉（）()\[\]{}'"“”‘’]+""", "", str(raw or ""))
            if compact_native:
                continue

        compact = n.replace(" ", "")
        if not n:
            bad_line_count += 1
            continue
        if n in bad_tokens or compact in bad_tokens:
            bad_line_count += 1
            continue
        # 只剩 music music / lyrics lyrics 這類
        words = [w for w in n.split() if w]
        if words and all(w in bad_tokens for w in words):
            bad_line_count += 1

    meaningful = sum(_bw_meaningful_word_count(x) for x in texts)
    native_chars = sum(_bw_native_script_char_count(x) for x in texts)
    native_line_count = sum(1 for x in texts if _bw_has_native_lyric_script(x))
    native_ratio = native_line_count / max(1, len(texts))
    bad_ratio = bad_line_count / max(1, len(texts))

    # V38 MUSIC SRT QUALITY：
    # 韓文/日文/中文等歌詞常英文詞很少，舊版 meaningful_words 只算英文，會把正常韓文歌誤判成 Music 佔位。
    # 只有「Music 佔位比例真的高」才直接擋；英文詞少則必須同時沒有足夠原文文字才擋。
    too_many_placeholders = bad_ratio >= 0.45
    too_little_real_lyric = (
        meaningful < max(12, len(texts) * 2)
        and native_chars < 24
        and native_ratio < 0.20
    )

    if too_many_placeholders or too_little_real_lyric:
        msg = (
            "MUSIC SRT 品質檢查失敗：疑似 Whisper 沒抓到歌詞，只抓到 Music/音樂類佔位。\\n"
            f"slug={slug}\\n"
            f"lines={len(texts)} bad_lines={bad_line_count} bad_ratio={bad_ratio:.2f} "
            f"meaningful_words={meaningful} native_lines={native_line_count} native_ratio={native_ratio:.2f} native_chars={native_chars}\\n"
            "已停止 JSON 產生，避免前台出現 Music / 音樂 / 音樂。"
        )
        try:
            write_error_file(work_dir, "music_srt_quality.txt", msg)
        except Exception:
            pass
        raise RuntimeError(msg)


    # V25 MUSIC CUE QUALITY：
    # 抓出「前 20~30 秒被 Whisper 吞成一大段」這種錯檔。
    # 這種 SRT 寫成 cues 後，PLAYER 會在前段顯示一坨字幕，而且字/音一定對不準。
    long_blob_hits: List[str] = []
    for i, seg in enumerate(segments):
        start_sec = time_to_sec(str(seg.get("time") or ""))
        end_sec = time_to_sec(str(seg.get("end_time") or ""))
        dur = max(0, end_sec - start_sec) if end_sec > start_sec else 0
        line_text = str(seg.get("text") or "").strip()
        word_count = len(re.findall(r"[A-Za-z][A-Za-z'\-]+", line_text))

        # 開頭第一段：若從 0~1 秒起，卻拉到 14 秒以上，且含大量歌詞，幾乎一定是錯切。
        if i == 0 and start_sec <= 1 and dur >= 14 and word_count >= 12:
            long_blob_hits.append(f"first_segment duration={dur}s words={word_count} time={seg.get('time')}->{seg.get('end_time')}")
            continue

        # 任一段若超過 22 秒且塞進很多歌詞，也視為壞 SRT。
        if dur >= 22 and word_count >= 18:
            long_blob_hits.append(f"segment#{i+1} duration={dur}s words={word_count} time={seg.get('time')}->{seg.get('end_time')}")

    if long_blob_hits:
        msg = (
            "MUSIC SRT 品質檢查失敗：發現超長歌詞段落，會造成 PLAYER 前段字幕一大坨且對不準。\n"
            f"slug={slug}\n"
            + "\n".join(long_blob_hits[:8]) + "\n"
            "已停止 JSON 產生；請重新跑本片，讓新版 vocals Whisper 重抓。"
        )
        try:
            write_error_file(work_dir, "music_srt_long_blob.txt", msg)
        except Exception:
            pass
        raise RuntimeError(msg)



def _bw_format_sec_to_hms(sec: float) -> str:
    sec = max(0, int(round(float(sec or 0))))
    hh = sec // 3600
    mm = (sec % 3600) // 60
    ss = sec % 60
    return f"{hh:02d}:{mm:02d}:{ss:02d}"


def _bw_split_en_music_line(text: str, max_words: int = 12) -> List[str]:
    s = re.sub(r"\s+", " ", str(text or "").strip())
    if not s:
        return []

    # 先用標點／歌詞常見斷點切
    parts = re.split(r"(?<=[,\.;:!?])\s+|\s+(?=(?:and|but|so|cause|because|when|while|if)\b)", s, flags=re.I)
    parts = [p.strip(" ,;") for p in parts if p and p.strip(" ,;")]

    # 若仍過長，再依單字數平均切
    out: List[str] = []
    for p in parts or [s]:
        words = p.split()
        if len(words) <= max_words:
            out.append(p.strip())
            continue
        for i in range(0, len(words), max_words):
            out.append(" ".join(words[i:i + max_words]).strip())

    return [p for p in out if p]


def _bw_split_translation_like(text: str, target_parts: int) -> List[str]:
    s = re.sub(r"\s+", " ", str(text or "").strip())
    if not s or target_parts <= 1:
        return [s] if s else [""]

    # 中文 / 日文盡量依標點切
    parts = re.split(r"(?<=[，。；、！？,.!?;])", s)
    parts = [p.strip() for p in parts if p and p.strip()]

    if len(parts) >= target_parts:
        # 多段時盡量平均合併成 target_parts
        groups = [[] for _ in range(target_parts)]
        for i, p in enumerate(parts):
            idx = min(target_parts - 1, int(i * target_parts / max(1, len(parts))))
            groups[idx].append(p)
        return ["".join(g).strip() for g in groups]

    # 標點不夠，退回依字元平均切
    chars = list(s)
    n = len(chars)
    if n <= 0:
        return [""] * target_parts
    result = []
    for i in range(target_parts):
        a = int(i * n / target_parts)
        b = int((i + 1) * n / target_parts)
        result.append("".join(chars[a:b]).strip())
    return result




# === V50 MUSIC 短碎句自動合併 ===
# Whisper / YouTube 字幕偶爾會把完整歌詞切成：
#   "I'm on the top of the world looking down on"
#   "creation"
# 造成 GPT 將中文／日文翻譯也錯位。先在 SRT 進 GPT 前合併這種 1～2 字碎句。
_BW_MUSIC_CONTINUATION_WORDS = {
    "a", "an", "the", "and", "or", "but", "so", "because", "cause",
    "of", "to", "for", "from", "with", "without", "at", "in", "on",
    "into", "onto", "over", "under", "by", "as", "than", "that",
    "my", "your", "our", "his", "her", "their", "this", "these",
    "those", "all", "just", "only"
}


def _bw_music_en_words(text: str) -> List[str]:
    return re.findall(r"[A-Za-z][A-Za-z'\-]*", str(text or ""))


def _bw_music_line_looks_complete(text: str) -> bool:
    s = str(text or "").strip()
    if not s:
        return True
    # 明確句尾不要合併；逗號、分號仍可能是歌詞跨行。
    return bool(re.search(r"[.!?。！？][\"'’”)]*$", s))


def merge_short_music_srt_segments(
    segments: List[Dict[str, str]],
    slug: str = "",
) -> List[Dict[str, str]]:
    """
    V50 MUSIC SRT AUTO-MERGE：
    僅合併高可信度的短碎句，避免一般正常短歌詞被誤併。

    條件：
      1) 下一段只有 1～2 個英文詞；
      2) 與上一段起始時間相隔不超過 7 秒；
      3) 上一句沒有明確句號／問號／驚嘆號；
      4) 上一句以介系詞、冠詞、連接詞、所有格等未完成詞結尾，
         或下一段只有 1 個詞且合併後不超過 14 詞；
      5) 合併後總長不超過 14 個英文詞。
    """
    if not isinstance(segments, list) or len(segments) < 2:
        return segments

    merged: List[Dict[str, str]] = []
    merge_count = 0

    for raw_seg in segments:
        if not isinstance(raw_seg, dict):
            continue

        seg = dict(raw_seg)
        cur_text = re.sub(r"\s+", " ", str(seg.get("text") or "").strip())
        if not cur_text:
            continue
        seg["text"] = cur_text

        if not merged:
            merged.append(seg)
            continue

        prev = merged[-1]
        prev_text = re.sub(r"\s+", " ", str(prev.get("text") or "").strip())
        prev_words = _bw_music_en_words(prev_text)
        cur_words = _bw_music_en_words(cur_text)

        prev_start = time_to_sec(str(prev.get("time") or ""))
        cur_start = time_to_sec(str(seg.get("time") or ""))
        start_gap = cur_start - prev_start if cur_start >= prev_start else 999
        combined_count = len(prev_words) + len(cur_words)
        prev_last = prev_words[-1].lower() if prev_words else ""

        short_fragment = 1 <= len(cur_words) <= 2
        close_in_time = 0 <= start_gap <= 7
        unfinished_prev = (
            prev_last in _BW_MUSIC_CONTINUATION_WORDS
            or (len(cur_words) == 1 and len(prev_words) >= 3)
        )

        should_merge = (
            short_fragment
            and close_in_time
            and not _bw_music_line_looks_complete(prev_text)
            and unfinished_prev
            and combined_count <= 14
        )

        if not should_merge:
            merged.append(seg)
            continue

        prev["text"] = f"{prev_text} {cur_text}".strip()
        # 合併後沿用前段開始時間，結束時間延伸到短碎句的結束時間。
        if str(seg.get("end_time") or "").strip():
            prev["end_time"] = str(seg.get("end_time") or "").strip()
        elif str(seg.get("time") or "").strip():
            prev["end_time"] = str(seg.get("time") or "").strip()

        merge_count += 1

    if merge_count:
        print(
            f"[MUSIC SRT] 自動合併 {merge_count} 個 1～2 字短碎句："
            f"{slug or '-'}，segments {len(segments)} -> {len(merged)}"
        )

    return merged


def normalize_music_srt_segments_for_pipeline(segments: List[Dict[str, str]], slug: str = "") -> List[Dict[str, str]]:
    """
    V28 MUSIC SRT AUTO-SPLIT：
    small.en + vocals.mp3 仍可能出現：
      [00:00 -> 00:17] 16~20 個詞
    舊版會直接停止，造成 JSON 不產生。
    現在改成：
      1) SRT 超長歌詞段先自動切成短句
      2) 依原段落 duration 與詞數比例重新分配 time / end_time
      3) 再進品質檢查與 GPT 產 JSON

    目標：
      - 不再因第一段 17 秒 16 詞直接中止
      - PLAYER 不再看到一整坨字幕
    """
    if not isinstance(segments, list) or not segments:
        return segments

    rebuilt: List[Dict[str, str]] = []
    split_count = 0

    for seg in segments:
        if not isinstance(seg, dict):
            continue

        start_text = str(seg.get("time") or "").strip()
        end_text = str(seg.get("end_time") or "").strip()
        line_text = re.sub(r"\s+", " ", str(seg.get("text") or "").strip())

        if not start_text or not line_text:
            rebuilt.append(seg)
            continue

        start_sec = time_to_sec(start_text)
        end_sec = time_to_sec(end_text) if end_text else start_sec
        dur = max(0, end_sec - start_sec) if end_sec > start_sec else 0
        word_count = len(re.findall(r"[A-Za-z][A-Za-z'\-]+", line_text))

        # MUSIC SRT 自動切短門檻：
        # - 句子本身詞太多
        # - 或 duration 過長且詞數也偏多
        needs_split = (
            word_count >= 16
            or (dur >= 14 and word_count >= 12)
            or (dur >= 22 and word_count >= 10)
        )

        if not needs_split:
            rebuilt.append(seg)
            continue

        parts = _bw_split_en_music_line(line_text, max_words=10)
        if len(parts) <= 1:
            rebuilt.append(seg)
            continue

        split_count += 1
        part_word_counts = [
            max(1, len(re.findall(r"[A-Za-z][A-Za-z'\-]+", p)))
            for p in parts
        ]
        total_words = max(1, sum(part_word_counts))

        # 如果原 SRT 沒有 end_time，就給一個最保守 2.8 秒/段
        total_dur = dur if dur > 0 else max(3 * len(parts), 1)
        elapsed_words = 0

        for i, p in enumerate(parts):
            before_ratio = elapsed_words / total_words
            elapsed_words += part_word_counts[i]
            after_ratio = elapsed_words / total_words

            p_start = start_sec + total_dur * before_ratio
            p_end = start_sec + total_dur * after_ratio

            # 避免四捨五入後 time/end_time 同秒，至少維持遞進
            p_start_hms = _bw_format_sec_to_hms(p_start)
            p_end_hms = _bw_format_sec_to_hms(max(p_start + 1, p_end))

            rebuilt.append({
                "time": p_start_hms,
                "end_time": p_end_hms,
                "text": p.strip(),
            })

    if split_count:
        print(f"[MUSIC SRT] 自動切短 {split_count} 個超長段落：{slug or '-'}，segments {len(segments)} -> {len(rebuilt)}")

    return rebuilt



def normalize_music_cues_for_player(obj: Any) -> Any:
    """
    MUSIC cues 顯示優化：
    - GPT 偶爾仍會產出 20~40 個英文詞的一大段 lyrics。
    - PLAYER 讀起來就會像「整坨字幕」。
    - 這裡把過長 MUSIC cue 自動切成短句，並在本 cue 與下一 cue 的時間區間內重新分配 time。
    """
    arr = obj if isinstance(obj, list) else (obj.get("cues") if isinstance(obj, dict) else None)
    if not isinstance(arr, list) or not arr:
        return obj

    items = [x for x in arr if isinstance(x, dict)]
    if not items:
        return obj

    rebuilt: List[Dict[str, Any]] = []
    for i, item in enumerate(items):
        en = str(item.get("en") or "").strip()
        words = re.findall(r"[A-Za-z][A-Za-z'\-]+", en)

        cur_t = time_to_sec(str(item.get("time") or ""))
        next_t = time_to_sec(str(items[i + 1].get("time") or "")) if i + 1 < len(items) else cur_t + 6
        gap = max(2, next_t - cur_t) if next_t > cur_t else 6

        # MUSIC 顯示目標：一列盡量 8~12 詞；16 詞以上就切。
        if len(words) < 16:
            rebuilt.append(item)
            continue

        en_parts = _bw_split_en_music_line(en, max_words=12)
        if len(en_parts) <= 1:
            rebuilt.append(item)
            continue

        zh_parts = _bw_split_translation_like(str(item.get("zh") or ""), len(en_parts))
        ja_parts = _bw_split_translation_like(str(item.get("ja") or ""), len(en_parts))

        # 依英文詞數比例分配時間
        part_word_counts = [max(1, len(re.findall(r"[A-Za-z][A-Za-z'\-]+", p))) for p in en_parts]
        total_words = max(1, sum(part_word_counts))
        elapsed = 0.0

        for j, p in enumerate(en_parts):
            new_item = dict(item)
            ratio_before = elapsed / total_words
            new_t = cur_t + gap * ratio_before
            new_item["time"] = _bw_format_sec_to_hms(new_t)
            new_item["en"] = p
            new_item["zh"] = zh_parts[j] if j < len(zh_parts) else ""
            new_item["ja"] = ja_parts[j] if j < len(ja_parts) else ""

            # source_url 只留第一段，避免每段重複
            if j > 0 and "source_url" in new_item:
                new_item.pop("source_url", None)

            rebuilt.append(new_item)
            elapsed += part_word_counts[j]

    if isinstance(obj, dict):
        out = dict(obj)
        out["cues"] = rebuilt
        return out
    return rebuilt


def validate_cues_json_quality(obj: Any, category: str, work_dir: Path, slug: str) -> None:
    """
    MUSIC cues 保護：
    1) cues 必須是陣列。
    2) 不能大比例是 Music/音樂佔位。
    3) zh/ja 不能大比例直接等於英文，否則代表 GPT 翻譯失敗或 fallback 被寫入。
    """
    if category != "music":
        return

    arr = obj if isinstance(obj, list) else (obj.get("cues") if isinstance(obj, dict) else None)
    if not isinstance(arr, list) or not arr:
        raise RuntimeError("MUSIC cues 品質檢查失敗：cues 不是有效陣列")

    # V44：先確認 Music 三格式已固定，讓壞格式不會被當成成功檔續跑。
    validate_music_cue_schema(obj, slug)

    if music_cues_has_mantra_fallback(obj):
        msg = (
            "MUSIC cues 品質檢查失敗：偵測到 Mantra / meditative chanting fallback，被誤當成韓文/外語歌詞。\n"
            f"slug={slug}\n"
            "已停止寫入，避免前台整排顯示冥想/咒語佔位。"
        )
        try:
            write_error_file(work_dir, "music_cues_mantra_fallback.txt", msg)
        except Exception:
            pass
        raise RuntimeError(msg)

    total = 0
    bad_music = 0
    same_trans = 0
    for item in arr:
        if not isinstance(item, dict):
            continue
        en = str(item.get("en") or "").strip()
        zh = str(item.get("zh") or "").strip()
        ja = str(item.get("ja") or "").strip()
        if not en:
            continue
        total += 1
        n = _bw_norm_line_for_quality(en)
        if n in {"music", "lyrics", "song", "audio", "instrumental"} or all(w in {"music","lyrics","song","audio","instrumental"} for w in n.split() if w):
            bad_music += 1
        if zh and _bw_norm_line_for_quality(zh) == n:
            same_trans += 1
        if ja and _bw_norm_line_for_quality(ja) == n:
            same_trans += 1

    if total <= 0:
        raise RuntimeError("MUSIC cues 品質檢查失敗：沒有英文句")

    bad_ratio = bad_music / total
    same_ratio = same_trans / max(1, total * 2)


    # V25 MUSIC cues 專用：
    # 即使 GPT JSON 合法，也要擋「一筆 lyrics 撐 20~30 秒」。
    # PLAYER 句長是用下一個 cue 的 time 推算；若第一筆 gap 過大，就會形成前 30 秒一坨字幕。
    cue_long_blob_hits: List[str] = []
    normalized_items = [x for x in arr if isinstance(x, dict) and str(x.get("en") or "").strip()]
    for i, item in enumerate(normalized_items):
        cur_t = time_to_sec(str(item.get("time") or ""))
        next_t = time_to_sec(str(normalized_items[i + 1].get("time") or "")) if i + 1 < len(normalized_items) else cur_t
        gap = max(0, next_t - cur_t)
        en = str(item.get("en") or "").strip()
        words = len(re.findall(r"[A-Za-z][A-Za-z'\-]+", en))

        # 即使時間 gap 不算超長，單筆 lyrics 字數太多，前台閱讀也會變成一坨。
        if words >= 18:
            cue_long_blob_hits.append(f"cue#{i+1} overlong_words={words} time={item.get('time')}")
            continue

        if i == 0 and cur_t <= 1 and gap >= 14 and words >= 12:
            cue_long_blob_hits.append(f"first_cue gap={gap}s words={words} time={item.get('time')}")
            continue
        if gap >= 22 and words >= 18:
            cue_long_blob_hits.append(f"cue#{i+1} gap={gap}s words={words} time={item.get('time')}")

    if cue_long_blob_hits:
        msg = (
            "MUSIC cues 品質檢查失敗：發現超長 cue，會造成前段一大坨字幕與音畫不準。\n"
            f"slug={slug}\n"
            + "\n".join(cue_long_blob_hits[:8]) + "\n"
            "已停止寫入，避免壞 cues 上架。"
        )
        try:
            write_error_file(work_dir, "music_cues_long_blob.txt", msg)
        except Exception:
            pass
        raise RuntimeError(msg)

    if bad_ratio >= 0.30 or same_ratio >= 0.45:
        msg = (
            "MUSIC cues 品質檢查失敗：疑似錯誤 JSON。\\n"
            f"slug={slug}\\n"
            f"lines={total} music_placeholder_ratio={bad_ratio:.2f} untranslated_ratio={same_ratio:.2f}\\n"
            "已停止寫入，避免前台顯示錯字幕。"
        )
        try:
            write_error_file(work_dir, "music_cues_quality.txt", msg)
        except Exception:
            pass
        raise RuntimeError(msg)


def time_to_sec(hms: str) -> int:
    m = re.match(r"^(\d{2}):(\d{2}):(\d{2})$", (hms or "").strip())
    if not m:
        return 0
    hh, mm, ss = map(int, m.groups())
    return hh * 3600 + mm * 60 + ss


def compute_duration_sec_from_srt(segments: List[Dict[str, str]]) -> int:
    if not segments:
        return 0
    return time_to_sec(segments[-1]["time"])


def chunk_sentence(en: str) -> List[str]:
    s = (en or "").strip()
    if not s:
        return []
    parts = re.split(r"(?<=[\.\?\!,:;])\s+", s)
    parts = [p for p in parts if p]
    if len(parts) <= 1:
        m = re.match(r"^(.*\b)(but|and|or|so|because|if|when|while)\b(.*)$", s, flags=re.I)
        if m and m.group(1) and m.group(3):
            parts = [(m.group(1) + m.group(2)).strip(), m.group(3).strip()]
    if len(parts) > 4:
        parts = [" ".join(parts[:2]), " ".join(parts[2:])]
    return parts


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")



def write_meta_json(work_dir: Path, slug: str, index_obj: Dict[str, Any]) -> None:
    meta = {
        "id": index_obj.get("slug", slug),
        "domain_code": index_obj.get("domain_code"),
        "target_role": index_obj.get("target_role"),
        "dialog_roles": index_obj.get("dialog_roles", []),
        "lesson_type": index_obj.get("lesson_type"),
        "scene": index_obj.get("scene"),
        "scene_tags": index_obj.get("scene_tags", []),
        "order": index_obj.get("order", 1),
        "title": index_obj.get("title", slug),
        "duration_sec": index_obj.get("duration_sec", 0),
        "difficulty_level": index_obj.get("difficulty_level", 2),
        "youtube_url": index_obj.get("youtube_url", ""),
        "youtube_id": index_obj.get("youtube_id", ""),
        "video": index_obj.get("video", ""),
        "cover": index_obj.get("cover", ""),
        "is_public": index_obj.get("is_public", True),
    }
    write_json(work_dir / f"meta-{slug}.json", meta)

def openai_chat(api_key: str, payload: Dict[str, Any]) -> str:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    last_err: Optional[str] = None
    for i in range(OPENAI_RETRIES):
        try:
            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=data,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                raw = resp.read().decode("utf-8")
            obj = json.loads(raw)
            content = (((obj.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
            m = re.search(r"```(?:json)?\s*([\s\S]*?)```", content, flags=re.I)
            if m:
                content = m.group(1).strip()
            if not content:
                raise RuntimeError("OpenAI 沒回內容")
            return content
        except Exception as e:
            last_err = str(e)
            if i < OPENAI_RETRIES - 1:
                time.sleep(2 + i)
    raise RuntimeError(f"OpenAI 失敗：{last_err}")


def build_chat_payload(kind: str, slug: str, category: str, srt_segments: List[Dict[str, str]], youtube_url: str) -> Dict[str, Any]:
    srt_sample = "\n".join(f"{x['time']} {x['text']}" for x in srt_segments)
    local_note = bw_local_instruction()
    video_url = f"{R2_PUBLIC_BASE}/videos/{category}/{slug}.mp4"
    cover_url = f"{R2_PUBLIC_BASE}/assets/{category}/{slug}.jpg"
    youtube_id = extract_youtube_id(youtube_url)

    if kind == "cues":
        if category == "music":
            system_msg = """你是一個只會輸出 JSON 的系統。請把音樂字幕整理成 Music cues JSON。
輸入字幕是原唱/原聲辨識結果，可能是日文、韓文或其他當地語，不一定是英文。
輸出必須是 JSON 陣列，每筆格式固定如下：
[
  {
    \"time\": \"00:00:00\",
    \"native\": \"原唱原文；日文歌就是日文原文\",
    \"kana\": \"只有日文歌填假名讀音，台灣學日文用；非日文留空\",
    \"roman\": \"非日文才填 Latin romanization；日文歌留空\",
    \"en\": \"English meaning\",
    \"zh\": \"繁體中文意譯\",
    \"ja\": \"當地語翻譯或日文原文（舊欄位相容）\",
    \"local_lang\": \"當地語代碼\",
    \"local_label\": \"當地語名稱\",
    \"local\": \"同 native 或當地語文字\",
    \"local_pron\": \"非日文羅馬拼音；日文可留空或假名\"
  }
]
嚴格規則：
- 只能輸出 JSON，不可加說明，不可包程式碼框。
- time 必須沿用字幕時間。
- LOCAL_LANG=ja 時：native 必須是日文；kana 必須是假名；roman 必須留空，不要輸出羅馬拼音。
- LOCAL_LANG=en 時：native/en 必須是英文原詞；zh 必填；ja 必填且必須是自然日文意思；lyrics_mode 必須 en_zh_ja。
- LOCAL_LANG=zh 時：native/zh 必須是中文原詞；pinyin/roman 必填；en 必填；ja 必填；lyrics_mode 必須 zh_pinyin_en_ja。
- LOCAL_LANG=ko/th/ne/hi 等非日文時：native 原文，roman 必填，en 必填，zh 必填。
- en 是國際英文理解文字，必須存在。
- zh 是繁體中文；中文歌時是原詞，其他語言時是繁體中文意譯，必須存在。
- 不要根據聽不清楚的片段亂編單字；不確定時可用較保守的意譯。
"""
            music_lang = bw_local_lang()
            music_label = bw_local_label()
            if music_lang == "en":
                music_format_note = (
                    "【Music 格式鎖定：英文歌】\n"
                    "這首歌必須使用舊英中日格式：en / zh / ja。\n"
                    "每筆必須：native=en；roman=''；local=en；local_lang='en'；local_label='英文'；lyrics_mode='en_zh_ja'。\n"
                    "ja 必須是自然日文意思，不可空白，不可照抄英文，不可放中文；例如 Never be enough 可譯為『決して十分ではない』。\n"
                    "zh 必須是繁體中文意思，不可空白。\n"
                    "主句是英文，不要把日文或其他語言放進 native。\n"
                )
            elif music_lang in ("ja", "jp"):
                music_format_note = (
                    "【Music 格式鎖定：日文歌】\n"
                    "這首歌必須使用：native(日文原文) / kana(假名) / en / zh。\n"
                    "每筆必須：roman=''；local=native；ja=native；local_pron=kana；local_lang='ja'；local_label='日文'；lyrics_mode='ja_kana_en_zh'。\n"
                )
            elif music_lang in ("zh", "zh-tw", "zh-cn", "cn"):
                music_format_note = (
                    "【Music 格式鎖定：中文歌】\n"
                    "這首歌必須使用：native/zh(中文原詞) / pinyin(漢語拼音) / en / ja(日文意思)。\n"
                    "每筆必須：native=中文原詞；zh=native；pinyin=漢語拼音；roman=pinyin；local=native；local_pron=pinyin；local_lang='zh'；local_label='中文'；lyrics_mode='zh_pinyin_en_ja'。\n"
                    "ja 必須是自然日文意思，不可空白，不可照抄中文，不可放羅馬拼音；例如「突然好想你」可譯為「急にあなたが恋しくなった」。\n"
                    "en 必須是自然英文意思，不可空白；pinyin 必須是漢語拼音，不可空白。\n"
                    "不要把中文歌當成其他外語格式；不要在 zh 欄放翻譯，zh 就是原唱中文原詞。\n"
                )
            else:
                music_format_note = (
                    f"【Music 格式鎖定：{music_label}歌】\n"
                    "這首歌必須使用：native(原文) / roman(Latin romanization) / en / zh。\n"
                    f"每筆必須：local=native；ja=native；{music_lang}=native；local_pron=roman；{music_lang}_pron=roman；local_lang='{music_lang}'；local_label='{music_label}'；lyrics_mode='native_roman_en_zh'。\n"
                )
            user_msg = "以下是音樂字幕。\n" + local_note + "\n" + music_format_note + "\n請輸出 Music cues JSON：\n" + srt_sample
        else:
            system_msg = """你是一個只會輸出 JSON 的系統。請把英文字幕轉成三語 cues JSON。
輸出必須是 JSON 陣列，每筆格式固定如下：
[
  {
    \"time\": \"00:00:00\",
    \"en\": \"英文原句\",
    \"zh\": \"繁體中文翻譯\",
    \"ja\": \"當地語翻譯（舊欄位相容）\",
    \"local_lang\": \"當地語代碼\",
    \"local_label\": \"當地語名稱\",
    \"local\": \"當地語翻譯\",
    \"<lang>\": \"當地語翻譯\",
    \"local_pron\": \"羅馬拼音\",
    \"<lang>_pron\": \"羅馬拼音\"
  }
]
規則：
- 只能輸出 JSON，不可加說明，不可包程式碼框。
- time 必須沿用字幕時間。
- time 必須沿用字幕時間。
- native 是「原聲/原唱文字」；英文影片可與 en 相同。Music 世界音樂請把聽到的原文放 native，不要假裝成英文。
- roman 是 native 的 Latin romanization；非拉丁文字必填，拉丁字母語言可用去重音後原文；不可用 IPA /.../。
- en 必須存在，是國際英文理解文字；若 native 已是英文，en 可與 native 相同。
- zh 必須是繁體中文。
- ja 必須是自然日文翻譯，不可照抄英文，不可空白；非 music 影片固定顯示 英文 / 中文 / 日文。
- local_lang 可以是 en，但 ja 仍然必須保留日文翻譯；不要因 local_lang=en 把 ja 改成英文。
- local / <lang> 可依 local_note 相容保留；local_pron 與 <lang>_pron 可輸出羅馬拼音；拉丁字母語言不可輸出 IPA /.../.
"""
        user_msg = "以下是影片字幕。\n" + local_note + "\n【重要覆蓋規則】這是非 music 影片，cues 必須固定有 en/zh/ja；ja 一律是自然日文翻譯，不可照抄英文；即使 local_lang=en 也不能把 ja 改成英文。\n請輸出 cues JSON：\n" + srt_sample
    elif kind == "quiz":
        system_msg = """你是一個只會輸出 JSON 的系統。
請根據影片字幕，產生固定 40 題 quiz JSON：4 類各 10 題。
section 只能使用：單字 / 文法 / 閱讀 / 綜合
- 單字：字彙、片語、語意題。
- 文法：時態、句型、介系詞、代名詞、連接詞、語序等文法題。
- 閱讀：主旨、內容與細節理解題。
- 綜合：情境應用、推論與延伸理解題。
type 固定填 single。
輸出必須是 JSON 陣列。
每題格式：
{
  "section": "單字 | 文法 | 閱讀 | 綜合",
  "type": "single",
  "question": "英文題目",
  "question_zh": "繁體中文題目翻譯",
  "options": ["英文選項1", "英文選項2", "英文選項3", "英文選項4"],
  "options_zh": ["繁體中文選項1", "繁體中文選項2", "繁體中文選項3", "繁體中文選項4"],
  "answer": "A | B | C | D",
  "answer_en": "正確英文短語",
  "answer_zh": "正確中文短語",
  "answer_ja": "正確當地語短語（舊欄位相容）",
  "answer_local": "正確當地語短語",
  "answer_local_pron": "正確當地語的羅馬拼音",
  "<lang>_pron": "正確當地語的羅馬拼音",
  "explanation_zh": "中文一句話解釋"
}
只能輸出 JSON。
"""
        user_msg = "以下是影片字幕。\n" + local_note + "\n請輸出 quiz JSON：\n" + srt_sample
    elif kind == "vocab":
        system_msg = """你是一個只會輸出 JSON 的系統。
請根據影片字幕，挑出重點字彙或片語，輸出 JSON 陣列。

格式必須完全固定如下：
[
  {
    \"time\": \"00:00:07\",
    \"word\": \"英文單字或片語\",
    \"ipa\": \"/英文 IPA 音標/；不確定可留空字串\",
    \"kk\": \"KK 音標；不確定可留空字串\",
    \"pos\": \"詞性，例如 noun / verb / adjective / phrase\",
    \"zh\": \"繁體中文解釋\",
    \"en\": \"英文解釋\",
    \"en_example\": \"英文例句\",
    \"zh_example\": \"繁體中文例句\",
    \"ja\": \"日文解釋\",
    \"kana\": \"日文假名讀音；以 ja 欄位的日文為準，不確定可留空字串\",
    \"romaji\": \"日文羅馬音；非日文可留空字串\",
    \"local\": \"當地語解釋\",
    \"local_pron\": \"當地語羅馬拼音；不可使用 IPA /.../\",
    \"<lang>\": \"當地語解釋\",
    \"<lang>_pron\": \"當地語羅馬拼音；不可使用 IPA /.../\",
    \"ja_example\": \"當地語例句（舊欄位相容）\",
    \"local_example\": \"當地語例句\",
    \"local_example_pron\": \"當地語例句羅馬拼音\"
  }
]

嚴格規則：
- 只能輸出 JSON 陣列，不可加說明，不可包程式碼框。
- 每筆都必須包含 time / word / ipa / kk / pos / zh / en / en_example / zh_example / ja / kana / romaji / ja_example。
- time 必須取自字幕時間，格式 HH:MM:SS。
- word 是要顯示在單字卡標題上的英文單字或片語，必須可朗讀。
- ipa 優先輸出通用 IPA，例如 /ˈbʌt.lɚ/；若是片語可依主要單字或整句常用讀法輸出。
- kk 可輸出美式 KK；不確定就留空字串，不要亂編。
- pos 必須是詞性；片語可填 phrase。
- zh 必須是繁體中文解釋。
- en 必須是英文解釋，不可空白，不可只重複 word。
- ja 永遠必須是自然日文解釋，不可照抄英文；local_lang 為任何語言都不可改掉 ja。
- kana 必須是 ja 欄位的日文假名讀音，例如 執事、バトラー -> しつじ、バトラー；不確定就留空字串。
- romaji 只是日文輔助欄位，非日文可留空字串。
- local_pron / <lang>_pron 必須是羅馬拼音，不可輸出 IPA，不可加 /.../。
- en_example / zh_example / ja_example / local_example 都不可省略；ja_example 永遠必須是自然日文例句。
- 大約 15～25 筆，優先挑對學習有價值的字彙。
"""
        user_msg = "以下是影片字幕。\n" + local_note + "\n請輸出完整 vocab JSON，並補上 ipa/kk/kana/romaji/local_pron 欄位：\n" + srt_sample
    elif kind == "ai":
        system_msg = """你是一個只會輸出 JSON 的系統。
根據影片情境產生 AI 練習，輸出 JSON 陣列。
格式：
[
  {
    \"title\": \"標題（英文）\",
    \"prompt\": \"英文任務\",
    \"hint\": \"英文提示\",
    \"sample\": \"英文示範\",
    \"ja\": {\"prompt\": \"...\", \"hint\": \"...\", \"sample\": \"...\"},
    \"local\": {\"prompt\": \"...\", \"hint\": \"...\", \"sample\": \"...\"},
    \"local_pron\": {\"prompt\": \"羅馬拼音\", \"hint\": \"羅馬拼音\", \"sample\": \"羅馬拼音\"},
    \"zh\": {\"prompt\": \"...\", \"hint\": \"...\", \"sample\": \"...\"}
  }
]
嚴格規則：
- ja.prompt / ja.hint / ja.sample 永遠必須是自然日文，不可照抄英文。
- local 依 local_note 產生當地語，但不可覆蓋 ja。
- 所有 prompt / hint / sample 都必須是純文字，不可把物件轉成字串。
只能輸出 JSON。
"""
        user_msg = "以下是影片字幕。\n" + local_note + "\n【重要】ja 三欄固定是真正日文，local 才依當地語設定。\n請依情境輸出 ai JSON：\n" + srt_sample
    elif kind == "index":
        system_msg = f"""你是一個只會輸出 JSON 的系統。
請輸出單一 JSON 物件：
{{
  \"title\": \"繁體中文標題（若不確定可用英文）\",
  \"category\": \"{category}\",
  \"slug\": \"{slug}\",
  \"video\": \"{video_url}\",
  \"cover\": \"{cover_url}\",
  \"youtube_url\": \"{youtube_url}\",
  \"youtube_id\": \"{youtube_id}\",
  \"cues\": {{ \"zh\": \"./cues-{slug}.json\" }},
  \"vocab\": \"./vocab-{slug}.json\",
  \"quiz\": \"./quiz-{slug}.json\",
  \"ai\": \"./ai-{slug}.json\",
  \"domain_code\": \"healthcare | education | business | engineering | service | student | lifestyle\",
  \"role_codes\": [\"nurse\", \"patient\"],
  \"lesson_type\": \"appointment\",
    \"scene_tags\": [\"medical\", \"daily\"],
  \"order\": 1,
  \"is_public\": true
}}
只能輸出 JSON。
"""
        user_msg = f"category: {category}\nslug: {slug}\nvideo: {video_url}\ncover: {cover_url}\nyoutube_url: {youtube_url}\nyoutube_id: {youtube_id}"
    else:
        raise RuntimeError(f"未知 kind: {kind}")

    return {
        "model": DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.2,
    }


def build_dialogue_payload(slug: str, category: str, source_url: str, segments: List[Dict[str, str]]) -> Dict[str, Any]:
    lines = "\n".join(f"{s['time']} {s['text']}" for s in segments)
    local_note = bw_local_instruction()
    system_msg = """你是 BookWide 的雙語（繁體中文/當地語）口語對話編輯器。
請只輸出合法 JSON，不要解釋，不要程式碼框。
格式：
{
  \"meta\": { \"slug\":\"...\", \"category\":\"...\", \"source_url\":\"...\", \"mode\":\"srt\" },
  \"dialogue\": [
    { \"role\":\"teacher|student\", \"text\":\"英文\", \"zh\":\"繁體中文\", \"ja\":\"自然日文翻譯\", \"local\":\"當地語\", \"local_pron\":\"英文時必須留空\", \"time\":\"00:00:00\" }
  ]
}
嚴格規則：
- ja 永遠是自然日文翻譯，不可照抄英文。
- local_lang=en 時，local 可等於英文，但 local_pron 必須留空。
- text / zh / ja 三欄不可互相覆蓋。
"""
    user_msg = f"slug: {slug}\ncategory: {category}\nsource_url: {source_url}\n\n{local_note}\n\n以下是字幕：\n{lines}"
    return {
        "model": DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.2,
    }


def build_speaking_json_from_srt(slug: str, category: str, source_url: str, segments: List[Dict[str, str]]) -> Dict[str, Any]:
    items = []
    for i, seg in enumerate(segments):
        t0 = time_to_sec(seg["time"])
        t1 = time_to_sec(segments[i + 1]["time"]) if i + 1 < len(segments) else (t0 + 4)
        line_en = (seg["text"] or "").strip()
        if not line_en:
            continue
        chunks = chunk_sentence(line_en)
        items.append({
            "t0": t0,
            "t1": t1,
            "time": seg["time"],
            "line_en": line_en,
            "coach": {
                "goal": "Shadow (跟讀)",
                "say": line_en,
                "hint": ("Chunk it: " + " / ".join(chunks)) if chunks else "Shadow it once, then repeat slowly.",
                "drill": ["shadow", "repeat_slow", "chunking"],
            }
        })
    return {"slug": slug, "category": category or "", "source_url": source_url, "lang": "en", "mode": "srt", "items": items}


def simple_translate_zh(text: str) -> str:
    return text


def simple_translate_ja(text: str) -> str:
    return text


def fallback_cues(segments: List[Dict[str, str]], youtube_url: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i, seg in enumerate(segments):
        item: Dict[str, Any] = {
            "time": seg["time"],
            "en": seg["text"],
            "zh": simple_translate_zh(seg["text"]),
            "ja": simple_translate_ja(seg["text"]),
        }
        if i == 0 and youtube_url:
            item["source_url"] = youtube_url
        out.append(item)
    return out


def extract_vocab_words(segments: List[Dict[str, str]], limit: int = 20) -> List[str]:
    stop = {
        "the", "a", "an", "and", "or", "but", "if", "to", "of", "in", "on", "at", "for", "with", "is", "are", "was", "were",
        "be", "been", "being", "i", "you", "he", "she", "it", "we", "they", "this", "that", "these", "those", "my", "your",
        "his", "her", "their", "our", "me", "him", "them", "do", "does", "did", "have", "has", "had", "will", "would",
        "can", "could", "should", "from", "as", "by", "about", "into", "up", "down", "out", "not", "no", "yes", "so"
    }
    freq: Dict[str, int] = {}
    for seg in segments:
        for w in re.findall(r"[A-Za-z][A-Za-z\-']+", seg["text"]):
            wl = w.lower()
            if wl in stop or len(wl) < 3:
                continue
            freq[wl] = freq.get(wl, 0) + 1
    words = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
    return [w for w, _ in words[:limit]]


def fallback_vocab(segments: List[Dict[str, str]]) -> List[Dict[str, str]]:
    words = extract_vocab_words(segments)
    out: List[Dict[str, str]] = []
    examples = [s for s in segments if s.get("text", "").strip()]
    if not examples:
        examples = [{"time": "00:00:00", "text": ""}]

    for i, word in enumerate(words):
        seg = next(
            (s for s in examples if re.search(rf"\b{re.escape(word)}\b", s.get("text", ""), flags=re.I)),
            examples[i % len(examples)]
        )
        ex = seg.get("text", "").strip() or word
        out.append({
            "time": seg.get("time", "00:00:00"),
            "word": word,
            "ipa": "",
            "kk": "",
            "pos": "phrase" if " " in word else "noun",
            "zh": word,
            "en": f"A key word or phrase from the video: {word}.",
            "en_example": ex,
            "zh_example": ex,
            "ja": word,
            "kana": "",
            "romaji": "",
            "ja_example": ex,
        })
    return out


def fallback_quiz(segments: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    questions: List[Dict[str, Any]] = []
    usable = [s["text"].strip() for s in segments if s["text"].strip()]
    words = extract_vocab_words(segments, limit=12)
    while len(words) < 4:
        words.append(f"word{len(words)+1}")

    types = ["listening", "vocab", "grammar", "speaking"]
    idx = 0
    for t in types:
        for _ in range(5):
            line = usable[idx % len(usable)] if usable else "Sample sentence."
            word = words[idx % len(words)]
            questions.append({
                "type": t,
                "question": f"Which option best matches this line: {line}" if t == "listening" else (
                    f"What does '{word}' most likely mean in the video?" if t == "vocab" else (
                        f"Choose the most natural rewrite of: {line}" if t == "grammar" else f"What would you say after: {line}"
                    )
                ),
                "choices": [line, word, "I don't know.", "Let's try again."],
                "answer": 0,
                "explanation": {"en": "Fallback quiz item.", "zh": "備援題目。", "ja": "フォールバック問題。"},
            })
            idx += 1
    return questions


def fallback_ai(segments: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    sample = segments[0]["text"] if segments else "Hello."
    return [{
        "title": "Talk about the video",
        "prompt": f"Use one or two sentences to respond to this scene: {sample}",
        "hint": "Reuse words from the subtitles.",
        "sample": sample,
        "ja": {"prompt": "字幕の内容について一、二文で答えてください。", "hint": "字幕に出てくる言葉を使ってください。", "sample": "字幕の内容に合わせて、自分の考えを簡潔に答えます。"},
        "zh": {"prompt": "請用一到兩句回應這個情境。", "hint": "可直接重用字幕的字。", "sample": sample},
    }]


def normalize_vocab_payload(obj: Any, segments: List[Dict[str, str]]) -> List[Dict[str, str]]:
    arr = obj if isinstance(obj, list) else []
    examples = [s for s in segments if s.get("text", "").strip()]
    if not examples:
        examples = [{"time": "00:00:00", "text": ""}]

    out: List[Dict[str, str]] = []
    for i, item in enumerate(arr):
        if not isinstance(item, dict):
            continue

        word = str(item.get("word") or item.get("term") or item.get("phrase") or "").strip()
        if not word:
            continue

        seg = examples[i % len(examples)]
        time_val = str(item.get("time") or seg.get("time") or "00:00:00").strip()
        en_example = str(item.get("en_example") or item.get("example") or seg.get("text") or word).strip()
        zh_example = str(item.get("zh_example") or en_example).strip()
        ja_example = str(item.get("ja_example") or "").strip()

        out.append({
            "time": time_val,
            "word": word,
            "ipa": str(item.get("ipa") or item.get("phonetic") or item.get("pronunciation") or "").strip(),
            "kk": str(item.get("kk") or item.get("kk_phonetic") or "").strip(),
            "pos": str(item.get("pos") or ("phrase" if " " in word else "noun")).strip(),
            "zh": str(item.get("zh") or word).strip(),
            "en": str(item.get("en") or item.get("definition") or f"A key word or phrase from the video: {word}.").strip(),
            "en_example": en_example,
            "zh_example": zh_example,
            # ja / ja_example 永遠保留 GPT 產生的真正日文，不從 local/en 回填。
            "ja": str(item.get("ja") or "").strip(),
            "local": str(item.get("local") or item.get(bw_local_lang()) or word).strip(),
            bw_local_lang(): str(item.get(bw_local_lang()) or item.get("local") or word).strip(),
            "local_lang": bw_local_lang(),
            "local_label": bw_local_label(),
            "kana": str(item.get("kana") or item.get("furigana") or item.get("yomi") or "").strip(),
            "local_pron": (
                "" if bw_local_lang() == "en"
                else str(item.get("local_pron") or item.get(f"{bw_local_lang()}_pron") or item.get("romaji") or item.get("kana") or "").strip()
            ),
            "romaji": str(item.get("romaji") or item.get("roma") or "").strip(),
            "ja_example": ja_example,
            "local_example": str(item.get("local_example") or item.get(f"{bw_local_lang()}_example") or en_example).strip(),
            f"{bw_local_lang()}_example": str(item.get(f"{bw_local_lang()}_example") or item.get("local_example") or en_example).strip(),
        })

    return out if out else fallback_vocab(segments)


def _bw_vocab_text_is_bad_zh_ja(ja_text: str, zh_text: str = "", local_text: str = "") -> bool:
    """中文歌 vocab 防呆：ja 不可空白、不可照抄中文/local、不可是拼音。"""
    ja_s = str(ja_text or "").strip()
    zh_s = str(zh_text or "").strip()
    local_s = str(local_text or "").strip()
    if not ja_s:
        return True
    if zh_s and ja_s == zh_s:
        return True
    if local_s and ja_s == local_s:
        return True
    # 明顯全是拉丁拼音，不能當日文。
    if re.fullmatch(r"[A-Za-z\s\-']+", ja_s) and not re.search(r"[\u3040-\u30FF\u3400-\u9FFF]", ja_s):
        return True
    return False


def repair_zh_music_vocab_with_openai(api_key: str, obj: Any, slug: str = "") -> Any:
    """
    V47 中文歌 vocab 日文欄修正：
    local_lang=zh 時，舊流程會把 ja/local 都蓋成中文，導致 player 的「日文」按鈕讀中文或拼音。
    這裡只補 vocab 的 ja / ja_example，保留 zh/local 中文欄位。
    """
    if bw_local_lang() not in ("zh", "zh-tw", "zh-cn", "cn"):
        return obj
    if not isinstance(obj, list) or not obj:
        return obj

    rows = []
    for i, d in enumerate(obj):
        if not isinstance(d, dict):
            continue
        zh = str(d.get("zh") or "").strip()
        local = str(d.get("local") or "").strip()
        ja = str(d.get("ja") or "").strip()
        zh_ex = str(d.get("zh_example") or "").strip()
        local_ex = str(d.get("local_example") or "").strip()
        ja_ex = str(d.get("ja_example") or "").strip()
        if _bw_vocab_text_is_bad_zh_ja(ja, zh, local) or _bw_vocab_text_is_bad_zh_ja(ja_ex, zh_ex, local_ex):
            rows.append({
                "idx": i,
                "word": str(d.get("word") or "").strip(),
                "en": str(d.get("en") or "").strip(),
                "zh": zh,
                "en_example": str(d.get("en_example") or "").strip(),
                "zh_example": zh_ex,
            })

    if not rows:
        return obj

    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你只會輸出 JSON。請把中文歌 vocab 的中文解釋與中文例句改寫成自然日文。"
                    "輸出必須是 JSON 陣列，每筆只包含 idx, ja, ja_example。"
                    "ja 是日文解釋；ja_example 是自然日文例句。"
                    "不可照抄中文，不可輸出拼音，不可空白。"
                ),
            },
            {"role": "user", "content": json.dumps(rows, ensure_ascii=False)},
        ],
        "temperature": 0.1,
    }

    try:
        raw = openai_chat(api_key, payload)
        fixed = json.loads(raw)
        if isinstance(fixed, dict) and isinstance(fixed.get("items"), list):
            fixed = fixed["items"]
        if not isinstance(fixed, list):
            raise RuntimeError("OpenAI 補 vocab ja 回傳不是陣列")
        by_idx = {}
        for item in fixed:
            if not isinstance(item, dict):
                continue
            try:
                by_idx[int(str(item.get("idx")))] = item
            except Exception:
                continue
        for i, d in enumerate(obj):
            if not isinstance(d, dict):
                continue
            item = by_idx.get(i)
            if not item:
                continue
            ja = str(item.get("ja") or "").strip()
            ja_ex = str(item.get("ja_example") or "").strip()
            if ja and not _bw_vocab_text_is_bad_zh_ja(ja, d.get("zh"), d.get("local")):
                d["ja"] = ja
            if ja_ex and not _bw_vocab_text_is_bad_zh_ja(ja_ex, d.get("zh_example"), d.get("local_example")):
                d["ja_example"] = ja_ex
            # 中文歌的日文欄不使用拼音朗讀；player 會用 ja-JP 讀 ja/ja_example。
            d["kana"] = str(d.get("kana") or "").strip()
            d["romaji"] = str(d.get("romaji") or "").strip()
        print(f"[V47 ZH MUSIC VOCAB REPAIR] 已補中文歌 vocab 日文欄：{len(rows)} 筆")
    except Exception as e:
        print(f"[V47 ZH MUSIC VOCAB REPAIR] 補 vocab 日文欄失敗，交由檢查停止：{e}")
    return obj


def validate_zh_music_vocab_schema(obj: Any, slug: str = "") -> None:
    if bw_local_lang() not in ("zh", "zh-tw", "zh-cn", "cn"):
        return
    if not isinstance(obj, list):
        raise RuntimeError("中文歌 vocab 檢查失敗：vocab 不是陣列")
    bad = []
    for i, d in enumerate(obj, start=1):
        if not isinstance(d, dict):
            bad.append(f"#{i} 不是物件")
            continue
        if _bw_vocab_text_is_bad_zh_ja(d.get("ja"), d.get("zh"), d.get("local")):
            bad.append(f"#{i} ja 不可空白/照抄中文/拼音")
        if _bw_vocab_text_is_bad_zh_ja(d.get("ja_example"), d.get("zh_example"), d.get("local_example")):
            bad.append(f"#{i} ja_example 不可空白/照抄中文/拼音")
    if bad:
        raise RuntimeError("中文歌 vocab 檢查失敗：" + (f"slug={slug} " if slug else "") + "；".join(bad[:12]))


def normalize_quiz_payload(obj: Any) -> List[Dict[str, Any]]:
    arr = obj if isinstance(obj, list) else []
    sections = ["單字", "文法", "閱讀", "綜合"]
    buckets: Dict[str, List[Dict[str, Any]]] = {k: [] for k in sections}

    def map_section(raw: Any, question: str = "") -> str:
        s = str(raw or "").strip().lower()
        q = str(question or "").strip().lower()
        if s in ("單字", "文法", "閱讀", "綜合"):
            return str(raw).strip()
        if any(k in s for k in ("vocab", "word", "單字", "字彙", "片語")):
            return "單字"
        if any(k in s for k in ("grammar", "文法", "時態", "句型", "語法")):
            return "文法"
        if any(k in s for k in ("reading", "閱讀", "理解內容", "細節理解", "細節", "主旨")):
            return "閱讀"
        if any(k in s for k in ("mix", "綜合", "延伸", "口說", "推論", "應用")):
            return "綜合"
        if any(k in q for k in ("what does", "mean in", "meaning of", "word", "vocabulary")):
            return "單字"
        if any(k in q for k in ("grammar", "tense", "preposition", "pronoun", "verb form", "word order", "correct sentence")):
            return "文法"
        if any(k in q for k in ("what happened", "why", "who", "where", "when", "main idea")):
            return "閱讀"
        return "綜合"

    def answer_letter(value: Any) -> str:
        if isinstance(value, int):
            return ["A", "B", "C", "D"][max(0, min(3, value))]
        s = str(value or "A").strip().upper()
        if s in ("1", "2", "3", "4"):
            return ["A", "B", "C", "D"][int(s) - 1]
        return s if s in ("A", "B", "C", "D") else "A"

    for item in arr:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or item.get("q") or "").strip()
        sec = map_section(item.get("section") or item.get("category") or item.get("type"), question)

        options = item.get("options") or item.get("choices") or []
        if not isinstance(options, list):
            options = []
        options = [
            str(x.get("text") or x.get("label") or "") if isinstance(x, dict) else str(x or "")
            for x in options[:4]
        ]
        options = [x.strip() for x in options]
        while len(options) < 4:
            options.append("")

        options_zh = item.get("options_zh") or item.get("choices_zh") or []
        if not isinstance(options_zh, list):
            options_zh = []
        options_zh = [
            str(x.get("text") or x.get("zh") or x.get("label") or "") if isinstance(x, dict) else str(x or "")
            for x in options_zh[:4]
        ]
        options_zh = [x.strip() for x in options_zh]
        while len(options_zh) < 4:
            options_zh.append("")

        ans = answer_letter(item.get("answer"))
        ans_idx = {"A": 0, "B": 1, "C": 2, "D": 3}.get(ans, 0)
        explanation = item.get("explanation")
        if isinstance(explanation, dict):
            explanation_zh = str(explanation.get("zh") or "").strip()
        else:
            explanation_zh = str(item.get("explanation_zh") or explanation or "").strip()

        norm = {
            "section": sec,
            "type": "single",
            "question": question,
            "question_zh": str(item.get("question_zh") or item.get("q_zh") or "").strip(),
            "options": options,
            "options_zh": options_zh,
            "answer": ans,
            "answer_en": str(item.get("answer_en") or options[ans_idx] or "").strip(),
            "answer_zh": str(item.get("answer_zh") or options_zh[ans_idx] or "").strip(),
            "answer_ja": str(item.get("answer_ja") or "").strip(),
            "answer_local": str(item.get("answer_local") or item.get(f"answer_{bw_local_lang()}") or "").strip(),
            f"answer_{bw_local_lang()}": str(item.get(f"answer_{bw_local_lang()}") or item.get("answer_local") or "").strip(),
            "local_lang": bw_local_lang(),
            "local_label": bw_local_label(),
            "explanation_zh": explanation_zh,
        }
        buckets[sec].append(norm)

    out: List[Dict[str, Any]] = []
    for sec in sections:
        items = buckets[sec][:10]
        while len(items) < 10:
            n = len(items) + 1
            items.append({
                "section": sec,
                "type": "single",
                "question": f"{sec}題目產生失敗（第 {n} 題）",
                "question_zh": f"{sec}題目產生失敗，請重新產生教材。",
                "options": ["A", "B", "C", "D"],
                "options_zh": ["A", "B", "C", "D"],
                "answer": "A",
                "answer_en": "A",
                "answer_zh": "A",
                "answer_ja": "A",
                "answer_local": "A",
                f"answer_{bw_local_lang()}": "A",
                "local_lang": bw_local_lang(),
                "local_label": bw_local_label(),
                "explanation_zh": "此題為保護性佔位，請重新產生題庫。",
            })
        out.extend(items)
    return out


def fallback_index(slug: str, category: str, youtube_url: str, segments: List[Dict[str, str]]) -> Dict[str, Any]:
    youtube_id = extract_youtube_id(youtube_url)
    obj: Dict[str, Any] = {
        "title": slug.replace("-", " "),
        "category": category,
        "slug": slug,
        "video": f"{R2_PUBLIC_BASE}/videos/{category}/{slug}.mp4",
        "cover": f"{R2_PUBLIC_BASE}/assets/{category}/{slug}.jpg",
        "youtube_url": youtube_url,
        "youtube_id": youtube_id,
        "cues": {"zh": f"./cues-{slug}.json"},
        "vocab": f"./vocab-{slug}.json",
        "quiz": f"./quiz-{slug}.json",
        "ai": f"./ai-{slug}.json",
        "dialogue": f"./{slug}.dialogue.json",
        "speaking": f"./speaking-{slug}.json",
        "difficulty_level": 2,
        "is_public": True,
    }
    return enrich_index_metadata(obj, slug, category, youtube_url, segments)



def _bw_cues_array(obj: Any) -> List[Dict[str, Any]]:
    if isinstance(obj, list):
        return [x for x in obj if isinstance(x, dict)]
    if isinstance(obj, dict):
        for key in ("cues", "items", "segments", "data"):
            arr = obj.get(key)
            if isinstance(arr, list):
                return [x for x in arr if isinstance(x, dict)]
    return []


def _bw_last_time_sec_from_cues(obj: Any) -> int:
    items = _bw_cues_array(obj)
    last_sec = 0
    for item in items:
        sec = time_to_sec(str(item.get("time") or item.get("start") or item.get("at") or ""))
        if sec > last_sec:
            last_sec = sec
    return last_sec


def validate_cues_time_coverage(
    obj: Any,
    segments: List[Dict[str, str]],
    category: str,
    slug: str,
    work_dir: Optional[Path] = None,
) -> None:
    """
    全分類 cues 完整性保護：
    - GPT 可能輸出「合法 JSON，但只覆蓋影片前幾分鐘」。
    - 這種檔案 json.loads() 會成功，舊版就誤判為 OK 並上架。
    - 現在要求 cues 最後時間必須接近 SRT 最後時間。
    """
    items = _bw_cues_array(obj)
    if not items:
        raise RuntimeError("cues 完整性檢查失敗：cues 不是有效陣列或內容為空")

    usable_segments = [x for x in (segments or []) if str(x.get("text") or "").strip()]
    if not usable_segments:
        return

    expected_last = time_to_sec(str(usable_segments[-1].get("time") or ""))
    actual_last = _bw_last_time_sec_from_cues(items)

    # 很短影片不過度誤殺；長片必須嚴格防止半套 cues。
    if expected_last <= 120:
        allowed_gap = max(20, int(expected_last * 0.35))
    elif expected_last <= 600:
        allowed_gap = max(45, int(expected_last * 0.22))
    else:
        allowed_gap = min(CUES_MAX_ACCEPTED_TAIL_GAP_SEC, max(90, int(expected_last * 0.12)))

    # 額外保護：長片 cues 數量少到離譜，也視為截斷。
    expected_count = len(usable_segments)
    actual_count = len(items)
    count_too_small = expected_count >= 300 and actual_count < max(60, int(expected_count * 0.20))

    if actual_last + allowed_gap < expected_last or count_too_small:
        msg = (
            "cues 完整性檢查失敗：疑似只產出影片前段，禁止寫入 / 禁止續跑略過。\n"
            f"slug={slug}\n"
            f"category={category}\n"
            f"srt_lines={expected_count}\n"
            f"cues_lines={actual_count}\n"
            f"srt_last={expected_last}s\n"
            f"cues_last={actual_last}s\n"
            f"allowed_tail_gap={allowed_gap}s\n"
        )
        if work_dir is not None:
            try:
                write_error_file(work_dir, "cues_incomplete.txt", msg)
            except Exception:
                pass
        raise RuntimeError(msg)


def generate_cues_json_chunked(
    api_key: str,
    slug: str,
    category: str,
    segments: List[Dict[str, str]],
    youtube_url: str,
) -> List[Dict[str, Any]]:
    """
    長片 cues 分批生成。
    舊版一次把整支 SRT 丟給 GPT，86 分鐘片可能只回到 00:06:34。
    現在每批約 80 行字幕，逐批確認最後時間，再合併。
    """
    if base_category_of(category) == "music":
        # V39：music 尤其韓文/日文歌，單次丟太多行給 GPT 會只回前半首。
        # 改用較小批次，並逐批做 coverage 檢查。
        chunk_size = max(6, int(MUSIC_CUES_CHUNK_SIZE or 12))
    else:
        chunk_size = max(CUES_MIN_CHUNK_SIZE, int(CUES_CHUNK_SIZE or 80))
    merged: List[Dict[str, Any]] = []
    total = len(segments or [])
    if total <= 0:
        return []

    total_chunks = (total + chunk_size - 1) // chunk_size
    for chunk_no, start in enumerate(range(0, total, chunk_size), start=1):
        chunk = segments[start:start + chunk_size]
        payload = build_chat_payload("cues", slug, category, chunk, youtube_url)
        text = openai_chat(api_key, payload)
        chunk_obj = json.loads(text)
        chunk_items = _bw_cues_array(chunk_obj)

        # 每一批都要完整覆蓋本批 SRT，避免單批合法 JSON 但截斷。
        validate_cues_time_coverage(chunk_items, chunk, category, f"{slug}#chunk{chunk_no}", None)

        for item in chunk_items:
            if isinstance(item, dict):
                item.pop("source_url", None)
                merged.append(item)

        print(f"[CUES CHUNK] {slug} {chunk_no}/{total_chunks} 完成：SRT {len(chunk)} 行 -> cues {len(chunk_items)} 行")

    if merged and youtube_url:
        merged[0]["source_url"] = youtube_url

    validate_cues_time_coverage(merged, segments, category, slug, None)
    return merged


def generate_gpt_json(api_key: str, kind: str, slug: str, category: str, segments: List[Dict[str, str]], youtube_url: str) -> Any:
    # V32：Music 梵音/冥想/咒語類，字幕不可靠時不要硬編英文歌詞。
    if kind == "cues" and category == "music" and bw_is_music_transcript_unreliable(segments, slug):
        obj = fallback_music_meditation_cues(segments, youtube_url)
        obj = bw_apply_native_roman_fields(obj, category)
        return obj

    # V30：長片 cues 不能一次整支丟 GPT，會產生「合法但截斷」JSON。
    # V39：music 短片也要小批次，避免 GPT 只回前半首（例如 srt 35 行但 cues 只到 166 秒）。
    use_chunked_cues = (
        kind == "cues"
        and (
            len(segments or []) > max(CUES_MIN_CHUNK_SIZE, CUES_CHUNK_SIZE)
            or (base_category_of(category) == "music" and len(segments or []) > max(8, int(MUSIC_CUES_CHUNK_SIZE or 12)))
        )
    )
    if use_chunked_cues:
        obj = generate_cues_json_chunked(api_key, slug, category, segments, youtube_url)
    else:
        payload = build_chat_payload(kind, slug, category, segments, youtube_url)
        text = openai_chat(api_key, payload)
        obj = json.loads(text)
        if kind == "cues" and youtube_url and isinstance(obj, list) and obj:
            if isinstance(obj[0], dict):
                obj[0]["source_url"] = youtube_url

    # V27 MUSIC 短句化：
    # small.en 能降低「整段吞成一坨」，但 GPT cues 仍可能把多句歌詞合併成 20~40 字。
    # 這裡在寫入前自動拆短，讓 PLAYER 的字幕列回到可讀的短句格式。
    if kind == "cues" and category == "music":
        # V44：Music cues 先短句化，再由 Production-Center local_lang 固定成三格式。
        # 英文歌=en/zh/ja；日文歌=native/kana/en/zh；中文歌=native/pinyin/en/ja；韓文與其他=native/roman/en/zh。
        obj = normalize_music_cues_for_player(obj)
        obj = normalize_music_cue_schema(obj)
        obj = repair_en_music_cues_with_openai(api_key, obj, slug)
        obj = repair_zh_music_cues_with_openai(api_key, obj, slug)
    if kind == "quiz":
        obj = normalize_quiz_payload(obj)
    if kind == "vocab":
        obj = normalize_vocab_payload(obj, segments)
        if base_category_of(category) == "music" and bw_local_lang() in ("zh", "zh-tw", "zh-cn", "cn"):
            obj = repair_zh_music_vocab_with_openai(api_key, obj, slug)
            validate_zh_music_vocab_schema(obj, slug)
    if kind in ("cues", "quiz", "vocab"):
        skip_local_patch = (kind == "cues" and category == "music") or (kind == "vocab" and base_category_of(category) == "music" and bw_local_lang() in ("zh", "zh-tw", "zh-cn", "cn"))
        if not skip_local_patch:
            obj = bw_apply_local_fields(obj)
    if kind == "cues":
        if category == "music":
            obj = normalize_music_cue_schema(obj)
            obj = repair_zh_music_cues_with_openai(api_key, obj, slug)
        else:
            obj = bw_apply_native_roman_fields(obj, category)
    if kind == "index" and isinstance(obj, dict):
        obj["local_lang"] = bw_local_lang()
        obj["local_label"] = bw_local_label()
        obj = enrich_index_metadata(obj, slug, category, youtube_url, segments)
    return obj


def ensure_json_safe(api_key: str, kind: str, slug: str, category: str, segments: List[Dict[str, str]], youtube_url: str, out_path: Path, work_dir: Path) -> None:
    if json_exists_ok(out_path):
        # V30：所有 cues 都必須檢查是否覆蓋完整 SRT。
        # 舊版只有 MUSIC 做品質檢查，MOVIE 截到 00:06:34 仍被當成 OK 略過。
        if kind == "cues":
            try:
                existing_obj = json.loads(out_path.read_text(encoding="utf-8", errors="ignore"))
                validate_cues_time_coverage(existing_obj, segments, category, slug, work_dir)
                if category == "music":
                    validate_music_cue_schema(existing_obj, slug)
                    validate_cues_json_quality(existing_obj, category, work_dir, slug)
                print(f"[續跑] 已有 {out_path.name}，cues 完整性 OK，略過")
                return
            except Exception as e:
                print(f"[V41 REBUILD BAD CUES] {out_path.name} cues 不完整或品質不合格，只重建 JSON，不動 mp4/srt/karaoke：{e}")
                if category == "music":
                    remove_music_json_dependents(work_dir, slug, str(e).splitlines()[0][:120])
                else:
                    try:
                        out_path.unlink()
                    except Exception:
                        pass
        else:
            print(f"[續跑] 已有 {out_path.name}，略過")
            return
    try:
        obj = generate_gpt_json(api_key, kind, slug, category, segments, youtube_url)
        if kind == "cues":
            validate_cues_time_coverage(obj, segments, category, slug, work_dir)
            if category == "music":
                validate_cues_json_quality(obj, category, work_dir, slug)
        write_json(out_path, obj)
        if kind == "index" and isinstance(obj, dict):
            write_meta_json(work_dir, str(obj.get("slug") or slug), obj)
        print(f"完成：{out_path.name}")
        return
    except Exception as e:
        write_error_file(work_dir, f"{kind}.txt", str(e))
        # MUSIC cues 失敗時絕對不要寫 fallback，否則 zh/ja 會變英文或 Music/音樂。
        if kind == "cues" and category == "music":
            raise RuntimeError(f"MUSIC cues 產生失敗，已停止，不寫 fallback：{e}")
        print(f"[警告] {kind} 產生失敗，改寫 fallback：{e}")

    if kind == "cues":
        obj = fallback_cues(segments, youtube_url)
    elif kind == "quiz":
        obj = fallback_quiz(segments)
    elif kind == "vocab":
        obj = fallback_vocab(segments)
    elif kind == "ai":
        obj = fallback_ai(segments)
    elif kind == "index":
        obj = fallback_index(slug, category, youtube_url, segments)
    else:
        obj = []
    if kind != "ai":
        obj = bw_apply_local_fields(obj)
    if kind == "cues":
        obj = bw_apply_native_roman_fields(obj, category)
    write_json(out_path, obj)
    if kind == "index" and isinstance(obj, dict):
        write_meta_json(work_dir, str(obj.get("slug") or slug), obj)
    print(f"完成 fallback：{out_path.name}")



def sync_en_music_dialogue_ja_from_cues(dialogue_obj: Any, work_dir: Path, slug: str) -> Tuple[Any, bool]:
    """
    V49：Talk 使用 <slug>.dialogue.json，不是 cues。
    英文歌 local_lang=en 時，dialogue 的 ja 常被舊相容流程覆蓋成英文。
    這裡從已修好的 cues-<slug>.json 把日文意思同步回 dialogue。
    """
    if bw_local_lang() != "en" or not isinstance(dialogue_obj, dict):
        return dialogue_obj, False

    arr = dialogue_obj.get("dialogue")
    if not isinstance(arr, list):
        return dialogue_obj, False

    cues_path = work_dir / f"cues-{slug}.json"
    if not cues_path.exists():
        return dialogue_obj, False

    try:
        cues_obj = json.loads(cues_path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return dialogue_obj, False

    cues_arr = cues_obj if isinstance(cues_obj, list) else (cues_obj.get("cues") if isinstance(cues_obj, dict) else [])
    if not isinstance(cues_arr, list):
        return dialogue_obj, False

    by_time: Dict[str, str] = {}
    by_en: Dict[str, str] = {}
    for c in cues_arr:
        if not isinstance(c, dict):
            continue
        ja = str(c.get("ja") or "").strip()
        en = str(c.get("en") or c.get("native") or "").strip()
        if not ja or not en:
            continue
        ja_raw = re.sub(r"\s+", "", ja).lower()
        en_raw = re.sub(r"\s+", "", en).lower()
        if ja_raw == en_raw:
            continue
        t = str(c.get("time") or "").strip()
        if t:
            by_time[t] = ja
        by_en[re.sub(r"\s+", "", en).lower()] = ja

    changed = False
    for d in arr:
        if not isinstance(d, dict):
            continue
        en = str(d.get("en") or d.get("text") or d.get("local") or "").strip()
        ja = str(d.get("ja") or "").strip()
        ja_raw = re.sub(r"\s+", "", ja).lower()
        en_raw = re.sub(r"\s+", "", en).lower()
        if ja and ja_raw != en_raw:
            continue

        t = str(d.get("time") or "").strip()
        fixed = by_time.get(t) or by_en.get(en_raw)
        if fixed:
            d["ja"] = fixed
            changed = True

    if changed:
        dialogue_obj["local_lang"] = "en"
        dialogue_obj["local_label"] = "英文"
    return dialogue_obj, changed


def ensure_dialogue_and_speaking(api_key: str, slug: str, category: str, youtube_source_for_json: str, segments: List[Dict[str, str]], work_dir: Path) -> None:
    dialogue_path = work_dir / f"{slug}.dialogue.json"
    if json_exists_ok(dialogue_path):
        try:
            old_dialogue = json.loads(dialogue_path.read_text(encoding="utf-8", errors="ignore"))
            fixed_dialogue, changed = sync_en_music_dialogue_ja_from_cues(old_dialogue, work_dir, slug)
            if changed:
                write_json(dialogue_path, fixed_dialogue)
                print(f"[V49 DIALOGUE JA FIX] 已修正 {dialogue_path.name}")
            else:
                print(f"[續跑] 已有 {dialogue_path.name}，略過")
        except Exception:
            print(f"[續跑] 已有 {dialogue_path.name}，略過")
    else:
        try:
            dialogue = json.loads(openai_chat(api_key, build_dialogue_payload(slug, category, youtube_source_for_json, segments)))
            dialogue = bw_apply_local_fields(dialogue)
            dialogue, changed = sync_en_music_dialogue_ja_from_cues(dialogue, work_dir, slug)
            write_json(dialogue_path, dialogue)
            print(f"完成：{dialogue_path.name}" + ("（已同步日文）" if changed else ""))
        except Exception as e:
            write_error_file(work_dir, "dialogue.txt", str(e))
            fallback = {
                "meta": {"slug": slug, "category": category, "source_url": youtube_source_for_json, "mode": "srt"},
                "dialogue": [
                    {"role": "teacher", "text": s["text"], "zh": s["text"], "ja": s["text"], "time": s["time"]}
                    for s in segments if s["text"].strip()
                ],
            }
            fallback = bw_apply_local_fields(fallback)
            fallback, changed = sync_en_music_dialogue_ja_from_cues(fallback, work_dir, slug)
            write_json(dialogue_path, fallback)
            print(f"完成 fallback：{dialogue_path.name}" + ("（已同步日文）" if changed else ""))

    speaking_path = work_dir / f"speaking-{slug}.json"
    if json_exists_ok(speaking_path):
        print(f"[續跑] 已有 {speaking_path.name}，略過")
    else:
        speaking = build_speaking_json_from_srt(slug, category, youtube_source_for_json, segments)
        write_json(speaking_path, speaking)
        print(f"完成：{speaking_path.name}")



def demucs_device_arg() -> str:
    """自動判斷 Demucs 使用 GPU 或 CPU。"""
    forced = os.environ.get("BOOKWIDE_DEMUCS_DEVICE", "").strip().lower()
    if forced in ("cuda", "cpu", "mps"):
        return forced
    return "cuda" if has_nvidia_gpu() else "cpu"


def find_demucs_no_vocals(demucs_root: Path, stem: str) -> Optional[Path]:
    """尋找 demucs 產出的 no_vocals.wav / instrumental.wav。"""
    candidates = [
        demucs_root / DEMUCS_MODEL / stem / "no_vocals.wav",
        demucs_root / DEMUCS_MODEL / stem / "instrumental.wav",
        demucs_root / "htdemucs" / stem / "no_vocals.wav",
        demucs_root / "htdemucs" / stem / "instrumental.wav",
    ]
    for c in candidates:
        if c.exists() and c.stat().st_size > 100_000:
            return c
    hits = list(demucs_root.glob(f"**/{stem}/no_vocals.wav")) + list(demucs_root.glob(f"**/{stem}/instrumental.wav"))
    for c in hits:
        if c.exists() and c.stat().st_size > 100_000:
            return c
    return None


def find_demucs_vocals(demucs_root: Path, stem: str) -> Optional[Path]:
    """尋找 demucs 產出的 vocals.wav。"""
    candidates = [
        demucs_root / DEMUCS_MODEL / stem / "vocals.wav",
        demucs_root / "htdemucs" / stem / "vocals.wav",
    ]
    for c in candidates:
        if c.exists() and c.stat().st_size > 100_000:
            return c
    hits = list(demucs_root.glob(f"**/{stem}/vocals.wav"))
    for c in hits:
        if c.exists() and c.stat().st_size > 100_000:
            return c
    return None


def make_true_ktv_mp3_tracks(work_dir: Path, inst_wav: Path, vocal_wav: Optional[Path]) -> None:
    """真 KTV 用：輸出 audio/no_vocals.mp3 + audio/vocals.mp3，供 player 兩音軌混音。"""
    audio_dir = work_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    no_vocals_mp3 = audio_dir / "no_vocals.mp3"
    vocals_mp3 = audio_dir / "vocals.mp3"

    if inst_wav and inst_wav.exists() and not exists_ok(no_vocals_mp3, 100_000):
        print("[TRUE-KTV] 轉伴奏 MP3：", no_vocals_mp3)
        run_cmd([
            "ffmpeg", "-y",
            "-i", str(inst_wav),
            "-vn",
            "-c:a", "libmp3lame",
            "-b:a", "96k",
            str(no_vocals_mp3),
        ])

    if vocal_wav and vocal_wav.exists() and not exists_ok(vocals_mp3, 100_000):
        print("[TRUE-KTV] 轉人聲 MP3：", vocals_mp3)
        run_cmd([
            "ffmpeg", "-y",
            "-i", str(vocal_wav),
            "-vn",
            "-c:a", "libmp3lame",
            "-b:a", "96k",
            str(vocals_mp3),
        ])


def make_music_karaoke_version(video_path: Path, work_dir: Path, slug: str) -> Optional[Path]:
    """
    MUSIC 專用：用同一支 mp4 的音軌分離出伴奏，合成 <slug>_karaoke.mp4。
    這樣原唱 / 伴奏時間軸一致，右側 KTV 字幕與 Talk 不必重做。
    """
    if not ENABLE_MUSIC_KARAOKE:
        print("[KTV] 已關閉 BOOKWIDE_ENABLE_MUSIC_KARAOKE=0")
        return None

    if not video_path.exists() or video_path.stat().st_size < 100_000:
        print("[KTV] 原始 mp4 不存在或太小，略過：", video_path)
        return None

    karaoke_mp4 = work_dir / f"{slug}_karaoke.mp4"
    true_ktv_audio_dir = work_dir / "audio"
    true_ktv_no_vocals = true_ktv_audio_dir / "no_vocals.mp3"
    true_ktv_vocals = true_ktv_audio_dir / "vocals.mp3"
    if karaoke_mp4.exists() and karaoke_mp4.stat().st_size > 100_000 and exists_ok(true_ktv_no_vocals, 100_000) and exists_ok(true_ktv_vocals, 100_000):
        print("[KTV] 已有伴奏版與真KTV MP3，略過：", karaoke_mp4)
        return karaoke_mp4

    if not command_exists("demucs"):
        print("[KTV] 找不到 demucs，略過伴奏版。安裝：pip install demucs")
        return None

    demucs_root = work_dir / "_demucs"
    if demucs_root.exists() and not KEEP_DEMUCS_WORKDIR:
        try:
            shutil.rmtree(demucs_root)
        except Exception:
            pass
    demucs_root.mkdir(parents=True, exist_ok=True)

    device = demucs_device_arg()
    print(f"[KTV] 開始分離伴奏：{video_path.name}  device={device}  model={DEMUCS_MODEL}")

    cmd = [
        "demucs",
        "--two-stems", "vocals",
        "-n", DEMUCS_MODEL,
        "--device", device,
        "-o", str(demucs_root),
        str(video_path),
    ]
    p = run_cmd(cmd, check=False)
    if p.returncode != 0 and device == "cuda":
        print("[KTV] GPU 分離失敗，改用 CPU 重試")
        cmd_cpu = [
            "demucs",
            "--two-stems", "vocals",
            "-n", DEMUCS_MODEL,
            "--device", "cpu",
            "-o", str(demucs_root),
            str(video_path),
        ]
        run_cmd(cmd_cpu, check=True)
    elif p.returncode != 0:
        raise RuntimeError("demucs 分離失敗")

    inst_wav = find_demucs_no_vocals(demucs_root, video_path.stem)
    if not inst_wav:
        raise RuntimeError(f"找不到 demucs 伴奏音軌：{demucs_root}")
    vocal_wav = find_demucs_vocals(demucs_root, video_path.stem)
    make_true_ktv_mp3_tracks(work_dir, inst_wav, vocal_wav)

    tmp_out = work_dir / f"{slug}_karaoke.tmp.mp4"
    if tmp_out.exists():
        tmp_out.unlink()

    print("[KTV] 合成伴奏版 MP4：", karaoke_mp4)
    run_cmd([
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(inst_wav),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", AUDIO_BITRATE,
        "-shortest",
        "-movflags", "+faststart",
        str(tmp_out),
    ])

    if not exists_ok(tmp_out, 100_000):
        raise RuntimeError("KTV 伴奏版 MP4 產生失敗")

    if karaoke_mp4.exists():
        karaoke_mp4.unlink()
    tmp_out.rename(karaoke_mp4)

    if not KEEP_DEMUCS_WORKDIR:
        try:
            shutil.rmtree(demucs_root)
        except Exception:
            pass

    print("[KTV] 完成伴奏版：", karaoke_mp4)
    return karaoke_mp4


def parse_guide_time_to_seconds(value: Any) -> float:
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    s = str(value or "").strip().replace(",", ".")
    if not s:
        return 0.0
    if ":" not in s:
        try:
            return max(0.0, float(s))
        except Exception:
            return 0.0
    try:
        nums = [float(x) for x in s.split(":")]
        if len(nums) == 3:
            return nums[0] * 3600 + nums[1] * 60 + nums[2]
        if len(nums) == 2:
            return nums[0] * 60 + nums[1]
    except Exception:
        pass
    return 0.0


def load_music_cues_for_guide(work_dir: Path, slug: str) -> List[Dict[str, Any]]:
    candidates = [work_dir / f"cues-{slug}.json"] + sorted(work_dir.glob("cues-*.json"))
    for p in candidates:
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
            if isinstance(data, list):
                return [x for x in data if isinstance(x, dict)]
            if isinstance(data, dict):
                for key in ("items", "cues", "segments", "data"):
                    arr = data.get(key)
                    if isinstance(arr, list):
                        return [x for x in arr if isinstance(x, dict)]
        except Exception as e:
            print(f"[GUIDE] cues 讀取失敗：{p.name} -> {e}")
    return []


def normalize_music_guide_lines(cues: List[Dict[str, Any]], lang: str, total_duration: float) -> List[Tuple[float, str]]:
    keys = ["zh", "zh_tw", "zh-TW", "chinese"] if lang == "zh" else ["ja", "jp", "japanese"]
    out: List[Tuple[float, str]] = []
    for item in cues:
        text = ""
        for k in keys:
            if item.get(k):
                text = str(item.get(k) or "").strip()
                break
        if not text:
            continue
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        t = parse_guide_time_to_seconds(item.get("start") or item.get("t0") or item.get("time") or item.get("at"))
        if total_duration > 0 and t > total_duration + 3:
            continue
        out.append((t, text))
    out.sort(key=lambda x: x[0])
    if MUSIC_GUIDE_MAX_LINES > 0:
        out = out[:MUSIC_GUIDE_MAX_LINES]
    return out


def edge_tts_available() -> bool:
    if command_exists("edge-tts"):
        return True
    p = subprocess.run([sys.executable, "-m", "edge_tts", "--help"], capture_output=True, text=True, encoding="utf-8", errors="ignore")
    return p.returncode == 0


def run_edge_tts(text: str, voice: str, out_mp3: Path) -> None:
    if command_exists("edge-tts"):
        run_cmd(["edge-tts", "--voice", voice, "--text", text, "--write-media", str(out_mp3)], check=True)
    else:
        run_cmd([sys.executable, "-m", "edge_tts", "--voice", voice, "--text", text, "--write-media", str(out_mp3)], check=True)




def _bw_text_for_music_mp3_line(cue: Dict[str, Any], seg: Optional[Dict[str, str]], lang: str) -> str:
    """取每句要輸出的 MP3 文字。en 用原英文；zh/ja 優先用 cues 翻譯。"""
    if lang == "en":
        return str(cue.get("en") or (seg or {}).get("text") or "").strip()
    keys = ["zh", "zh_tw", "zh-TW", "chinese"] if lang == "zh" else ["ja", "jp", "japanese"]
    for k in keys:
        v = str(cue.get(k) or "").strip()
        if v:
            return v
    return ""


def _bw_audio_rel(path: Path, work_dir: Path) -> str:
    try:
        return "./" + path.relative_to(work_dir).as_posix()
    except Exception:
        return path.as_posix()


def has_valid_music_line_mp3_pack(work_dir: Path, slug: str) -> bool:
    manifest = work_dir / f"music-audio-{slug}.json"
    if not json_exists_ok(manifest):
        return False
    try:
        obj = json.loads(manifest.read_text(encoding="utf-8", errors="ignore"))
        langs = obj.get("langs") if isinstance(obj, dict) else []
        items = obj.get("items") if isinstance(obj, dict) else []
        return bool(langs and isinstance(items, list) and items)
    except Exception:
        return False


def generate_music_line_mp3_pack(work_dir: Path, slug: str, segments: List[Dict[str, str]]) -> Optional[Path]:
    """
    MUSIC MP3 完整包：逐句產生 en/zh(/ja) MP3，並寫 manifest。
    注意：這是取代 _zh.mp4 / _ja.mp4 的輕量方案；player 可直接播放每句 mp3。
    """
    if not ENABLE_MUSIC_LINE_MP3:
        print("[MP3] 已關閉 BOOKWIDE_ENABLE_MUSIC_LINE_MP3=0")
        return None
    if not MUSIC_LINE_MP3_LANGS:
        print("[MP3] BOOKWIDE_MUSIC_MP3_LANGS 空白，略過")
        return None
    if not edge_tts_available():
        raise RuntimeError("找不到 edge-tts，請先執行：pip install edge-tts")

    cues = load_music_cues_for_guide(work_dir, slug)
    if not cues:
        print("[MP3] 找不到 cues，改用 SRT 英文產生 en；zh/ja 會略過")
        cues = [{"time": s.get("time", "00:00:00"), "en": s.get("text", "")} for s in segments]

    max_lines = MUSIC_GUIDE_MAX_LINES if MUSIC_GUIDE_MAX_LINES > 0 else len(cues)
    total = min(len(cues), len(segments) if segments else len(cues), max_lines)
    if total <= 0:
        print("[MP3] 沒有可產生的句子")
        return None

    print(f"[MP3] {slug}: 產生逐句 MP3 langs={','.join(MUSIC_LINE_MP3_LANGS)} lines={total}")
    items: List[Dict[str, Any]] = []
    ok_count = 0

    for i in range(total):
        cue = cues[i] if i < len(cues) and isinstance(cues[i], dict) else {}
        seg = segments[i] if i < len(segments) else None
        time_text = str(cue.get("time") or (seg or {}).get("time") or "00:00:00")
        item: Dict[str, Any] = {
            "i": i,
            "time": time_text,
            "t": parse_guide_time_to_seconds(time_text),
            "text": {
                "en": str(cue.get("en") or (seg or {}).get("text") or "").strip(),
                "zh": str(cue.get("zh") or "").strip(),
                "ja": str(cue.get("ja") or "").strip(),
            },
            "audio": {},
        }

        for lang in MUSIC_LINE_MP3_LANGS:
            text = _bw_text_for_music_mp3_line(cue, seg, lang)
            if not text:
                continue
            audio_dir = work_dir / "audio" / lang
            audio_dir.mkdir(parents=True, exist_ok=True)
            out_mp3 = audio_dir / f"{i:04d}.mp3"
            if not exists_ok(out_mp3, MIN_MUSIC_LINE_MP3_BYTES):
                try:
                    run_edge_tts(text[:260], MUSIC_LINE_MP3_VOICES[lang], out_mp3)
                except Exception as e:
                    print(f"[MP3-WARN] {lang} 第 {i} 句失敗：{e}")
                    try:
                        write_error_file(work_dir, f"music_mp3_{lang}_{i:04d}.txt", str(e))
                    except Exception:
                        pass
                    continue
            if exists_ok(out_mp3, MIN_MUSIC_LINE_MP3_BYTES):
                item["audio"][lang] = _bw_audio_rel(out_mp3, work_dir)
                ok_count += 1
        items.append(item)

    manifest = work_dir / f"music-audio-{slug}.json"
    payload = {
        "slug": slug,
        "type": "music_line_mp3",
        "langs": MUSIC_LINE_MP3_LANGS,
        "voice": {k: MUSIC_LINE_MP3_VOICES.get(k, "") for k in MUSIC_LINE_MP3_LANGS},
        "base": "./audio/",
        "items": items,
    }
    write_json(manifest, payload)
    print(f"[MP3] 完成：{manifest.name} files={ok_count}")
    return manifest


def patch_music_mp3_index_json(work_dir: Path, slug: str, category: str) -> None:
    manifest = work_dir / f"music-audio-{slug}.json"
    enabled = json_exists_ok(manifest)
    langs: List[str] = []
    try:
        if enabled:
            obj0 = json.loads(manifest.read_text(encoding="utf-8", errors="ignore"))
            if isinstance(obj0, dict) and isinstance(obj0.get("langs"), list):
                langs = [str(x) for x in obj0.get("langs") if str(x)]
    except Exception:
        pass

    # 目前 02 先準備本機/資料夾可用；若 05 之後支援上傳 audio，可用 public_base。
    public_base = f"{R2_PUBLIC_BASE}/audio/{category}/{slug}/" if enabled else ""
    for p in [work_dir / f"index-{slug}.json", work_dir / f"meta-{slug}.json"]:
        if not p.exists():
            continue
        try:
            obj = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
            if not isinstance(obj, dict):
                continue
            obj["music_mp3"] = {
                "enabled": enabled,
                "manifest": f"./music-audio-{slug}.json" if enabled else "",
                "base": "./audio/" if enabled else "",
                "public_base": public_base,
                "langs": langs,
                "mode": "line_mp3_no_browser_tts",
            }
            obj["has_music_mp3"] = enabled
            obj["music_mp3_manifest"] = f"./music-audio-{slug}.json" if enabled else ""
            write_json(p, obj)
            print(f"[MP3] 已更新 {p.name}: enabled={enabled} langs={','.join(langs)}")
        except Exception as e:
            print(f"[MP3] 更新 JSON 失敗：{p.name} -> {e}")

def make_music_tts_line_wav(text: str, voice: str, out_wav: Path, work: Path, idx: int) -> Optional[Path]:
    mp3 = work / f"line_{idx:04d}.mp3"
    if exists_ok(out_wav, 1000):
        return out_wav
    try:
        if not exists_ok(mp3, 1000):
            run_edge_tts(text, voice, mp3)
        run_cmd([
            "ffmpeg", "-y",
            "-i", str(mp3),
            "-af", f"volume={MUSIC_GUIDE_TTS_VOLUME}",
            "-ar", "44100",
            "-ac", "2",
            str(out_wav),
        ], check=True)
        return out_wav if exists_ok(out_wav, 1000) else None
    except Exception as e:
        print(f"[GUIDE-WARN] TTS 第 {idx} 句失敗: {e}")
        return None


def make_music_delayed_wav(line_wav: Path, delay_ms: int, total_duration: float, out_wav: Path) -> Optional[Path]:
    if exists_ok(out_wav, 1000):
        return out_wav
    try:
        run_cmd([
            "ffmpeg", "-y",
            "-i", str(line_wav),
            "-af", f"adelay={delay_ms}|{delay_ms},apad,atrim=0:{max(1,total_duration):.3f}",
            "-ar", "44100",
            "-ac", "2",
            str(out_wav),
        ], check=True)
        return out_wav if exists_ok(out_wav, 1000) else None
    except Exception as e:
        print(f"[GUIDE-WARN] delay wav 失敗: {e}")
        return None


def mix_music_wavs(inputs: List[Path], out_wav: Path) -> Optional[Path]:
    if exists_ok(out_wav, 1000):
        return out_wav
    if not inputs:
        return None
    cmd: List[Any] = ["ffmpeg", "-y"]
    for p in inputs:
        cmd += ["-i", str(p)]
    cmd += [
        "-filter_complex", f"amix=inputs={len(inputs)}:duration=longest:normalize=0[a]",
        "-map", "[a]",
        "-ar", "44100",
        "-ac", "2",
        str(out_wav),
    ]
    try:
        run_cmd(cmd, check=True)
        return out_wav if exists_ok(out_wav, 1000) else None
    except Exception as e:
        print(f"[GUIDE-WARN] mix wav 失敗: {e}")
        return None


def build_music_guide_wav(work_dir: Path, slug: str, cues: List[Dict[str, Any]], lang: str, voice: str, total_duration: float) -> Optional[Path]:
    lines = normalize_music_guide_lines(cues, lang, total_duration)
    if not lines:
        print(f"[GUIDE-SKIP] {slug} 沒有 {lang} 字幕可導唱")
        return None
    if not edge_tts_available():
        raise RuntimeError("找不到 edge-tts，請先執行：pip install edge-tts")

    work = work_dir / "_tts_work" / lang
    work.mkdir(parents=True, exist_ok=True)
    print(f"[GUIDE] {slug} {lang}: 產生 TTS 導唱，共 {len(lines)} 句")

    delayed: List[Path] = []
    for idx, (sec, text) in enumerate(lines, start=1):
        safe_text = text[:260]
        line_wav = work / f"line_{idx:04d}.wav"
        made = make_music_tts_line_wav(safe_text, voice, line_wav, work, idx)
        if not made:
            continue
        delayed_wav = work / f"delay_{idx:04d}.wav"
        delay_ms = max(0, int(sec * 1000))
        made_delay = make_music_delayed_wav(made, delay_ms, total_duration, delayed_wav)
        if made_delay:
            delayed.append(made_delay)

    if not delayed:
        print(f"[GUIDE-SKIP] {slug} {lang}: 沒有成功的 TTS 句子")
        return None

    chunks: List[Path] = []
    step = 18
    for start in range(0, len(delayed), step):
        chunk_inputs = delayed[start:start + step]
        chunk_out = work / f"chunk_{start//step+1:03d}.wav"
        m = mix_music_wavs(chunk_inputs, chunk_out)
        if m:
            chunks.append(m)

    guide_wav = work / f"{slug}_guide_{lang}.wav"
    if len(chunks) == 1:
        if not exists_ok(guide_wav, 1000):
            run_cmd(["ffmpeg", "-y", "-i", str(chunks[0]), str(guide_wav)], check=True)
    else:
        mix_music_wavs(chunks, guide_wav)

    if exists_ok(guide_wav, 1000):
        print(f"[GUIDE] {lang} 導唱 WAV 完成: {guide_wav.name}")
        return guide_wav
    return None


def make_music_guide_mp4(karaoke_mp4: Path, work_dir: Path, slug: str, lang: str, voice: str) -> Optional[Path]:
    # Cloudflare / player V7 使用：<slug>_zh.mp4 / <slug>_ja.mp4
    out_mp4 = work_dir / f"{slug}_{lang}.mp4"
    if exists_ok(out_mp4, MIN_MUSIC_GUIDE_BYTES):
        print(f"[GUIDE-SKIP] 已有導唱 {lang}: {out_mp4.name}")
        return out_mp4

    if not karaoke_mp4 or not karaoke_mp4.exists():
        print(f"[GUIDE-SKIP] 沒有 karaoke mp4，略過 {lang}")
        return None

    total_duration = get_duration_seconds(karaoke_mp4)
    if total_duration <= 0:
        print(f"[GUIDE-SKIP] 無法取得影片長度: {karaoke_mp4.name}")
        return None

    cues = load_music_cues_for_guide(work_dir, slug)
    if not cues:
        print(f"[GUIDE-SKIP] 無 cues，略過 {lang}: {slug}")
        return None

    guide_wav = build_music_guide_wav(work_dir, slug, cues, lang, voice, total_duration)
    if not guide_wav:
        return None

    tmp = work_dir / f"{slug}_{lang}.tmp.mp4"
    if tmp.exists():
        tmp.unlink()
    run_cmd([
        "ffmpeg", "-y",
        "-i", str(karaoke_mp4),
        "-i", str(guide_wav),
        "-filter_complex", "[0:a]volume=1.0[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0[a]",
        "-map", "0:v:0",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        str(tmp),
    ], check=True)

    if not exists_ok(tmp, MIN_MUSIC_GUIDE_BYTES):
        raise RuntimeError(f"導唱 MP4 輸出太小/失敗: {tmp}")
    if out_mp4.exists():
        out_mp4.unlink()
    tmp.rename(out_mp4)
    print(f"[GUIDE] 完成導唱 {lang}: {out_mp4.name}")
    return out_mp4


def make_music_guide_versions(karaoke_mp4: Optional[Path], work_dir: Path, slug: str) -> Dict[str, Optional[Path]]:
    results: Dict[str, Optional[Path]] = {"zh": None, "ja": None}
    if not ENABLE_MUSIC_GUIDE_TTS:
        print("[GUIDE] 已關閉 BOOKWIDE_ENABLE_MUSIC_GUIDE_TTS=0")
        return results
    if not karaoke_mp4 or not karaoke_mp4.exists():
        print("[GUIDE] 沒有 karaoke_mp4，略過中文/日文導唱")
        return results
    for lang, voice in (("zh", MUSIC_GUIDE_ZH_VOICE), ("ja", MUSIC_GUIDE_JA_VOICE)):
        try:
            results[lang] = make_music_guide_mp4(karaoke_mp4, work_dir, slug, lang, voice)
        except Exception as e:
            write_error_file(work_dir, f"karaoke_guide_{lang}.txt", str(e))
            print(f"[GUIDE失敗] {lang}: {e}")
            results[lang] = None
    return results


def patch_music_karaoke_index_json(work_dir: Path, slug: str, category: str, karaoke_path: Optional[Path]) -> None:
    """把 index/meta 補上伴奏 + 中文/日文導唱資訊，讓 player 可自動判斷。"""
    has_karaoke = bool(karaoke_path and karaoke_path.exists() and karaoke_path.stat().st_size > 100_000)
    has_zh = has_valid_music_guide_mp4(work_dir, slug, "zh")
    has_ja = has_valid_music_guide_mp4(work_dir, slug, "ja")
    karaoke_url = f"{R2_PUBLIC_BASE}/videos/{category}/{slug}_karaoke.mp4" if has_karaoke else ""
    zh_url = f"{R2_PUBLIC_BASE}/videos/{category}/{slug}_zh.mp4" if has_zh else ""
    ja_url = f"{R2_PUBLIC_BASE}/videos/{category}/{slug}_ja.mp4" if has_ja else ""

    for p in [work_dir / f"index-{slug}.json", work_dir / f"meta-{slug}.json"]:
        if not p.exists():
            continue
        try:
            obj = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
            if not isinstance(obj, dict):
                continue
            obj["has_karaoke"] = has_karaoke
            obj["karaoke_video"] = karaoke_url
            obj["karaoke_zh_video"] = zh_url
            obj["karaoke_ja_video"] = ja_url
            obj["has_karaoke_zh"] = has_zh
            obj["has_karaoke_ja"] = has_ja
            obj["karaoke"] = {
                "enabled": has_karaoke,
                "video": karaoke_url,
                "file": f"{slug}_karaoke.mp4" if has_karaoke else "",
                "method": "demucs_two_stems_vocals",
                "guide": {
                    "zh": {"enabled": has_zh, "video": zh_url, "file": f"{slug}_zh.mp4" if has_zh else ""},
                    "ja": {"enabled": has_ja, "video": ja_url, "file": f"{slug}_ja.mp4" if has_ja else ""},
                },
            }
            write_json(p, obj)
            print(f"[KTV] 已更新 {p.name}：karaoke={has_karaoke} zh={has_zh} ja={has_ja}")
        except Exception as e:
            print(f"[KTV] 更新 JSON 失敗：{p.name} -> {e}")

def maybe_delete_raw(path: Path) -> None:
    if DELETE_RAW_AFTER_SUCCESS and path.exists():
        try:
            path.unlink()
            print("已刪除 raw：", path)
        except Exception as e:
            print("[提醒] raw 刪除失敗：", e)


def ensure_git_repo(repo_dir: Path) -> None:
    if not repo_dir.exists():
        raise RuntimeError(f"Git repo 不存在：{repo_dir}")
    if not (repo_dir / ".git").exists():
        raise RuntimeError(f"這不是 Git repo：{repo_dir}")


def git_publish_many(repo_dir: Path, targets: List[Tuple[str, str]]) -> None:
    ensure_git_repo(repo_dir)
    if not targets:
        print("沒有任何成功產檔，略過 Git。")
        return
    print("\n[批次 Git] 準備上傳 ...")
    run_cmd(["git", "status", "--short"], cwd=repo_dir, check=False)
    for category, slug in targets:
        rel_file = Path("EduEnglish") / "data" / category / slug
        run_cmd(["git", "add", str(rel_file)], cwd=repo_dir)
    diff = run_cmd(["git", "diff", "--cached", "--name-only"], cwd=repo_dir, check=False)
    changed = [x.strip() for x in (diff.stdout or "").splitlines() if x.strip()]
    if not changed:
        print("沒有新的 Git 變更，略過 commit / push。")
        return
    commit_msg = f"batch add {len(targets)} items"
    run_cmd(["git", "commit", "-m", commit_msg], cwd=repo_dir)
    run_cmd(["git", "push"], cwd=repo_dir)
    print("Git push 完成。")



def classify_output_category(row: Dict[str, str], requested_category: str) -> str:
    requested = str(requested_category or "").strip().lower()
    if requested and requested != "auto":
        return requested

    slug = sanitize_name(str(row.get("slug") or ""))
    role = str(row.get("role") or "").strip().lower()
    domain = str(row.get("domain") or "").strip().lower()
    lesson = str(row.get("lesson") or "").strip().lower()
    title = str(row.get("title") or "").strip().lower()
    hay = f"{slug} {role} {domain} {lesson} {title}"

    pro_signals = [
        "teacher", "student", "classroom",
        "nurse", "doctor", "hospital", "clinic", "medical",
        "business", "meeting", "client",
        "engineer", "technical", "factory",
        "hotel", "restaurant", "service"
    ]
    if any(x in hay for x in pro_signals):
        return "pro"

    return "story"


def process_one_row(api_key: str, row: Dict[str, str], category: str, output_root: Path, whisper_model: str, force_redo: bool) -> Tuple[str, Path]:
    category = classify_output_category(row, category)
    preferred_slug = sanitize_name(str(row.get("slug") or "").strip())
    clean_url = clean_youtube_url(str(row.get("url") or "").strip())

    if not preferred_slug:
        raise RuntimeError("CSV 缺少 slug（已禁止 fallback）")
    if not clean_url or ("youtube.com" not in clean_url and "youtu.be" not in clean_url):
        raise RuntimeError(f"網址不正確：{clean_url or row}")

    youtube_id = extract_youtube_id(clean_url)
    if not youtube_id:
        raise RuntimeError(f"無法解析 YouTube ID：{clean_url}")

    title = get_video_title(clean_url)
    redo_mode = force_redo
    overwrite_mode = False

    existed = find_existing_by_youtube_id(output_root, category, youtube_id)
    if existed:
        existing_slug = existed.name
        existing_complete, existing_missing = lesson_completion_report(existed, existing_slug, category, youtube_id)

        if not existing_complete:
            # V29：同 YouTube ID 已存在，但教材檔不完整 = 上次失敗殘檔。
            # 不可 AUTO SKIP，直接續跑補齊，讓新版 02 能接手重生 JSON。
            print("\n[INCOMPLETE-RETRY]")
            print(f"youtube_id = {youtube_id}")
            print(f"found = {existed}")
            if category == "music":
                print("[V41 PATCH JSON ONLY] 舊 MUSIC 資料夾未完成：保留已成功檔案，只補缺檔/壞 JSON。")
            else:
                print("[INCOMPLETE-RETRY] 舊資料夾未完成，不視為正式重複，直接續跑補齊。")
            print("[INCOMPLETE-RETRY] 缺少 / 異常：" + ", ".join(existing_missing[:20]))
            slug = existing_slug
            work_dir = existed
            redo_mode = False
        else:
            action = ask_duplicate_action(existed, youtube_id, clean_url)
            if action == "skip":
                # MUSIC 補齊 KTV：舊教材已完整但還沒有 _karaoke.mp4 時，不要整筆跳過。
                # 這會保留既有 mp4 / srt / json，只補 demucs + karaoke。
                if category == "music" and ENABLE_MUSIC_KARAOKE and not has_valid_music_ktv_pack(existed, existing_slug):
                    print(f"[KTV補齊] 已存在完整教材但缺伴奏/中日導唱，繼續補：{existed}")
                    slug = existing_slug
                    work_dir = existed
                    redo_mode = False
                else:
                    if should_lock_public_title(category):
                        patch_public_title_files(existed, existing_slug, category, clean_url, title)
                    print(f"[SKIP] 重複 YouTube ID：{youtube_id}")
                    print(f"[SKIP] 已存在完整教材：{existed}")
                    return existing_slug, existed
            elif action == "redo":
                backup_dir = unique_backup_dir(existed)
                print(f"[BACKUP] {existed.name} -> {backup_dir.name}")
                shutil.move(str(existed), str(backup_dir))
                slug = preferred_slug
                work_dir = output_root / category / slug
                redo_mode = True
            else:
                print(f"[OVERWRITE] 直接覆蓋原資料夾：{existed}")
                slug = preferred_slug
                work_dir = output_root / category / slug
                redo_mode = True
                overwrite_mode = True
    else:
        slug = preferred_slug
        work_dir = output_root / category / slug

    remove_mismatched_jsons(work_dir, slug, youtube_id)
    existing_complete_now, existing_missing_now = lesson_completion_report(work_dir, slug, category, youtube_id)
    if existing_complete_now and not redo_mode:
        if category == "music" and ENABLE_MUSIC_KARAOKE and not has_valid_music_ktv_pack(work_dir, slug):
            print(f"[KTV補齊] 教材已完整，但缺 _karaoke/_zh/_ja；只補 KTV：{work_dir}")
        else:
            if should_lock_public_title(category):
                patch_public_title_files(work_dir, slug, category, clean_url, title)
            print(f"[SKIP] 已有完整教材：{work_dir}")
            return slug, work_dir
    elif work_dir.exists() and existing_missing_now and not redo_mode:
        if category == "music":
            print("[V41 PATCH JSON ONLY] 既有 MUSIC 資料夾尚未完整，保留 mp4/srt/karaoke，只補缺：" + ", ".join(existing_missing_now[:20]))
        else:
            print("[續跑] 既有資料夾尚未完整，將繼續補齊：" + ", ".join(existing_missing_now[:20]))

    work_dir.mkdir(parents=True, exist_ok=True)
    write_youtube_markers(work_dir, youtube_id, clean_url)
    if redo_mode and overwrite_mode:
        clear_old_outputs(work_dir)
        write_youtube_markers(work_dir, youtube_id, clean_url)

    raw_mp4 = work_dir / f"{slug}_raw.mp4"
    raw_audio_base = work_dir / f"{slug}_raw"
    final_mp4 = work_dir / f"{slug}.mp4"
    karaoke_mp4: Optional[Path] = None
    guide_mp4s: Dict[str, Optional[Path]] = {"zh": None, "ja": None}
    final_srt = work_dir / f"{slug}.srt"
    cover_jpg = work_dir / f"{slug}.jpg"

    print("\n====================================")
    print("處理網址：", clean_url)
    print("分類：", category)
    print("title：", title)
    print("slug：", slug)
    print("資料夾：", work_dir)
    print("模式：", "強制重做" if redo_mode else "續跑 / 略過已完成步驟")
    print("====================================")

    youtube_source_for_json = clean_url

    if category == "music":
        # V23 MUSIC FIX:
        # 舊版 music 只下載音訊，再用封面 + 音訊合成 <slug>.mp4，
        # 造成瀏覽器播放時「有聲音、畫面不動」。
        # 新版 music 改成跟 movie/news/story 一樣：下載真正影片 -> 壓縮成 <slug>.mp4。
        music_video_regenerated = False

        print("\n[1/9] MUSIC 下載真正影片 ...")
        resume_or_download_video(clean_url, work_dir, raw_mp4)
        print("完成：", raw_mp4)

        print("\n[2/9] MUSIC 壓縮影片 ...")
        if exists_ok(final_mp4, 200_000) and is_valid_moving_mp4(final_mp4):
            print("[續跑] 已有正常動態 mp4，略過：", final_mp4)
        else:
            if final_mp4.exists():
                bad_backup = final_mp4.with_name(f"{slug}_STATIC_BAD_{time.strftime('%Y%m%d_%H%M%S')}.mp4")
                try:
                    final_mp4.rename(bad_backup)
                    print("[MUSIC修正] 舊 mp4 疑似靜態封面，已備份：", bad_backup)
                except Exception:
                    try:
                        final_mp4.unlink()
                    except Exception:
                        pass
            compress_to_mp4(raw_mp4, final_mp4)
            music_video_regenerated = True
            print("完成：", final_mp4)

        maybe_delete_raw(raw_mp4)

        print("\n[3/9] MUSIC 從影片抓封面 ...")
        if exists_ok(cover_jpg, 5_000) and not music_video_regenerated:
            print("[續跑] 已有封面，略過：", cover_jpg)
        else:
            make_cover_from_video(final_mp4, cover_jpg)
            print("完成：", cover_jpg)

        if music_video_regenerated:
            # 主影片從靜態封面修成動態影片後，舊伴奏/中導唱/日導唱也可能是靜態封面，必須刪掉重建。
            for suffix in ("_karaoke.mp4", "_zh.mp4", "_ja.mp4"):
                old_sidecar = work_dir / f"{slug}{suffix}"
                if old_sidecar.exists():
                    try:
                        old_sidecar.unlink()
                        print("[MUSIC修正] 刪除舊音源影片，稍後重建：", old_sidecar.name)
                    except Exception as e:
                        print("[MUSIC修正] 刪除舊音源影片失敗：", old_sidecar, e)

        if ENABLE_MUSIC_KARAOKE:
            print("\n[3B/9] MUSIC 產生 KTV 伴奏版 ...")
            try:
                karaoke_mp4 = make_music_karaoke_version(final_mp4, work_dir, slug)
            except Exception as e:
                karaoke_mp4 = None
                write_error_file(work_dir, "karaoke.txt", str(e))
                print("[KTV失敗]", e)
        else:
            print("\n[3B/9] MUSIC KTV MP4 已關閉，略過 _karaoke/_zh/_ja，改走 MP3 語音包")

        # V25 MUSIC SYNC FIX：
        # 原本 Whisper 直接吃整支 final_mp4（伴奏+人聲混在一起），歌曲開頭很容易抓成 20~30 秒大段。
        # 既然上面已經跑 Demucs 並產生 audio/vocals.mp3，MUSIC 字幕優先用「純人聲」做 Whisper，
        # 能明顯降低前段一坨字幕與字/音錯位。
        vocals_for_whisper = work_dir / "audio" / "vocals.mp3"
        if exists_ok(vocals_for_whisper, 100_000):
            media_for_whisper = vocals_for_whisper
            print("[MUSIC SYNC] Whisper 改用 vocals.mp3：", vocals_for_whisper)
        else:
            media_for_whisper = final_mp4
            print("[MUSIC SYNC] 找不到 vocals.mp3，Whisper 暫時退回主影片：", final_mp4)
    else:
        print("\n[1/9] 下載影片 ...")
        resume_or_download_video(clean_url, work_dir, raw_mp4)
        print("完成：", raw_mp4)

        print("\n[2/9] 壓縮影片 ...")
        if exists_ok(final_mp4, 200_000):
            print("[續跑] 已有 mp4，略過：", final_mp4)
        else:
            compress_to_mp4(raw_mp4, final_mp4)
            print("完成：", final_mp4)
        maybe_delete_raw(raw_mp4)

        print("\n[3/9] 抓封面 ...")
        if exists_ok(cover_jpg, 5_000):
            print("[續跑] 已有封面，略過：", cover_jpg)
        else:
            make_cover_from_video(final_mp4, cover_jpg)
            print("完成：", cover_jpg)
        media_for_whisper = final_mp4

    print("\n[4/9] Whisper 產生字幕 ...")
    # V37：先算出本次 music 應用的 model/language，再決定舊 SRT 能不能續跑。
    whisper_lang = bw_whisper_language_for(category)
    effective_whisper_model = bw_whisper_model_for(category, whisper_lang, whisper_model)
    if category == "music":
        print(f"[MUSIC WHISPER] 專用模型：{effective_whisper_model} / language={whisper_lang}")
        bw_prepare_music_srt_for_expected_whisper(
            work_dir, slug, final_srt, effective_whisper_model, whisper_lang
        )

    if exists_ok(final_srt, 50):
        print("[續跑] 已有 srt，略過：", final_srt)
    else:
        whisper_srt(media_for_whisper, work_dir, final_srt, model=effective_whisper_model, language=whisper_lang)
        if category == "music":
            bw_write_music_whisper_meta(work_dir, slug, effective_whisper_model, whisper_lang, media_for_whisper)
        print("完成：", final_srt)

    print("\n[5/9] 讀取 SRT ...")
    segments = parse_srt_text(final_srt.read_text(encoding="utf-8", errors="ignore"))
    if not segments:
        raise RuntimeError("SRT 解析失敗，無字幕內容")

    if category == "music":
        # V50：先合併 Whisper 偶發的 1～2 字短碎句，
        # 例如 looking down on + creation，避免翻譯被切錯行。
        segments = merge_short_music_srt_segments(segments, slug)

        # V28：再把 Whisper 的 MUSIC 超長 SRT 段落切短，
        # 再進品質檢查，避免第一段 17 秒 / 16 詞就整支停止。
        segments = normalize_music_srt_segments_for_pipeline(segments, slug)
        validate_music_srt_quality(segments, work_dir, slug)

        # === V42 MUSIC 補缺強化 ===
        # 截圖案例：資料夾已經有 quiz/vocab/index/audio，但 cues-<slug>.json 缺檔，
        # player 會 404，且舊依賴 JSON/MP3 可能是上一輪 Mantra fallback 或半套內容。
        # 因此：只要 cues 缺檔 / 壞檔 / 尾段不足 / Mantra，就刪掉依賴 JSON，保留 mp4/srt/karaoke/vocals，
        # 然後從現有 SRT 重新補齊整套 JSON。
        cues_path_v42 = work_dir / f"cues-{slug}.json"
        music_json_targets_v42 = [
            work_dir / f"quiz-{slug}.json",
            work_dir / f"vocab-{slug}.json",
            work_dir / f"ai-{slug}.json",
            work_dir / f"index-{slug}.json",
            work_dir / f"{slug}.dialogue.json",
            work_dir / f"speaking-{slug}.json",
            work_dir / f"music-audio-{slug}.json",
        ]
        v42_reason = ""
        if not json_exists_ok(cues_path_v42):
            v42_reason = "cues missing"
        else:
            try:
                _v42_cues_obj = json.loads(cues_path_v42.read_text(encoding="utf-8", errors="ignore"))
                validate_cues_time_coverage(_v42_cues_obj, segments, category, slug, work_dir)
                validate_cues_json_quality(_v42_cues_obj, category, work_dir, slug)
            except Exception as e:
                v42_reason = "bad cues: " + str(e).splitlines()[0][:120]
        if v42_reason:
            print(f"[V42 REBUILD JSON ONLY] MUSIC {v42_reason}；保留 mp4/srt/karaoke，只從 SRT 補齊 JSON")
            remove_music_json_dependents(work_dir, slug, v42_reason)
        elif any(not json_exists_ok(p) for p in music_json_targets_v42):
            missing_v42 = [p.name for p in music_json_targets_v42 if not json_exists_ok(p)]
            print("[V42 PATCH JSON ONLY] MUSIC cues OK，但缺其他 JSON/MP3，將只補缺：" + ", ".join(missing_v42[:20]))

    print("\n[6/9] 產生 JSON ...")
    ensure_json_safe(api_key, "cues", slug, category, segments, youtube_source_for_json, work_dir / f"cues-{slug}.json", work_dir)
    ensure_json_safe(api_key, "quiz", slug, category, segments, youtube_source_for_json, work_dir / f"quiz-{slug}.json", work_dir)
    ensure_json_safe(api_key, "vocab", slug, category, segments, youtube_source_for_json, work_dir / f"vocab-{slug}.json", work_dir)
    ensure_json_safe(api_key, "ai", slug, category, segments, youtube_source_for_json, work_dir / f"ai-{slug}.json", work_dir)
    ensure_json_safe(api_key, "index", slug, category, segments, youtube_source_for_json, work_dir / f"index-{slug}.json", work_dir)

    if category == "music" and ENABLE_MUSIC_LINE_MP3:
        print("\n[6A/9] MUSIC 產生中 / 英逐句 MP3 語音包 ...")
        try:
            generate_music_line_mp3_pack(work_dir, slug, segments)
        except Exception as e:
            write_error_file(work_dir, "music_mp3.txt", str(e))
            print("[MP3失敗]", e)

    if category == "music" and ENABLE_MUSIC_KARAOKE:
        print("\n[6B/9] MUSIC 產生中文 / 日文導唱 MP4 ...")
        if not karaoke_mp4 and has_valid_music_karaoke(work_dir, slug):
            karaoke_mp4 = work_dir / f"{slug}_karaoke.mp4"
        guide_mp4s = make_music_guide_versions(karaoke_mp4, work_dir, slug)

    # 強制鎖定 slug，不允許 index / fallback 改名
    index_path = work_dir / f"index-{slug}.json"
    index_obj = json.loads(index_path.read_text(encoding="utf-8", errors="ignore"))
    index_obj["slug"] = slug
    if should_lock_public_title(category):
        # story / movie / music / news 片名一律鎖定 YouTube 真標題；
        # 避免 GPT / fallback 產出「健康諮詢預約」「音樂欣賞」這類錯片名。
        fixed_title = best_public_title(title, slug, category)
        index_obj["title"] = fixed_title
        index_obj["category"] = base_category_of(category) or category
        index_obj["youtube_url"] = clean_url
        index_obj["youtube_id"] = youtube_id
    write_json(index_path, index_obj)
    write_meta_json(work_dir, slug, index_obj)
    if should_lock_public_title(category):
        patch_public_title_files(work_dir, slug, category, clean_url, title)
    if category == "music":
        patch_music_title_files(work_dir, slug, clean_url, title)
        patch_music_karaoke_index_json(work_dir, slug, category, karaoke_mp4)
        patch_music_mp3_index_json(work_dir, slug, category)

    print("\n[7/9] 產生 dialogue / speaking ...")
    ensure_dialogue_and_speaking(api_key, slug, category, youtube_source_for_json, segments, work_dir)

    print("\n[8/9] 完成產檔")
    print("資料夾：", work_dir)
    return slug, work_dir


def load_review_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        raise RuntimeError(f"找不到 CSV：{path}")
    rows: List[Dict[str, str]] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise RuntimeError("CSV 沒有表頭")
        for row in reader:
            normalized = {str(k).strip(): str(v or "").strip() for k, v in row.items()}
            slug = sanitize_name(str(normalized.get("slug") or "").strip().strip('"'))
            url = clean_youtube_url(str(normalized.get("url") or "").strip().strip('"'))
            if not slug:
                raise RuntimeError("CSV 缺少 slug（已禁止 fallback）")
            if not url:
                raise RuntimeError(f"CSV 缺少 url：{row}")
            normalized["slug"] = slug
            normalized["url"] = url
            rows.append(normalized)
    if not rows:
        raise RuntimeError("CSV 沒有資料")
    return rows


def read_multi_urls() -> List[str]:
    print("\n請貼多個 YouTube URL（每行一個，空白行結束）：")
    urls: List[str] = []
    while True:
        try:
            line = input().strip()
        except EOFError:
            break
        if not line:
            break
        urls.append(line)
    return urls





DOMAIN_GROUP_LABELS = {
    "healthcare": "醫療照護",
    "education": "教學工作",
    "business": "商務工作",
    "engineering": "工程技術",
    "service": "服務接待",
    "student": "學生日常",
    "lifestyle": "生活旅遊",
    "finance": "金融工作",
    "marketing": "行銷工作",
    "it": "資訊科技",
    "legal": "法律相關",
    "manufacturing": "製造業",
}

GROUP_ROLE_FILES = {
    "healthcare": [
        ("nurse", "nurse_learning_assets_review.csv"),
        ("physician", "physician_learning_assets_review.csv"),
        ("pharmacist", "pharmacist_learning_assets_review.csv"),
        ("therapist", "therapist_learning_assets_review.csv"),
        ("clinic_staff", "clinic-staff_learning_assets_review.csv"),
    ],
    "education": [
        ("elementary_teacher", "elementary-teacher_learning_assets_review.csv"),
        ("junior_teacher", "junior-teacher_learning_assets_review.csv"),
        ("senior_teacher", "senior-teacher_learning_assets_review.csv"),
        ("cram_teacher", "cram-teacher_learning_assets_review.csv"),
        ("university_lecturer", "university-lecturer_learning_assets_review.csv"),
        ("nursing_instructor", "nursing-instructor_learning_assets_review.csv"),
        ("tutor", "tutor_learning_assets_review.csv"),
    ],
    "business": [
        ("trader", "trader_learning_assets_review.csv"),
        ("sales", "sales_learning_assets_review.csv"),
        ("manager", "manager_learning_assets_review.csv"),
        ("purchasing", "purchasing_learning_assets_review.csv"),
        ("office_staff", "office-staff_learning_assets_review.csv"),
        ("customer_service", "customer-service_learning_assets_review.csv"),
    ],
    "engineering": [
        ("mechanical_engineer", "mechanical-engineer_learning_assets_review.csv"),
        ("process_engineer", "process-engineer_learning_assets_review.csv"),
        ("product_engineer", "product-engineer_learning_assets_review.csv"),
        ("quality_engineer", "quality-engineer_learning_assets_review.csv"),
        ("field_service_engineer", "field-service-engineer_learning_assets_review.csv"),
    ],
    "service": [
        ("restaurant_staff", "restaurant-staff_learning_assets_review.csv"),
        ("hotel_staff", "hotel-staff_learning_assets_review.csv"),
        ("retail_staff", "retail-staff_learning_assets_review.csv"),
        ("reception", "reception_learning_assets_review.csv"),
    ],
    "student": [
        ("high_school", "high-school_learning_assets_review.csv"),
        ("college", "college_learning_assets_review.csv"),
        ("graduate", "graduate_learning_assets_review.csv"),
    ],
    "lifestyle": [
        ("daily", "daily_learning_assets_review.csv"),
        ("travel", "travel_learning_assets_review.csv"),
        ("business_trip", "business-trip_learning_assets_review.csv"),
    ],
    "finance": [
        ("accountant", "accountant_learning_assets_review.csv"),
        ("bank_clerk", "bank-clerk_learning_assets_review.csv"),
        ("financial_analyst", "financial-analyst_learning_assets_review.csv"),
    ],
    "marketing": [
        ("marketing_staff", "marketing-staff_learning_assets_review.csv"),
        ("social_media_manager", "social-media-manager_learning_assets_review.csv"),
        ("brand_specialist", "brand-specialist_learning_assets_review.csv"),
    ],
    "it": [
        ("software_engineer", "software-engineer_learning_assets_review.csv"),
        ("it_support", "it-support_learning_assets_review.csv"),
        ("data_analyst", "data-analyst_learning_assets_review.csv"),
    ],
    "legal": [
        ("lawyer", "lawyer_learning_assets_review.csv"),
        ("paralegal", "paralegal_learning_assets_review.csv"),
        ("legal_assistant", "legal-assistant_learning_assets_review.csv"),
    ],
    "manufacturing": [
        ("production_operator", "production-operator_learning_assets_review.csv"),
        ("warehouse_staff", "warehouse-staff_learning_assets_review.csv"),
        ("quality_inspector", "quality-inspector_learning_assets_review.csv"),
    ],
}

def prompt_select(options: List[Tuple[str, str]], title: str, allow_all: bool = False, allow_back: bool = False) -> str:
    print("\\n" + title)
    for i, (_, label) in enumerate(options, start=1):
        print(f"[{i}] {label}")
    extra_idx = len(options) + 1
    all_idx = None
    back_idx = None
    if allow_all:
        all_idx = extra_idx
        print(f"[{all_idx}] 全部")
        extra_idx += 1
    if allow_back:
        back_idx = extra_idx
        print(f"[{back_idx}] 返回")
    choice = input("請選擇（直接 Enter = 1）: ").strip() or "1"
    try:
        n = int(choice)
    except Exception:
        raise RuntimeError("選擇錯誤")
    if 1 <= n <= len(options):
        return options[n - 1][0]
    if allow_all and n == all_idx:
        return "__all__"
    if allow_back and n == back_idx:
        return "__back__"
    raise RuntimeError("選擇錯誤")

def choose_learning_csv_paths_v22() -> List[Path]:
    output_dir = SCRIPT_DIR / "output_v3"

    ordered_domains = [
        "healthcare",
        "education",
        "business",
        "engineering",
        "service",
        "student",
        "lifestyle",
        "finance",
        "marketing",
        "it",
        "legal",
        "manufacturing",
    ]
    domain_options = [(k, f"{k}（{DOMAIN_GROUP_LABELS[k]}）") for k in ordered_domains]

    print("\n請選擇大分類：")
    for i, (_, label) in enumerate(domain_options, start=1):
        print(f"[{i}] {label}")
    print(f"[{len(domain_options) + 1}] 新增5類")
    print(f"[{len(domain_options) + 2}] 全部")

    choice = input("請選擇（直接 Enter = 1）: ").strip() or "1"
    try:
        n = int(choice)
    except Exception:
        raise RuntimeError("選擇錯誤")

    selected_pairs: List[Tuple[str, str, str]] = []

    def add_existing_from_domain(domain_key: str, role_key: str = "__all__") -> None:
        for rk, filename in GROUP_ROLE_FILES.get(domain_key, []):
            if role_key != "__all__" and rk != role_key:
                continue
            p = output_dir / filename
            if p.exists():
                selected_pairs.append((domain_key, rk, filename))

    if 1 <= n <= len(domain_options):
        domain_choice = domain_options[n - 1][0]
        role_options = [(rk, rk) for rk, _ in GROUP_ROLE_FILES[domain_choice]]
        role_choice = prompt_select(role_options, f"請選擇 {domain_choice} 小分類：", allow_all=True, allow_back=True)
        if role_choice == "__back__":
            return choose_learning_csv_paths_v22()
        add_existing_from_domain(domain_choice, role_choice)

    elif n == len(domain_options) + 1:
        for domain_key in ["finance", "marketing", "it", "legal", "manufacturing"]:
            add_existing_from_domain(domain_key, "__all__")

    elif n == len(domain_options) + 2:
        for domain_key, _ in domain_options:
            add_existing_from_domain(domain_key, "__all__")

    else:
        raise RuntimeError("選擇錯誤")

    paths: List[Path] = []
    seen = set()
    for _, _, filename in selected_pairs:
        p = output_dir / filename
        key = str(p.resolve()).lower()
        if key not in seen:
            seen.add(key)
            paths.append(p)

    if not paths:
        raise RuntimeError("找不到對應的 learning_assets_review.csv")
    return paths

def infer_domain_role_from_csv_path_v22(csv_path: Path) -> Tuple[str, str]:
    lower = csv_path.name.lower()
    for domain_key, pairs in GROUP_ROLE_FILES.items():
        for role_key, filename in pairs:
            if lower == filename.lower():
                return domain_key, role_key
    base = lower.replace("_learning_assets_review.csv", "").replace("-", "_")
    return "misc", base

def patch_generated_jsons_v22(work_dir: Path, slug: str) -> None:
    for p in [work_dir / f"index-{slug}.json", work_dir / f"meta-{slug}.json"]:
        if not p.exists():
            continue
        try:
            obj = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
            if isinstance(obj, dict):
                obj["category"] = "pro"
                if "cover_url" in obj:
                    obj["cover_url"] = f"{R2_PUBLIC_BASE}/assets/pro/{slug}.jpg"
                if "cover" in obj:
                    obj["cover"] = f"{R2_PUBLIC_BASE}/assets/pro/{slug}.jpg"
                if "video" in obj:
                    obj["video"] = f"{R2_PUBLIC_BASE}/videos/pro/{slug}.mp4"
                p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"[WARN] 修正 JSON 失敗：{p.name} -> {e}")

def process_one_row_v22(api_key: str, row: Dict[str, str], csv_path: Path, output_root: Path, whisper_model: str, force_redo: bool) -> Tuple[str, Path]:
    domain_code, role_code = infer_domain_role_from_csv_path_v22(csv_path)
    nested_category = f"pro/{domain_code}/{role_code}"
    slug, work_dir = process_one_row(api_key, row, nested_category, output_root, whisper_model, force_redo)
    patch_generated_jsons_v22(work_dir, slug)
    return slug, work_dir
def main() -> None:
    require_tool("yt-dlp")
    require_tool("ffmpeg")
    require_tool("ffprobe")
    require_tool("whisper")

    api_key = os.environ.get("OPENAI_API_KEY") or ENV.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("找不到 OPENAI_API_KEY，請放在 .env")

    global AUTO_SKIP_DUPLICATES

    print("已讀取 OPENAI_API_KEY：OK")
    print("預設輸出根目錄：", DEFAULT_OUTPUT_ROOT)
    print("預設分類：pro/<domain>/<role>")

    csv_paths = choose_learning_csv_paths_v22()

    root_in = input(f"輸出根目錄（直接 Enter = {DEFAULT_OUTPUT_ROOT}）: ").strip().strip('"')
    output_root = Path(root_in) if root_in else DEFAULT_OUTPUT_ROOT

    whisper_model = input(f"Whisper model（直接 Enter = {DEFAULT_WHISPER_MODEL}）: ").strip() or DEFAULT_WHISPER_MODEL
    force_redo = input("預設新影片是否用強制重做模式？(y/N): ").strip().lower() in ("y", "yes")
    AUTO_SKIP_DUPLICATES = input("重複影片是否自動 Skip？(Y/n): ").strip().lower() not in ("n", "no")

    print("\n本次選擇：")
    for p in csv_paths:
        domain_code, role_code = infer_domain_role_from_csv_path_v22(p)
        print(f" - {domain_code} / {role_code}")
        print(f"   {p}")
        print(f"   -> {output_root / 'pro' / domain_code / role_code}")

    grand_ok = 0
    grand_fail = 0

    for csv_path in csv_paths:
        rows = load_review_csv(csv_path)
        domain_code, role_code = infer_domain_role_from_csv_path_v22(csv_path)

        print("\n" + "#" * 78)
        print("目前 CSV：", csv_path)
        print("固定分類：pro")
        print("輸出資料夾：", output_root / "pro" / domain_code / role_code)
        print(f"共讀到 {len(rows)} 筆")
        print("#" * 78)

        ok = 0
        fail = 0
        for i, row in enumerate(rows, start=1):
            print("\n" + "=" * 70)
            print(f"[{i}/{len(rows)}] {row['slug']}")
            print("分類： pro")
            print(row["url"])
            try:
                process_one_row_v22(api_key, row, csv_path, output_root, whisper_model, force_redo)
                ok += 1
                grand_ok += 1
            except Exception as e:
                fail += 1
                grand_fail += 1
                print(f"\n[ERROR] {row['slug']}：{e}")

        print("\n------------------------------")
        print("CSV 完成：", csv_path.name)
        print(f"成功：{ok}")
        print(f"失敗：{fail}")
        print("------------------------------")

    print("\n==============================")
    print("全部完成")
    print(f"總成功：{grand_ok}")
    print(f"總失敗：{grand_fail}")
    print("==============================")

    # V22 SAFE STOP:
    # 任何一筆失敗，都必須用非 0 結束。
    # 讓 00youtube_to_index_all_in_one_FINAL.py 可以偵測失敗，
    # 並停止後續 04 / 05 / 06 / 03，避免壞 JSON 或不完整教材上架。
    if grand_fail > 0:
        print("\n[SAFE STOP] 本次有教材產生失敗，02 以 returncode=1 結束。")
        print("[SAFE STOP] 上層 00 應停止，不可繼續跑 04/05/06/03。")
        sys.exit(1)

    input("\n按 Enter 關閉...")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已取消。")
        input("\nENTER EXIT")
    except Exception as e:
        print("\nERROR:", str(e))
        input("\nENTER EXIT")
