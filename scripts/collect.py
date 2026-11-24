"""Recolector en directo: consulta los feeds GTFS-RT de Renfe cada INTERVAL
segundos durante DURATION segundos y guarda en DATA_DIR:

  live.json     – retrasos, supresiones y posiciones de los trenes de Utrera
  history.json  – retraso con el que salió cada tren de Utrera (7 días)
  alerts.json   – avisos de Renfe que afectan a Utrera / la línea

Si PUSH=1, después de cada PUSH_EVERY segundos hace commit --amend y push
--force a la rama de datos (así la rama no crece).
"""
import os
import subprocess
import sys
import time
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))
from common import (DATA_DIR, RT_ALERTS, RT_TRIP_UPDATES, RT_VEHICLES, day_minutes, fetch_json, g,  # noqa: E402
                    iso_day, load_json, now_madrid, parse_day, save_json, text_of, train_number, ts)

INTERVAL = int(os.environ.get("INTERVAL", "30"))
DURATION = int(os.environ.get("DURATION", "0"))  # 0 = una sola pasada
PUSH = os.environ.get("PUSH") == "1"
PUSH_EVERY = int(os.environ.get("PUSH_EVERY", "60"))
KEEP_DAYS = 8
ON_TIME = 3  # minutos de margen


def entities(feeds):
    out = []
    for url in feeds:
        j = fetch_json(url)
        if j:
            out.extend(g(j, "entity", default=[]) or [])
    return out


def rt_index(tu_entities, veh_entities):
    """trip_id / nº de tren -> datos en directo."""
    by_id, by_num = {}, {}
    for e in tu_entities:
        tu = g(e, "tripUpdate")
        if not tu:
            continue
        trip = g(tu, "trip", default={})
        tid = g(trip, "tripId") or g(e, "id")
        rec = {"tid": tid}
        rel = (g(trip, "scheduleRelationship") or "").upper()
        if rel in ("CANCELED", "CANCELLED", "DELETED", "3", "5"):
            rec["x"] = 1
        d = g(tu, "delay")
        if d is not None:
            rec["d"] = int(d)
        stus = []
        for s in g(tu, "stopTimeUpdate", default=[]) or []:
            dd = g(g(s, "departure", default={}), "delay")
            if dd is None:
                dd = g(g(s, "arrival", default={}), "delay")
            tt = g(g(s, "departure", default={}), "time") or g(g(s, "arrival", default={}), "time")
            srel = (g(s, "scheduleRelationship") or "").upper()
            stus.append([g(s, "stopId"), None if dd is None else int(dd),
                         None if tt is None else int(tt), 1 if srel == "SKIPPED" else 0])
        if stus:
            rec["u"] = stus
            if "d" not in rec:
                known = [s[1] for s in stus if s[1] is not None]
                if known:
                    rec["d"] = known[0]
        by_id[tid] = rec
        n = train_number(tid)
        if n:
            by_num[n] = rec
    for e in veh_entities:
        v = g(e, "vehicle")
        if not v:
            continue
        trip = g(v, "trip", default={})
        tid = g(trip, "tripId")
        pos = g(v, "position", default={})
        veh = {
            "st": g(v, "currentStatus") or "",
            "sid": g(v, "stopId"),
            "lat": g(pos, "latitude"),
            "lon": g(pos, "longitude"),
            "ts": g(v, "timestamp"),
            "lbl": g(g(v, "vehicle", default={}), "label"),
        }
        rec = by_id.get(tid)
        if rec is None:
            n = train_number(tid, veh["lbl"])
            rec = by_num.get(n) if n else None
        if rec is None:
            rec = {"tid": tid}
            by_id[tid] = rec
            n = train_number(tid, veh["lbl"])
            if n:
                by_num.setdefault(n, rec)
        rec["v"] = veh
    return by_id, by_num


def find_rt(trip, by_id, by_num):
    return by_id.get(trip["id"]) or (by_num.get(trip["n"]) if trip.get("n") else None)


def home_delay(trip, rec, sched, home):
    if rec is None:
        return None
    stop_ids = {sid for sid, i in sched["stops"].items() if i == home}
    for sid, d, _t, _skip in rec.get("u", []):
        if sid in stop_ids and d is not None:
            return d
    return rec.get("d")


