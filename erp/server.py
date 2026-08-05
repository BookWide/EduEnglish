from __future__ import annotations

import json
import math
import os
import re
import sys
import threading
import webbrowser
from datetime import date, datetime
from decimal import Decimal
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

try:
    import psycopg2
    from psycopg2 import sql
except Exception as exc:
    print("[ERROR] psycopg2-binary is missing:", exc)
    print("Run INSTALL_DEPENDENCIES.bat")
    raise

ROOT = Path(__file__).resolve().parent
HOST = os.getenv("ERP_WEB_HOST", "127.0.0.1")
WEB_PORT = int(os.getenv("ERP_WEB_PORT", "8787"))
DB_CONFIG = {
    "host": os.getenv("ERP_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("ERP_DB_PORT", "5433")),
    "dbname": os.getenv("ERP_DB_NAME", "we"),
    "user": os.getenv("ERP_DB_USER", "postgresql"),
    "password": os.getenv("ERP_DB_PASSWORD", "ssdbqazse"),
    "connect_timeout": 8,
}
ITEM_LIMIT = int(os.getenv("ERP_ITEM_LIMIT", "1000"))
_schema_lock = threading.Lock()
_schema_cache: dict[str, list[tuple[str, str]]] | None = None
_product_lock = threading.Lock()
_product_cache: list[dict[str, Any]] | None = None


def get_conn():
    conn = psycopg2.connect(**DB_CONFIG)
    # PostgreSQL 8.0 database is reported as UNICODE. Let the server convert to UTF-8.
    # SQL_ASCII installations can override this with ERP_CLIENT_ENCODING.
    enc = os.getenv("ERP_CLIENT_ENCODING", "UTF8")
    try:
        conn.set_client_encoding(enc)
    except Exception:
        pass
    return conn


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex()
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return str(value)


def rows_as_dict(cur) -> list[dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [{cols[i]: json_safe(v) for i, v in enumerate(row)} for row in cur.fetchall()]


def load_schema() -> dict[str, list[tuple[str, str]]]:
    global _schema_cache
    with _schema_lock:
        if _schema_cache is not None:
            return _schema_cache
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema='public'
                ORDER BY table_name, ordinal_position
            """)
            schema: dict[str, list[tuple[str, str]]] = {}
            for table, col, dtype in cur.fetchall():
                schema.setdefault(table, []).append((col, dtype))
            _schema_cache = schema
            return schema


def text_columns(cols: list[tuple[str, str]]) -> list[str]:
    allowed = {"character varying", "character", "text"}
    return [name for name, dtype in cols if dtype in allowed]


def has_oid(cols: list[tuple[str, str]]) -> bool:
    return any(name.lower() == "i_oid" for name, _ in cols)


def safe_columns(cols: list[tuple[str, str]]) -> list[str]:
    selected = []
    for name, dtype in cols:
        lname = name.lower()
        if lname == "i_oid":
            selected.append(name)
        elif dtype != "bytea" and lname not in {"photo", "inv_item_source_substitutes"}:
            selected.append(name)
    return selected


def fetch_rows(cur, table: str, cols: list[tuple[str, str]], *, limit: int, oids=None):
    selected = safe_columns(cols)
    if not selected:
        return []
    fields = sql.SQL(", ").join(sql.Identifier(c) for c in selected)
    stmt = sql.SQL("SELECT {} FROM public.{}").format(fields, sql.Identifier(table))
    params: list[Any] = []
    if oids is not None:
        stmt += sql.SQL(" WHERE {} = ANY(%s)").format(sql.Identifier("i_oid"))
        params.append(oids)
    stmt += sql.SQL(" LIMIT %s")
    params.append(limit)
    cur.execute(stmt, params)
    return rows_as_dict(cur)


def oid_key(value: Any) -> str:
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex()
    return str(value or "")


def oid_db(value: Any):
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if isinstance(value, str):
        try:
            return bytes.fromhex(value)
        except Exception:
            return value
    return value


def repair_text(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).replace("\x00", "").strip()
    if not s:
        return ""

    candidates = [s]
    # Old Java/SQL_ASCII systems sometimes expose Big5 bytes as Latin-1 characters.
    for src, dst in (("latin1", "cp950"), ("latin1", "big5"), ("cp1252", "utf-8")):
        try:
            candidates.append(s.encode(src).decode(dst))
        except Exception:
            pass

    def score(x: str) -> tuple[int, int, int, int]:
        cjk = sum(1 for ch in x if "\u3400" <= ch <= "\u9fff")
        printable = sum(1 for ch in x if ch.isprintable())
        bad = x.count("�") + sum(1 for ch in x if ord(ch) < 32 and ch not in "\t\r\n")
        boxes = x.count("□") + x.count("?")
        return (cjk * 8 + printable - bad * 20 - boxes * 3, cjk, -bad, -boxes)

    best = max(candidates, key=score)
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", best).strip()


def usable_text(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    s = repair_text(value)
    if not s or len(s) > 500:
        return False
    printable = sum(ch.isprintable() for ch in s)
    return printable >= max(1, int(len(s) * 0.85))


def field_values(obj: dict[str, Any]):
    for table, row in obj.get("_raw", {}).items():
        for col, raw in row.items():
            if col.lower() == "i_oid" or not usable_text(raw):
                continue
            yield table, col, repair_text(raw)


def pick_named(obj: dict[str, Any], names: list[str]) -> str:
    wanted = {n.lower() for n in names}
    for _table, col, value in field_values(obj):
        if col.lower() in wanted and value:
            return value
    return ""


def code_score(table: str, col: str, value: str) -> int:
    c = col.lower()
    t = table.lower()
    score = 0
    exact = {
        "id": 130, "code": 125, "itemno": 125, "item_no": 125,
        "thingno": 120, "thing_no": 120, "number": 110, "no": 100,
        "key": 95, "barcodeno": 60, "barcode": 55,
    }
    score += exact.get(c, 0)
    if "code" in c or c.endswith("no") or "number" in c:
        score += 55
    if t in {"thing", "entity", "item"}:
        score += 20
    if re.search(r"[A-Za-z]", value) and re.search(r"\d", value):
        score += 45
    if any(ch in value for ch in "-_/()."):
        score += 25
    if 3 <= len(value) <= 50:
        score += 20
    if any("\u3400" <= ch <= "\u9fff" for ch in value):
        score -= 25
    if value.count("□") or value.count("?") > 2:
        score -= 80
    return score


def name_score(table: str, col: str, value: str, code: str) -> int:
    if value == code:
        return -100
    c = col.lower()
    t = table.lower()
    score = 0
    exact = {"name": 140, "title": 120, "displayname": 115, "description": 80, "memo": 35}
    score += exact.get(c, 0)
    if "name" in c:
        score += 60
    if t in {"thing", "entity", "item"}:
        score += 20
    if any("\u3400" <= ch <= "\u9fff" for ch in value):
        score += 55
    if 1 <= len(value) <= 100:
        score += 15
    if re.fullmatch(r"[0-9A-Za-z_.\-()/ ]+", value):
        score -= 20
    return score


def choose_code(obj: dict[str, Any]) -> str:
    values = list(field_values(obj))
    if not values:
        return obj.get("_oid", "")
    return max(values, key=lambda x: code_score(*x))[2]


def choose_name(obj: dict[str, Any], code: str) -> str:
    values = list(field_values(obj))
    if not values:
        return "（名稱欄位待確認）"
    best = max(values, key=lambda x: name_score(*x, code))
    return best[2] if name_score(*best, code) > 0 else "（名稱欄位待確認）"


def merge_rows(table_rows: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for table, rows in table_rows.items():
        for row in rows:
            key = oid_key(row.get("i_oid")) or f"{table}:{len(merged)}"
            obj = merged.setdefault(key, {"_oid": key, "_tables": [], "_raw": {}})
            if table not in obj["_tables"]:
                obj["_tables"].append(table)
            obj["_raw"][table] = row
    return [normalize_product(obj) for obj in merged.values()]


def normalize_product(obj: dict[str, Any]) -> dict[str, Any]:
    code = choose_code(obj)
    name = choose_name(obj, code)
    memo = pick_named(obj, ["memo", "description", "desc"])
    internal = pick_named(obj, ["internalmemo", "references", "reference", "designrule", "ruleno"])
    unit = pick_named(obj, ["baseunit", "unit"])
    barcode = pick_named(obj, ["barcodeno", "barcode"]) or code
    flat = {}
    for table, col, value in field_values(obj):
        flat[f"{table}.{col}"] = value
    return {
        "id": code,
        "name": name,
        "category": "PostgreSQL 真實產品",
        "memo": memo,
        "internalMemo": internal,
        "reference": pick_named(obj, ["references", "reference"]),
        "unit": unit,
        "stockable": bool(next((r.get("stockable") for r in obj["_raw"].values() if "stockable" in r), False)),
        "taxable": bool(next((r.get("taxable") for r in obj["_raw"].values() if "taxable" in r), False)),
        "barcode": barcode,
        "photo": "",
        "status": "DB READ-ONLY",
        "updatedAt": "",
        "_oid": obj.get("_oid"),
        "_tables": obj.get("_tables", []),
        "_fields": flat,
    }


def build_product_cache(force: bool = False) -> list[dict[str, Any]]:
    global _product_cache
    with _product_lock:
        if _product_cache is not None and not force:
            return _product_cache
        schema = load_schema()
        if "Item" not in schema:
            raise RuntimeError('Cannot find public."Item"')
        table_rows: dict[str, list[dict[str, Any]]] = {}
        with get_conn() as conn, conn.cursor() as cur:
            item_rows = fetch_rows(cur, "Item", schema["Item"], limit=ITEM_LIMIT)
            table_rows["Item"] = item_rows
            raw_oids = [oid_db(r.get("i_oid")) for r in item_rows if r.get("i_oid") not in (None, "")]

            # Join only tables that share i_oid and contain text fields. This finds the
            # actual RunEC parent/master table without scanning all table rows.
            candidates = []
            preferred = ["Thing", "Entity", "NamedObject", "Material", "Service", "ItemGroup"]
            for table in preferred:
                cols = schema.get(table)
                if cols and has_oid(cols) and text_columns(cols):
                    candidates.append(table)
            for table, cols in schema.items():
                if table not in candidates and table != "Item" and has_oid(cols) and text_columns(cols):
                    candidates.append(table)

            for table in candidates:
                try:
                    rows = fetch_rows(cur, table, schema[table], limit=max(ITEM_LIMIT * 2, 2000), oids=raw_oids)
                    if rows:
                        table_rows[table] = rows
                except Exception as exc:
                    conn.rollback()
                    print(f"[SKIP] {table}: {exc}")

        products = merge_rows(table_rows)
        # Remove obvious non-products and sort by human-readable code.
        products = [p for p in products if p.get("id") and not str(p["id"]).startswith("unkeyed:")]
        products.sort(key=lambda p: (str(p.get("id", "")).lower(), str(p.get("name", "")).lower()))
        _product_cache = products
        print(f"[OK] Product cache: {len(products)} products; joined tables: {', '.join(table_rows)}")
        return products


def product_search(query: str = "", refresh: bool = False) -> list[dict[str, Any]]:
    products = build_product_cache(force=refresh)
    q = repair_text(query).lower().strip()
    if not q:
        return products[:500]
    found = []
    for p in products:
        hay = " ".join([
            str(p.get("id", "")), str(p.get("name", "")), str(p.get("memo", "")),
            str(p.get("internalMemo", "")), " ".join(p.get("_fields", {}).values()),
        ]).lower()
        if q in hay:
            found.append(p)
    return found[:500]


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        rel = unquote(parsed.path).lstrip("/") or "index.html"
        return str((ROOT / rel).resolve())

    def log_message(self, fmt, *args):
        print("[WEB]", fmt % args)

    def send_json(self, payload: Any, status: int = 200):
        data = json.dumps(payload, ensure_ascii=False, default=json_safe).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                with get_conn() as conn, conn.cursor() as cur:
                    cur.execute("SELECT current_database(), version(), pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()")
                    db, version, encoding = cur.fetchone()
                return self.send_json({
                    "ok": True, "database": db, "host": DB_CONFIG["host"],
                    "port": DB_CONFIG["port"], "mode": "READ_ONLY_TEST",
                    "version": version, "encoding": encoding,
                })
            if parsed.path == "/api/products":
                args = parse_qs(parsed.query)
                q = args.get("search", [""])[0].strip()
                refresh = args.get("refresh", ["0"])[0] == "1"
                products = product_search(q, refresh=refresh)
                return self.send_json({"ok": True, "count": len(products), "products": products})
            if parsed.path == "/api/schema/discovery":
                schema = load_schema()
                compact = {t: [c for c, _ in cols] for t, cols in schema.items() if t in {"Item", "Thing", "Entity", "Material", "Service"}}
                return self.send_json({"ok": True, "tables": compact})
            return super().do_GET()
        except Exception as exc:
            print("[API ERROR]", repr(exc))
            return self.send_json({"ok": False, "error": str(exc)}, 500)

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.send_json({"ok": False, "error": "V0.6 is read-only. Database writes are disabled."}, 405)
        return self.send_error(405)


def main():
    print("=" * 70)
    print("BookWide ERP V0.6 PostgreSQL product mapping + label printing")
    print(f"DB: {DB_CONFIG['host']}:{DB_CONFIG['port']} / {DB_CONFIG['dbname']}")
    print("MODE: READ ONLY")
    print("=" * 70)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT current_database(), pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()")
            db, encoding = cur.fetchone()
            print(f"[OK] PostgreSQL connected: {db}; encoding={encoding}")
    except Exception as exc:
        print("[FAIL] PostgreSQL connection failed:", exc)
        print(r"Check D:\PostgreSQL\8.0\data on port 5433.")
        input("Press Enter to exit...")
        sys.exit(1)

    server = ThreadingHTTPServer((HOST, WEB_PORT), Handler)
    url = f"http://{HOST}:{WEB_PORT}/"
    print("[OK] ERP URL:", url)
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
