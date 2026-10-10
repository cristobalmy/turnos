// @ts-nocheck
// Edge Function "calendario": enlace personal (.ics) que cada persona añade al calendario de su móvil.
// Se despliega con "Verify JWT" desactivado: el acceso lo da el token secreto del enlace (?t=...).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ===== INICIO LÓGICA ICS (se prueba por separado) =====
const TURNO = { M: "Mañana", T: "Tarde", N: "Noche" };
function masDias(f, n) { const p = f.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
const sinGuiones = (f) => f.replace(/-/g, "");
function escapar(t) { return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
// dias: [{fecha, turno}], asig: { fecha: código }, cods: { código: { descripcion, cuenta_como_trabajo } }
function titulo(turno, codigo, cods) {
  const servicio = TURNO[turno];
  if (!codigo) return servicio || null;                       // día libre del ciclo y sin nada: sin evento
  const c = cods[codigo] || {};
  if (servicio && c.cuenta_como_trabajo) return servicio + " · " + codigo;   // trabaja con una tarea (PICO, FORM...)
  return codigo + (c.descripcion ? " · " + c.descripcion : "");              // ausencia u otro código
}
function construirIcs(nombre, dias, asig, cods, ahora) {
  const sello = ahora.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const l = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Turno D2//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapar("Turno D2 · " + nombre), "X-WR-TIMEZONE:Europe/Madrid",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const d of dias) {
    const t = titulo(d.turno, asig[d.fecha], cods);
    if (!t) continue;
    l.push("BEGIN:VEVENT", "UID:" + sinGuiones(d.fecha) + "-" + escapar(nombre).replace(/\s/g, "") + "@turnod2", "DTSTAMP:" + sello,
      "DTSTART;VALUE=DATE:" + sinGuiones(d.fecha), "DTEND;VALUE=DATE:" + sinGuiones(masDias(d.fecha, 1)),
      "SUMMARY:" + escapar(t), "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  l.push("END:VCALENDAR");
  return l.join("\r\n") + "\r\n";
}
// ===== FIN LÓGICA ICS =====

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") || "";
  if (token.length < 32) return new Response("enlace no válido", { status: 404 });
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: tk } = await sb.from("calendario_tokens").select("empleado_id").eq("token", token).maybeSingle();
  if (!tk) return new Response("enlace no válido", { status: 404 });
  const { data: emp } = await sb.from("empleados").select("nombre").eq("id", tk.empleado_id).single();
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const desde = masDias(hoy, -60), hasta = masDias(hoy, 730);
  const leer = async (tabla, cols, extra) => {
    const out = [];
    for (let i = 0; ; i += 1000) {
      let q = sb.from(tabla).select(cols).gte("fecha", desde).lte("fecha", hasta).order("fecha");
      if (extra) q = extra(q);
      const { data, error } = await q.range(i, i + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  };
  const dias = await leer("dias", "fecha,turno");
  const filas = await leer("asignaciones", "fecha,codigo", (q) => q.eq("empleado_id", tk.empleado_id));
  const { data: cd } = await sb.from("codigos").select("codigo,descripcion,cuenta_como_trabajo");
  const cods = Object.fromEntries((cd || []).map((c) => [c.codigo, c]));
  const ics = construirIcs(emp.nombre, dias, Object.fromEntries(filas.map((f) => [f.fecha, f.codigo])), cods, new Date());
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache" } });
});
