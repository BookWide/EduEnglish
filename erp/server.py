from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import threading
import time
import webbrowser
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

try:
    import psycopg2
    from psycopg2 import sql
except Exception as exc:
    print("[ERROR] 缺少 psycopg2-binary：", exc)
    print("請執行 INSTALL_DEPENDENCIES.bat")
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
    "connect_timeout": 5,
}
SEEDS = [x.strip() for x in os.getenv(
    "ERP_PRODUCT_SEEDS",
    "22.00mmS6DTH,20A-TJL400-S60A,R245-12T3M-PM4230U,800-13T308H-P-G I025(-22)"
).split(",") if x.strip()]

_schema_lock = threading.Lock()
_schema_cache: dict[str, list[tuple[str, str]]] | None = None


def get_conn():
    return psycopg2.connect(**DB_CONFIG)


def json_safe(value: Any) -> Any:
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, (bytes, bytearray)):
        return value.hex()
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return value


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


def fetch_table_matches(cur, table: str, cols: list[tuple[str, str]], query: str, limit: int = 80):
    tcols = text_columns(cols)
    if not tcols:
        return []
    clauses = [sql.SQL("CAST({} AS text) ILIKE %s").format(sql.Identifier(c)) for c in tcols]
    stmt = sql.SQL("SELECT * FROM public.{} WHERE {} LIMIT %s").format(
        sql.Identifier(table), sql.SQL(" OR ").join(clauses)
    )
    params = [f"%{query}%"] * len(tcols) + [limit]
    cur.execute(stmt, params)
    return rows_as_dict(cur)


def fetch_item_seed_rows(cur, limit: int = 80):
    try:
        cur.execute(sql.SQL('SELECT * FROM public.{} LIMIT %s').format(sql.Identifier("Item")), [limit])
        return rows_as_dict(cur)
    except Exception:
        cur.connection.rollback()
        return []


def fetch_related_by_oids(cur, schema: dict[str, list[tuple[str, str]]], oids: list[Any]):
    result: dict[str, list[dict[str, Any]]] = {}
    if not oids:
        return result
    for table, cols in schema.items():
        if not has_oid(cols):
            continue
        try:
            stmt = sql.SQL('SELECT * FROM public.{} WHERE {} = ANY(%s)').format(
                sql.Identifier(table), sql.Identifier("i_oid")
            )
            cur.execute(stmt, [oids])
            rows = rows_as_dict(cur)
            if rows:
                result[table] = rows
        except Exception:
            cur.connection.rollback()
    return result


