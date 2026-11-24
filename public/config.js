// Ajustes de la app. Puedes cambiarlos sin tocar nada más.
window.APP_CONFIG = {
  NAME: "Próximo tren",
  PLACE: "Utrera",

  // De dónde sale el horario, el historial y el respaldo en directo.
  // Vacío = automático: la rama "data" de este repositorio en GitHub.
  DATA_URL: "",

  // Datos en directo de Renfe. La app prueba, por orden:
  //   1) PROXY (tu Cloudflare Worker, opcional; ver worker/renfe-proxy.js)
  //   2) Renfe directamente (si el navegador lo permite)
  //   3) live.json que publica el recolector cada minuto
  PROXY: "",
  RENFE_RT: "https://gtfsrt.renfe.com",
  REFRESH_S: 20,

  // Contacto ("Escríbeme"): enlace para abrir una incidencia en GitHub o un correo.
  CONTACT_URL: "",   // p. ej. "https://github.com/TU_USUARIO/tren-utrera/issues/new"
  CONTACT_EMAIL: "",

  // Esquema del mapa (de norte a sur) y estaciones del tiempo
  MAP: ["Santa Justa", "San Bernardo", "Virgen del Rocío", "Jardines de Hércules", "Bellavista",
        "Dos Hermanas", "Cantaelgallo", "Utrera", "Las Cabezas de San Juan", "Lebrija"],
  WEATHER: [
    { name: "Utrera", lat: 37.183, lon: -5.781 },
    { name: "Sevilla", lat: 37.389, lon: -5.984 },
    { name: "Lebrija", lat: 36.920, lon: -6.075 },
    { name: "Cádiz", lat: 36.527, lon: -6.288 },
  ],

  NEWS: [
    { id: "n3", date: "2026-11-24", text: "Nueva pestaña «Cómo va» con la puntualidad de los últimos 7 días." },
    { id: "n2", date: "2026-11-24", text: "Mapa de la línea con la posición de cada tren." },
    { id: "n1", date: "2026-11-24", text: "Primera versión: próximos trenes desde Utrera en directo." },
  ],
};
