import os
from pathlib import Path

BASE = Path(r"D:\bookwide_cloudflare\EduEnglish\data\pro")

# 只保留這些 prefix（教材）
KEEP_PREFIX = (
    "biz-", "edu-", "eng-", "fin-", "hc-", "law-",
    "life-", "mfg-", "mkt-", "svc-", "stu-", "it-",
    "ted-talk-", "premium-guide-"
)

# 明確要刪的（安全）
DELETE_NAMES = {
    "business","education","engineering","finance","healthcare",
    "legal","lifestyle","manufacturing","marketing","service",
    "student","ted_talk","premium_guide",
    "accountant","bank_clerk","brand_specialist","business_trip",
    "clinic_staff","college","cram_teacher","customer_service",
    "daily","elementary_teacher"
}

deleted = []

for p in BASE.iterdir():
    if not p.is_dir():
        continue

    name = p.name.lower()

    # 保留正常教材
    if name.startswith(KEEP_PREFIX):
        continue

    # 刪錯資料夾
    if name in DELETE_NAMES:
        print("DELETE:", p)
        try:
            import shutil
            shutil.rmtree(p)
            deleted.append(name)
        except Exception as e:
            print("FAIL:", e)

print("\nDONE")
print("Deleted:", len(deleted))