def collect_once(sched, hist, alerts_state):
    now = now_madrid()
    tu = entities(RT_TRIP_UPDATES)
    veh = entities(RT_VEHICLES)
    by_id, by_num = rt_index(tu, veh)
    home = sched["home"]
    base = parse_day(sched["base"])
    live = {}
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    nowm = day_minutes(now)
    for back in (0, 1):  # servicios de hoy y de ayer (pasada la medianoche)
        day = today - timedelta(days=back)
        di = (day - base).days
        dstr = iso_day(day)
        for t in sched["trips"]:
            if di not in sched["services"].get(t["s"], []):
                continue
            seq = t["t"]
            first, last = seq[0][2], seq[-1][1]
            rel_now = nowm + back * 1440
            if not (first - 45 <= rel_now <= last + 90):
                continue
            rec = find_rt(t, by_id, by_num)
            if rec:
                live[t["id"]] = {k: rec[k] for k in ("d", "x", "v", "u") if k in rec}
            hi = next((i for i, x in enumerate(seq) if x[0] == home), None)
            if hi is None or hi == len(seq) - 1:
                continue  # sólo trenes que SALEN de Utrera
            sdep = seq[hi][2]
            key = f"{dstr}|{t['id']}"
            h = hist.get(key)
            if h and h.get("fz"):
                continue
            delay = home_delay(t, rec, sched, home)
            dmin = None if delay is None else round(delay / 60)
            if h is None:
                if not (sdep - 60 <= rel_now <= sdep + 30):
                    continue
                nxt = seq[hi + 1][0]
                h = hist[key] = {
                    "day": dstr, "id": t["id"], "n": t.get("n"), "l": t["l"], "h": t["h"],
                    "dir": "N" if sched["stations"][nxt]["lat"] > sched["stations"][home]["lat"] else "S",
                    "s": int(sdep), "dl": None, "x": 0,
                }
            if rec and rec.get("x"):
                h["x"] = 1
            if dmin is not None:
                h["dl"] = dmin
            # Se congela cuando el tren ya ha salido de Utrera
            if rel_now > sdep + max(h["dl"] or 0, 0) + 3:
                if h["dl"] is not None or h["x"] or rel_now > sdep + 120:
                    h["fz"] = 1
    # Limpieza del historial
    cutoff = iso_day(today - timedelta(days=KEEP_DAYS))
    for k in [k for k, v in hist.items() if v["day"] < cutoff]:
        del hist[k]
    # Avisos
    home_ids = {sid for sid, i in sched["stops"].items() if i == home}
    our_stops = set(sched["stops"].keys())
    seen = set()
    for e in entities(RT_ALERTS):
        a = g(e, "alert")
        if not a:
            continue
        aid = str(g(e, "id"))
        head = text_of(g(a, "headerText", default={}))
        desc = text_of(g(a, "descriptionText", default={}))
        ents = g(a, "informedEntity", default=[]) or []
        stops = {g(x, "stopId") for x in ents if g(x, "stopId")}
        blob = f"{head} {desc}".lower()
        relevant = bool(stops & home_ids) or "utrera" in blob or (
            bool(stops & our_stops) and ("c1" in blob or "sevilla" in blob))
        if not relevant:
            continue
        seen.add(aid)
        st = alerts_state.setdefault(aid, {"first": ts()})
        periods = g(a, "activePeriod", default=[]) or []
        start = min((int(g(p, "start") or 0) for p in periods), default=0) or None
        st.update({"h": head, "d": desc, "last": ts(), "on": 1, "start": start,
                   "home": 1 if (stops & home_ids or "utrera" in blob) else 0})
    for aid, st in alerts_state.items():
        if aid not in seen:
            st["on"] = 0
    for aid in [k for k, v in alerts_state.items() if not v["on"] and v["last"] < ts() - KEEP_DAYS * 86400]:
        del alerts_state[aid]
    return {"ts": ts(), "n_rt": len(tu), "trips": live}


def git(*args):
    return subprocess.run(["git", "-C", DATA_DIR, *args], capture_output=True, text=True)


def push():
    git("add", "-A")
    has_head = git("rev-parse", "--verify", "HEAD").returncode == 0
    msg = f"datos {now_madrid():%Y-%m-%d %H:%M}"
    r = git("commit", "--amend", "-m", msg) if has_head else git("commit", "-m", msg)
    if r.returncode != 0 and "nothing" not in (r.stdout + r.stderr):
        print(r.stdout, r.stderr)
    p = git("push", "--force", "origin", "HEAD:data")
    print("  push:", "ok" if p.returncode == 0 else p.stderr.strip()[:200])


def main():
    sched = load_json(os.path.join(DATA_DIR, "schedule.json"), None)
    if not sched:
        print("Falta data/schedule.json: ejecuta antes build_schedule.py")
        sys.exit(1)
    hist = load_json(os.path.join(DATA_DIR, "history.json"), {})
    alerts = load_json(os.path.join(DATA_DIR, "alerts.json"), {})
    end = time.time() + DURATION
    last_push = 0
    while True:
        t0 = time.time()
        try:
            live = collect_once(sched, hist, alerts)
            save_json(os.path.join(DATA_DIR, "live.json"), live)
            save_json(os.path.join(DATA_DIR, "history.json"), hist)
            save_json(os.path.join(DATA_DIR, "alerts.json"), alerts)
            print(f"{now_madrid():%H:%M:%S} entidades RT={live['n_rt']} trenes={len(live['trips'])} hist={len(hist)}")
        except Exception as e:  # noqa: BLE001
            print("  ! error en la pasada:", e)
        if PUSH and (time.time() - last_push >= PUSH_EVERY or time.time() + INTERVAL > end):
            push()
            last_push = time.time()
        if time.time() + INTERVAL > end:
            break
        time.sleep(max(1, INTERVAL - (time.time() - t0)))


if __name__ == "__main__":
    main()
