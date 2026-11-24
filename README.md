# Próximo tren · Utrera

App web (instalable en el móvil) con los próximos trenes desde Utrera hacia Sevilla y hacia Lebrija y Cádiz, con retrasos de Renfe en directo, mapa de la línea, vuelta a Utrera desde cualquier estación, puntualidad de los últimos 7 días, avisos de Renfe (ascensores incluidos) y el tiempo.

Todo funciona gratis con GitHub: la web se publica en GitHub Pages y los datos los recoge GitHub Actions. No hace falta servidor.

## Cómo funciona

| Pieza | Qué hace | Dónde |
|---|---|---|
| `public/` | La app (HTML, CSS y JS sin dependencias, PWA) | GitHub Pages |
| `scripts/build_schedule.py` | Descarga los horarios GTFS de Renfe (Cercanías y Media Distancia) y guarda todos los trenes que paran en Utrera | Actions, cuando el horario tiene más de 20 h |
| `scripts/collect.py` | Consulta el tiempo real de Renfe (GTFS-RT) cada 30 s, guarda el retraso con el que sale cada tren de Utrera y los avisos | Actions, cada hora de 5:00 a 0:00 |
| rama `data` | `schedule.json`, `live.json`, `history.json`, `alerts.json` (un único commit que se reescribe) | GitHub |

En el navegador, los retrasos se piden a Renfe cada 20 s. Si el navegador no puede hablar directamente con Renfe, la app usa `live.json`, que el recolector publica cada minuto. Para tener siempre 20 s exactos se puede añadir el proxy opcional de `worker/` (Cloudflare Workers, gratis).

## Puesta en marcha

1. Crea un repositorio **público** vacío en GitHub (por ejemplo `tren-utrera`).
2. Sube este proyecto a la rama `main`.
3. En el repo: *Settings → Pages → Source: GitHub Actions*.
4. *Actions → «Datos Renfe» → Run workflow* con `rebuild = 1` para generar el horario por primera vez.
5. *Actions → «Publicar web» → Run workflow*.
6. La app queda en `https://TU_USUARIO.github.io/tren-utrera/`.

Ajustes en `public/config.js` (nombre, contacto, proxy, estaciones del mapa y del tiempo).

## Probar en local

```bash
python tests/make_fake_data.py tests/fake
DATA_DIR=public/data python scripts/build_schedule.py --cer tests/fake/cercanias.zip --ldmd tests/fake/ldmd.zip
cd public && python -m http.server 8000
# http://localhost:8000/?now=2026-11-24T07:30
```

## Notas

- App no oficial, sin relación con Renfe ni Adif. Datos abiertos de Renfe Operadora (CC BY 4.0). Tiempo: Open-Meteo.
- GitHub desactiva los workflows programados de repos públicos sin actividad en 60 días: si pasa, basta con volver a activarlo en la pestaña Actions.
