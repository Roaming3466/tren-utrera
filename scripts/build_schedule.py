"""Descarga los GTFS de Renfe y genera data/schedule.json con todos los trenes
que paran en Utrera (Cercanías C1 + Media Distancia/Regionales).

Uso: python scripts/build_schedule.py [--cer zip_o_url] [--ldmd zip_o_url] [--days 14]
"""
import argparse
import csv
import io
import os
import sys
import zipfile
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from common import (CERCANIAS_GTFS, DATA_DIR, HOME, LDMD_GTFS, display_name, fetch,  # noqa: E402
                    iso_day, norm, now_madrid, save_json, train_number, ts)

RAIL_TYPES = {"2"} | {str(x) for x in range(100, 118)}
REGIONAL_NAMES = {"md", "regional", "reg exp", "regional expres", "r expres", "media distancia", "rexp", "reg"}
DEFAULT_COLORS = {"C1": "78B4E1", "Regional": "7A2A8F"}


def open_zip(src):
    if os.path.exists(src):
        return zipfile.ZipFile(src)
    print(f"Descargando {src} …")
    return zipfile.ZipFile(io.BytesIO(fetch(src, timeout=180, binary=True)))


def rows(zf, name):
    names = {os.path.basename(n): n for n in zf.namelist()}
    if name not in names:
        return
    with zf.open(names[name]) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
        reader = csv.reader(text)
        header = None
        for r in reader:
            if header is None:
                header = [h.strip() for h in r]
                continue
            if not r:
                continue
            yield {header[i]: (r[i].strip() if i < len(r) else "") for i in range(len(header))}


def to_min(t):
    if not t:
        return None
    h, m, *s = t.split(":")
    return int(h) * 60 + int(m) + (int(s[0]) / 60 if s and s[0] else 0)


def active_days(zf, base, ndays):
    """service_id -> lista de índices de día (0 = base) en que circula."""
    out = {}
    days = [base + timedelta(days=i) for i in range(ndays)]
    for r in rows(zf, "calendar.txt") or []:
        try:
            start = datetime.strptime(r["start_date"], "%Y%m%d").date()
            end = datetime.strptime(r["end_date"], "%Y%m%d").date()
        except (KeyError, ValueError):
            continue
        wd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        s = out.setdefault(r["service_id"], set())
        for i, d in enumerate(days):
            if start <= d.date() <= end and r.get(wd[d.weekday()]) == "1":
                s.add(i)
    idx = {iso_day(d).replace("-", ""): i for i, d in enumerate(days)}
    for r in rows(zf, "calendar_dates.txt") or []:
        i = idx.get(r.get("date"))
        if i is None:
            continue
        s = out.setdefault(r["service_id"], set())
        if r.get("exception_type") == "1":
            s.add(i)
        elif r.get("exception_type") == "2":
            s.discard(i)
    return {k: sorted(v) for k, v in out.items() if v}


def line_label(feed, route):
    short = (route.get("route_short_name") or "").strip()
    longn = (route.get("route_long_name") or "").strip()
    if feed == "c":
        return short or "C"
    n = norm(short or longn)
    if n in REGIONAL_NAMES or n.startswith("md") or "regional" in n:
        return "Regional"
    return short.title() if short else "Regional"


