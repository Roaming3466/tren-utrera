"""Genera GTFS y GTFS-RT falsos con el formato de Renfe para probar el pipeline."""
import io
import json
import os
import random
import sys
import time
import zipfile
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

OUT = sys.argv[1] if len(sys.argv) > 1 else "tests/fake"
os.makedirs(OUT, exist_ok=True)
random.seed(4)
TZ = ZoneInfo("Europe/Madrid")

C1 = [("51100", "Lora del Río", 37.659, -5.528, 0), ("51101", "Guadajoz", 37.618, -5.611, 13),
      ("51102", "Los Rosales", 37.537, -5.775, 32), ("51103", "Cantillana", 37.606, -5.826, 36),
      ("51104", "Brenes", 37.549, -5.871, 42), ("51105", "El Cáñamo", 37.497, -5.946, 49),
      ("51106", "La Rinconada", 37.488, -5.982, 51), ("51003", "Sevilla-Santa Justa", 37.392, -5.975, 75),
      ("51111", "Sevilla-San Bernardo", 37.378, -5.979, 80), ("51112", "Virgen del Rocío", 37.367, -5.987, 83),
      ("51113", "Jardines de Hércules", 37.355, -5.970, 86), ("51114", "Bellavista", 37.330, -5.968, 89),
      ("51200", "Dos Hermanas", 37.284, -5.922, 93), ("51201", "Cantaelgallo", 37.240, -5.890, 97),
      ("51300", "Utrera", 37.183, -5.781, 102), ("51301", "Cabezas de San Juan (Las)", 36.983, -5.940, 116),
      ("51302", "Lebrija", 36.920, -6.075, 129)]
MD = [("51003", "SEVILLA-SANTA JUSTA", 37.392, -5.975, 0), ("51200", "DOS HERMANAS", 37.284, -5.922, 13),
      ("51300", "UTRERA", 37.183, -5.781, 24), ("51301", "LAS CABEZAS DE SAN JUAN", 36.983, -5.940, 38),
      ("51302", "LEBRIJA", 36.920, -6.075, 47), ("51400", "JEREZ DE LA FRONTERA", 36.690, -6.128, 63),
      ("51405", "CADIZ", 36.528, -6.288, 95)]
NORTH_MD = {"Córdoba": [("50500", "CORDOBA-JULIO ANGUITA", 37.888, -4.789, -80)],
            "Jaén": [("03100", "JAEN", 37.770, -3.790, -190)]}


def hhmm(m):
    m = int(round(m))
    return f"{m // 60:02d}:{m % 60:02d}:00"


def write_zip(path, files, pad=False):
    with zipfile.ZipFile(path, "w") as z:
        for name, rows in files.items():
            buf = io.StringIO()
            for r in rows:
                buf.write(",".join((f" {v} " if pad else str(v)) for v in r) + "\r\n")
            z.writestr(name, "﻿" + buf.getvalue())


today = datetime.now(TZ).date()
start, end = (today - timedelta(days=30)).strftime("%Y%m%d"), (today + timedelta(days=60)).strftime("%Y%m%d")

# ---------- Cercanías ----------
stops = [["stop_id", "stop_name", "stop_lat", "stop_lon"]] + [[s[0], s[1], s[2], s[3]] for s in C1]
routes = [["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"],
          ["30T0001C1", "1071", "C1", "Lora del Río - Lebrija", "2", "78B4E1"]]
trips = [["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name"]]
st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]]
n = 23500
first_dep_utrera = 6 * 60
for k in range(40):
    # Utrera → Lora del Río (norte)
    dep_u = first_dep_utrera + k * 28 + random.choice([0, 2, 5])
    tid = f"3030N{n}C1"
    trips.append(["30T0001C1", "LABOR", tid, "", n])
    seq = list(reversed(C1[:15]))
    for i, s in enumerate(seq):
        t = dep_u + (102 - s[4])
        st.append([tid, hhmm(t), hhmm(t + (0 if i in (0, len(seq) - 1) else 0.5)), s[0], i + 1])
    n += 2
for k in range(36):
    # Lora / Santa Justa → Utrera (→ Lebrija a veces)
    origin = 0 if k % 3 else 7
    dep0 = 5 * 60 + 5 + k * 30
    tid = f"3030S{n + 1}C1"
    last = 17 if k % 4 == 0 else 15
    trips.append(["30T0001C1", "LABOR", tid, "", n + 1])
    base = C1[origin][4]
    for i, s in enumerate(C1[origin:last]):
        t = dep0 + (s[4] - base)
        st.append([tid, hhmm(t), hhmm(t + 0.5), s[0], i + 1])
    n += 2
