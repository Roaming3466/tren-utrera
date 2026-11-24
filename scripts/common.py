"""Utilidades compartidas por los scripts de datos (sólo librería estándar)."""
import json
import os
import re
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Madrid")
UA = "Mozilla/5.0 (tren-utrera app; +https://github.com)"
DATA_DIR = os.environ.get("DATA_DIR", "data")

# Fuentes oficiales de Renfe (data.renfe.com, licencia CC-BY 4.0)
CERCANIAS_GTFS = os.environ.get(
    "CERCANIAS_GTFS", "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip")
LDMD_GTFS = os.environ.get(
    "LDMD_GTFS", "https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip")
RT_TRIP_UPDATES = [u for u in os.environ.get(
    "RT_TRIP_UPDATES",
    "https://gtfsrt.renfe.com/trip_updates.json https://gtfsrt.renfe.com/trip_updates_LD.json").split() if u]
RT_VEHICLES = [u for u in os.environ.get(
    "RT_VEHICLES",
    "https://gtfsrt.renfe.com/vehicle_positions.json https://gtfsrt.renfe.com/vehicle_positions_LD.json").split() if u]
RT_ALERTS = [u for u in os.environ.get(
    "RT_ALERTS", "https://gtfsrt.renfe.com/alerts.json").split() if u]

# Nombre (normalizado) de la estación de referencia
HOME = os.environ.get("HOME_STATION", "utrera")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def display_name(raw):
    """Nombre corto y legible de una estación de Renfe."""
    s = (raw or "").strip()
    if s.isupper():
        s = s.title()
        s = re.sub(r"\b(De|Del|La|Las|Los|El|Y)\b", lambda m: m.group(1).lower(), s)
    m = re.match(r"^(.*)\s*\((las|los|la|el)\)\s*$", s, re.I)
    if m:
        s = f"{m.group(2).capitalize()} {m.group(1).strip()}"
    s = re.sub(r"^Sevilla[\s\-]+(?=\S)", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s)
    fixes = {
        "santa justa": "Santa Justa",
        "cabezas de san juan las": "Las Cabezas de San Juan",
        "las cabezas de san juan": "Las Cabezas de San Juan",
    }
    return fixes.get(norm(s), s[:1].upper() + s[1:])


def train_number(*vals):
    """Extrae el número de tren (4-5 cifras) de un trip_id o short_name."""
    for v in vals:
        if not v:
            continue
        v = str(v).strip()
        if re.fullmatch(r"\d{3,6}", v):
            return v.lstrip("0") or v
        m = re.findall(r"(?<!\d)(\d{5})(?!\d)", v)
        if m:
            return m[-1].lstrip("0")
    return None


def now_madrid():
    fake = os.environ.get("FAKE_NOW")  # sólo para pruebas: "2026-11-24T07:30"
    if fake:
        return datetime.fromisoformat(fake).replace(tzinfo=TZ)
    return datetime.now(TZ)


def day_minutes(dt):
    return dt.hour * 60 + dt.minute + dt.second / 60


def fetch(url, timeout=25, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def fetch_json(url, timeout=20):
    try:
        return json.loads(fetch(url, timeout))
    except Exception as e:  # noqa: BLE001
        print(f"  ! {url}: {e}")
        return None


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def g(obj, *keys, default=None):
    """Lee una clave aceptando camelCase o snake_case (JSON de protobuf)."""
    if not isinstance(obj, dict):
        return default
    for k in keys:
        if k in obj:
            return obj[k]
        snake = re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), k)
        if snake in obj:
            return obj[snake]
    return default


def text_of(translated):
    """Primer texto (preferiblemente en español) de un TranslatedString."""
    tr = g(translated, "translation", default=[]) or []
    if isinstance(tr, dict):
        tr = [tr]
    best = None
    for t in tr:
        lang = (g(t, "language") or "").lower()
        if lang.startswith("es"):
            return g(t, "text") or ""
        best = best or g(t, "text")
    return best or ""


def iso_day(dt):
    return dt.strftime("%Y-%m-%d")


def parse_day(s):
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=TZ)


def add_days(day_str, n):
    return iso_day(parse_day(day_str) + timedelta(days=n))


def ts():
    return int(time.time())