def merge_rows(table_rows: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    unkeyed = 0
    for table, rows in table_rows.items():
        for row in rows:
            oid = row.get("i_oid")
            if oid in (None, ""):
                key = f"unkeyed:{table}:{unkeyed}"
                unkeyed += 1
            else:
                key = str(oid)
            obj = merged.setdefault(key, {"_oid": key, "_tables": [], "_raw": {}})
            if table not in obj["_tables"]:
                obj["_tables"].append(table)
            obj["_raw"][table] = row
            for col, value in row.items():
                if col not in obj or obj[col] in (None, ""):
                    obj[col] = value
    return [normalize_product(x) for x in merged.values()]


def first_value(obj: dict[str, Any], names: list[str], default=""):
    lowered = {k.lower(): v for k, v in obj.items() if not k.startswith("_")}
    for name in names:
        v = lowered.get(name.lower())
        if v not in (None, ""):
            return v
    return default


def choose_code(obj: dict[str, Any]):
    val = first_value(obj, [
        "itemno", "item_no", "productno", "product_no", "thingno", "thing_no",
        "code", "number", "no", "key", "id", "barcodeno", "barcode", "memo"
    ])
    if val:
        return str(val).strip()
    # fallback: choose a product-like text value
    candidates = []
    for k, v in obj.items():
        if k.startswith("_") or not isinstance(v, str):
            continue
        s = v.strip()
        if 3 <= len(s) <= 80 and re.search(r"[A-Za-z0-9]", s):
            score = (3 if re.search(r"[-0-9]", s) else 0) + (2 if len(s) < 40 else 0)
            candidates.append((score, s))
    return max(candidates, default=(0, obj.get("_oid", "")))[1]


def choose_name(obj: dict[str, Any], code: str):
    val = first_value(obj, ["name", "title", "displayname", "display_name", "description", "desc", "memo"])
    if val and str(val).strip() != code:
        return str(val).strip()
    for k, v in obj.items():
        if k.startswith("_") or not isinstance(v, str):
            continue
        s = v.strip()
        if s and s != code and any(ord(ch) > 127 for ch in s):
            return s
    return "（名稱欄位待確認）"


def normalize_product(obj: dict[str, Any]):
    code = choose_code(obj)
    name = choose_name(obj, code)
    return {
        "id": code,
        "name": name,
        "category": first_value(obj, ["category", "class", "itemclass", "type"], "PostgreSQL 真實產品"),
        "memo": first_value(obj, ["memo", "description", "desc"], ""),
        "internalMemo": first_value(obj, ["internalmemo", "reference", "references", "designrule", "ruleno"], ""),
        "reference": first_value(obj, ["references", "reference"], ""),
        "unit": first_value(obj, ["baseunit", "unit"], ""),
        "stockable": bool(first_value(obj, ["stockable"], False)),
        "taxable": bool(first_value(obj, ["taxable"], False)),
        "barcode": first_value(obj, ["barcodeno", "barcode"], code),
        "photo": "",
        "status": "DB READ-ONLY",
        "updatedAt": "",
        "_oid": obj.get("_oid"),
        "_tables": obj.get("_tables", []),
        "_raw": obj.get("_raw", {}),
    }


def _decode_oid(value: Any):
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


def _select_safe_columns(cols: list[tuple[str, str]]) -> list[str]:
    """Avoid large bytea payloads such as product photos while keeping i_oid."""
    selected = []
    for name, dtype in cols:
        lname = name.lower()
        if lname == "i_oid":
            selected.append(name)
        elif dtype != "bytea" and lname not in {"photo", "inv_item_source_substitutes"}:
            selected.append(name)
    return selected


def _fetch_rows(cur, table: str, cols: list[tuple[str, str]], *, limit=500, oids=None, query=""):
    selected = _select_safe_columns(cols)
    if not selected:
        return []
    fields = sql.SQL(", ").join(sql.Identifier(c) for c in selected)
    where_parts = []
    params = []
    if oids is not None and has_oid(cols):
        where_parts.append(sql.SQL("{} = ANY(%s)").format(sql.Identifier("i_oid")))
        params.append(oids)
    if query:
        tcols = [c for c in text_columns(cols) if c in selected]
        if tcols:
            where_parts.append(sql.SQL("(") + sql.SQL(" OR ").join(
                sql.SQL("CAST({} AS text) ILIKE %s").format(sql.Identifier(c)) for c in tcols
            ) + sql.SQL(")"))
            params.extend([f"%{query}%"] * len(tcols))
    stmt = sql.SQL("SELECT {} FROM public.{}").format(fields, sql.Identifier(table))
    if where_parts:
        stmt += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(where_parts)
    stmt += sql.SQL(" LIMIT %s")
    params.append(limit)
    cur.execute(stmt, params)
    return rows_as_dict(cur)


def product_search(query: str = ""):
    """V0.5: read Item directly, then enrich only by same i_oid from Thing/Material.

    This avoids scanning every public table and returns quickly even on the old PostgreSQL 8.0 database.
    """
    schema = load_schema()
    if "Item" not in schema:
        raise RuntimeError('找不到 public."Item" 資料表')

    table_rows: dict[str, list[dict[str, Any]]] = {}
    with get_conn() as conn, conn.cursor() as cur:
        # First read real Item rows directly. Search only Item when a query is supplied.
        item_rows = _fetch_rows(cur, "Item", schema["Item"], limit=500, query=query)

        # Product number/name may live in Thing. If Item search did not find anything,
        # search Thing, then use its i_oid values to fetch matching Item rows.
        if query and not item_rows and "Thing" in schema:
            thing_hits = _fetch_rows(cur, "Thing", schema["Thing"], limit=500, query=query)
            hit_oids = [_decode_oid(r.get("i_oid")) for r in thing_hits if r.get("i_oid") not in (None, "")]
            if hit_oids:
                item_rows = _fetch_rows(cur, "Item", schema["Item"], limit=500, oids=hit_oids)
                table_rows["Thing"] = thing_hits

        if not item_rows:
            return []
        table_rows["Item"] = item_rows

        # Enrich only from the known product master companion tables.
        raw_oids = [_decode_oid(r.get("i_oid")) for r in item_rows if r.get("i_oid") not in (None, "")]
        for table in ("Thing", "Material", "Service"):
            cols = schema.get(table)
            if not cols or not has_oid(cols) or not raw_oids:
                continue
            try:
                rows = _fetch_rows(cur, table, cols, limit=1000, oids=raw_oids)
                if rows:
                    table_rows.setdefault(table, []).extend(rows)
            except Exception:
                conn.rollback()

    products = merge_rows(table_rows)
    unique = {}
    for p in products:
        unique.setdefault(p["id"] or p["_oid"], p)
    return list(unique.values())


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        rel = unquote(parsed.path).lstrip("/") or "index.html"
        return str((ROOT / rel).resolve())

    def log_message(self, fmt, *args):
        print("[WEB]", fmt % args)

    def send_json(self, payload: Any, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
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
                    cur.execute("SELECT current_database(), version()")
                    db, version = cur.fetchone()
                return self.send_json({
                    "ok": True,
                    "database": db,
                    "host": DB_CONFIG["host"],
                    "port": DB_CONFIG["port"],
                    "mode": "READ_ONLY_TEST",
                    "version": version,
                })
            if parsed.path == "/api/products":
                q = parse_qs(parsed.query).get("search", [""])[0].strip()
                products = product_search(q)
                return self.send_json({"ok": True, "count": len(products), "products": products})
            if parsed.path == "/api/schema/discovery":
                schema = load_schema()
                compact = {t: [c for c, _ in cols] for t, cols in schema.items() if t in {"Item", "Thing", "Material", "Stock", "Pricing"}}
                return self.send_json({"ok": True, "tables": compact})
            return super().do_GET()
        except Exception as exc:
            print("[API ERROR]", repr(exc))
            return self.send_json({"ok": False, "error": str(exc)}, 500)

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.send_json({"ok": False, "error": "V0.5 為唯讀產品測試版，尚未開放寫入 PostgreSQL。"}, 405)
        return self.send_error(405)


def main():
    print("=" * 66)
    print("BookWide ERP V0.5 PostgreSQL 產品直讀＋標籤套印")
    print(f"DB: {DB_CONFIG['host']}:{DB_CONFIG['port']} / {DB_CONFIG['dbname']}")
    print("模式: READ ONLY（不會寫入或刪除資料）")
    print("=" * 66)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT current_database(), version()")
            print("[OK] PostgreSQL 已連線：", cur.fetchone()[0])
    except Exception as exc:
        print("[FAIL] PostgreSQL 連線失敗：", exc)
        print("請先確認 D:\\PostgreSQL\\8.0\\data 已在 5433 啟動。")
        input("按 Enter 結束...")
        sys.exit(1)

    server = ThreadingHTTPServer((HOST, WEB_PORT), Handler)
    url = f"http://{HOST}:{WEB_PORT}/"
    print("[OK] ERP 網址：", url)
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