def process(zf, feed, base, ndays, stations, st_index, stop_map, services_out, trips_out):
    stops = {}
    for r in rows(zf, "stops.txt"):
        stops[r["stop_id"]] = r
    home_ids = {sid for sid, r in stops.items() if norm(r.get("stop_name")) == HOME
                or norm(r.get("stop_name")).startswith(HOME + " ")}
    if not home_ids:
        print(f"  ! No encuentro {HOME} en {feed}")
        return
    print(f"  {feed}: paradas de {HOME}: {sorted(home_ids)}")
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips = {r["trip_id"]: r for r in rows(zf, "trips.txt")}
    svc_days = active_days(zf, base, ndays)

    # 1ª pasada: viajes que pasan por Utrera
    hit = set()
    for r in rows(zf, "stop_times.txt"):
        if r["stop_id"] in home_ids:
            hit.add(r["trip_id"])
    hit = {t for t in hit if t in trips and trips[t]["service_id"] in svc_days
           and routes.get(trips[t]["route_id"], {}).get("route_type", "2") in RAIL_TYPES}
    print(f"  {feed}: {len(hit)} viajes por {HOME}")

    # 2ª pasada: horarios completos de esos viajes
    st = {}
    for r in rows(zf, "stop_times.txt"):
        if r["trip_id"] in hit:
            st.setdefault(r["trip_id"], []).append(r)

    def station_idx(sid):
        s = stops.get(sid, {})
        name = display_name(s.get("stop_name") or sid)
        key = norm(name)
        if key not in st_index:
            try:
                lat, lon = float(s.get("stop_lat") or 0), float(s.get("stop_lon") or 0)
            except ValueError:
                lat = lon = 0
            st_index[key] = len(stations)
            stations.append({"n": name, "lat": round(lat, 5), "lon": round(lon, 5)})
        i = st_index[key]
        stop_map[sid] = i
        return i

    for tid, lst in st.items():
        lst.sort(key=lambda r: int(r.get("stop_sequence") or 0))
        t = trips[tid]
        route = routes.get(t["route_id"], {})
        seq = []
        for r in lst:
            arr = to_min(r.get("arrival_time")) or to_min(r.get("departure_time"))
            dep = to_min(r.get("departure_time")) or arr
            if arr is None:
                continue
            seq.append([station_idx(r["stop_id"]), round(arr, 1), round(dep, 1)])
        if len(seq) < 2:
            continue
        label = line_label(feed, route)
        color = (route.get("route_color") or "").upper()
        try:
            n = int(color, 16)
            light = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 215
        except ValueError:
            light = True
        if light:
            color = DEFAULT_COLORS.get(label, "7A2A8F")
        svc = f"{feed}:{t['service_id']}"
        services_out[svc] = svc_days[t["service_id"]]
        trips_out.append({
            "id": tid,
            "f": feed,
            "n": train_number(t.get("trip_short_name"), tid),
            "l": label,
            "c": color,
            "h": (t.get("trip_headsign") or "").strip(),
            "s": svc,
            "t": seq,
        })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cer", default=CERCANIAS_GTFS)
    ap.add_argument("--ldmd", default=LDMD_GTFS)
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--out", default=os.path.join(DATA_DIR, "schedule.json"))
    a = ap.parse_args()

    base = now_madrid().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    stations, st_index, stop_map, services, trips = [], {}, {}, {}, []
    ok = 0
    for feed, src in (("c", a.cer), ("m", a.ldmd)):
        if not src:
            continue
        try:
            process(open_zip(src), feed, base, a.days, stations, st_index, stop_map, services, trips)
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ! Error con {src}: {e}")
    if not trips:
        print("No hay trenes: no sobrescribo el horario anterior.")
        sys.exit(1)
    home = st_index.get(HOME)
    if home is None:
        home = next(i for k, i in st_index.items() if k.startswith(HOME))
    # Destino legible
    for t in trips:
        last = stations[t["t"][-1][0]]["n"]
        t["h"] = "Sevilla" if norm(last) in ("santa justa", "sevilla") else last
    trips.sort(key=lambda t: next(x[2] for x in t["t"] if x[0] == home) if any(x[0] == home for x in t["t"]) else 0)
    out = {
        "v": 1,
        "generated": ts(),
        "base": iso_day(base),
        "days": a.days,
        "home": home,
        "stations": stations,
        "stops": stop_map,
        "services": services,
        "trips": trips,
        "feeds": ok,
    }
    save_json(a.out, out)
    print(f"OK: {len(trips)} viajes, {len(stations)} estaciones → {a.out}")


if __name__ == "__main__":
    main()
