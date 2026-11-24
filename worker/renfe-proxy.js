// Proxy opcional (Cloudflare Workers, gratis) para tener datos de Renfe cada 20 s
// en el navegador aunque Renfe no permita CORS.
// 1. dash.cloudflare.com → Workers & Pages → Create → "Hello World" → Edit code
// 2. Pega este archivo, Deploy, y copia la URL (https://algo.workers.dev)
// 3. Pon esa URL en public/config.js → PROXY
const ALLOWED = /^\/(trip_updates|vehicle_positions|alerts)(_LD)?\.json$/;

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!ALLOWED.test(url.pathname)) return new Response("No", { status: 404, headers: cors });
    const upstream = await fetch("https://gtfsrt.renfe.com" + url.pathname, {
      cf: { cacheTtl: 15, cacheEverything: true },
      headers: { "User-Agent": "tren-utrera-proxy" },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=15" },
    });
  },
};