cal = [["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
       ["LABOR", 1, 1, 1, 1, 1, 1, 1, start, end]]
write_zip(f"{OUT}/cercanias.zip", {"stops.txt": stops, "routes.txt": routes, "trips.txt": trips,
                                    "stop_times.txt": st, "calendar.txt": cal}, pad=True)

# ---------- Media distancia ----------
stops = [["stop_id", "stop_name", "stop_lat", "stop_lon"]] + [[s[0], s[1], s[2], s[3]] for s in MD]
for v in NORTH_MD.values():
    stops += [[s[0], s[1], s[2], s[3]] for s in v]
stops.append(["60000", "MADRID-PUERTA DE ATOCHA", 40.406, -3.690])
routes = [["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"],
          ["MD1", "1071", "MD", "Sevilla - Cádiz", "2", ""],
          ["AVE1", "1071", "AVE", "Madrid - Sevilla", "2", ""]]
trips = [["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name"]]
st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]]
for i, h in enumerate([7 * 60 + 7 - 24, 8 * 60 + 58 - 24, 10 * 60 + 23 - 24, 11 * 60 + 31 - 24, 13 * 60 + 6 - 24,
                       16 * 60 + 13 - 24, 18 * 60 + 40 - 24, 22 * 60 + 23 - 24]):
    tid = f"13{i:02d}0X{13400 + i * 2}"
    trips.append(["MD1", "MDALL", tid, "Cádiz", 13400 + i * 2])
    for j, s in enumerate(MD):
        st.append([tid, hhmm(h + s[4]), hhmm(h + s[4] + 1), s[0], j + 1])
for i, (h, dest) in enumerate([(7 * 60 + 2, "Jaén"), (8 * 60 + 4, "Córdoba"), (12 * 60 + 30, "Córdoba"),
                                (17 * 60, "Córdoba"), (19 * 60 + 45, "Jaén")]):
    tid = f"13{i:02d}1X{13501 + i * 2}"
    trips.append(["MD1", "MDALL", tid, dest, 13501 + i * 2])
    seq = [(s[0], h + (24 - s[4])) for s in reversed(MD[:3])]
    for s in NORTH_MD[dest]:
        seq.append((s[0], h + 24 + abs(s[4])))
    for j, (sid, t) in enumerate(seq):
        st.append([tid, hhmm(t), hhmm(t + 1), sid, j + 1])
trips.append(["AVE1", "MDALL", "AVE02100", "Madrid", "2100"])
st += [["AVE02100", "07:00:00", "07:00:00", "51003", 1], ["AVE02100", "09:30:00", "09:30:00", "60000", 2]]
cal = [cal[0], ["MDALL", 1, 1, 1, 1, 1, 1, 1, start, end]]
write_zip(f"{OUT}/ldmd.zip", {"stops.txt": stops, "routes.txt": routes, "trips.txt": trips,
                               "stop_times.txt": st, "calendar.txt": cal})

# ---------- GTFS-RT (formato JSON de gtfsrt.renfe.com) ----------
now = int(time.time())
ent = []
tids = [r[2] for r in trips[1:]]
c_tids = [f"3030N{23500 + 2 * k}C1" for k in range(40)] + [f"3030S{23501 + 2 * k}C1" for k in range(36)]
for tid in c_tids + tids:
    r = random.random()
    if r < 0.55:
        e = {"id": tid, "tripUpdate": {"trip": {"tripId": tid}, "delay": random.choice([0, 0, 60, 120, 240, 420, 900])}}
    elif r < 0.6:
        e = {"id": tid, "tripUpdate": {"trip": {"tripId": tid, "scheduleRelationship": "CANCELED"}}}
    else:
        continue
    ent.append(e)
json.dump({"header": {"gtfsRealtimeVersion": "2.0", "timestamp": str(now)}, "entity": ent},
          open(f"{OUT}/trip_updates.json", "w"))
veh = [{"id": "V1", "vehicle": {"trip": {"tripId": c_tids[3]}, "position": {"latitude": 37.30, "longitude": -5.95},
                                "currentStatus": "IN_TRANSIT_TO", "stopId": "51200", "timestamp": str(now),
                                "vehicle": {"id": "23506", "label": "C1-23506-PLATF.(1)"}}}]
json.dump({"header": {"timestamp": str(now)}, "entity": veh}, open(f"{OUT}/vehicle_positions.json", "w"))
alerts = [{"id": "AVISO_1", "alert": {
    "activePeriod": [{"start": str(now - 5 * 86400)}],
    "informedEntity": [{"stopId": "51300"}],
    "headerText": {"translation": [{"text": "Ascensor fuera de servicio en Utrera", "language": "es"}]},
    "descriptionText": {"translation": [{"text": "El ascensor de acceso a las vías 4 y 6 de la estación de Utrera está fuera de servicio por motivos técnicos. Si necesita asistencia, llame al 954 485 672.", "language": "es"}]}}},
    {"id": "AVISO_2", "alert": {"informedEntity": [{"stopId": "99999"}],
                                "headerText": {"translation": [{"text": "Obras en Bilbao", "language": "es"}]}}}]
json.dump({"header": {"timestamp": str(now)}, "entity": alerts}, open(f"{OUT}/alerts.json", "w"))
print("ok", OUT)
