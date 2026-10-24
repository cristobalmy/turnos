// @ts-nocheck
// Edge Function "pico": el día de antes a las 10:00 (hora de Madrid) avisa a los responsables de cada distrito
// si al día siguiente hace falta PICO y a quién le toca. No pone nada: el PICO lo sigue poniendo un responsable a mano.
// La llama Supabase Cron (migración 017; hora cambiada a las 10:00 en la 020). Verify JWT desactivado: la protege el mismo secreto que "avisar" (AVISO_SECRET).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

// ===== INICIO LÓGICA PICO (se prueba por separado) =====
function masDias(f, n) { const p = f.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function fechaCorta(f) { const p = f.split("-"); return Number(p[2]) + "/" + Number(p[1]); }
// Ciclo de 12 días (2 mañanas, 2 tardes, 2 noches, 6 libres). D empezó el 1/1/2026; cada turno A–F va 2 días por detrás del anterior.
function turnoCiclo(f, letra) {
  const p = f.split("-").map(Number), n = Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(2026, 0, 1)) / 864e5);
  const off = 2 * ("ABCDEF".indexOf(letra || "D") - 3);
  return "MMTTNNLLLLLL"[(((n - off) % 12) + 12) % 12];
}
const NOMBRE_TURNO = { M: "mañana", T: "tarde", N: "noche" };
const DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
// emps: personas activas del distrito; asig: idEmpleado -> código ese día; cods: código -> { cuenta_como_trabajo };
// ultimo: idEmpleado -> fecha de su último PICO (de cualquier año: la rotación sigue de un año a otro).
// Devuelve null si no hay que avisar, o { title, body }.
function avisoPico(dist, f, emps, asig, cods, ultimo) {
  const t = turnoCiclo(f, dist.letra);
  if (!NOMBRE_TURNO[t]) return null;                                           // día libre del ciclo
  if (emps.some((e) => asig[e.id] === "PICO")) return null;                    // ya está puesto
  const trabaja = (id) => { const c = asig[id]; return !c || !!(cods[c] && cods[c].cuenta_como_trabajo); };
  const n = emps.filter((e) => trabaja(e.id)).length;
  if (n % 2 === 0) return null;                                                // con número par no hace falta
  const porId = Object.fromEntries(emps.map((e) => [e.id, e]));
  const cand = emps.filter((e) => {
    if (e.hace_pico === false || asig[e.id]) return false;                      // libre y que haga PICO
    if (!e.pareja_id || !porId[e.pareja_id]) return true;                       // sin binomio (o de baja): siempre candidato
    const cp = asig[e.pareja_id];
    return !!(cp && cods[cp] && !cods[cp].cuenta_como_trabajo);                 // con su binomio ausente
  }).map((e) => ({ e, u: ultimo[e.id] || "" }))
    .sort((a, b) => (a.u === b.u ? a.e.orden - b.e.orden : (a.u < b.u ? -1 : 1)));
  const p = f.split("-").map(Number), dia = DIA[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  let body = `Mañana ${dia} ${fechaCorta(f)} (${NOMBRE_TURNO[t]}) trabajan ${n}: hace falta PICO. `;
  if (cand.length) {
    body += "Recomendado: " + cand[0].e.nombre;
    if (cand.length > 1) body += " (luego " + cand.slice(1, 3).map((x) => x.e.nombre).join(", ") + ")";
  } else body += "No hay ningún candidato libre con su binomio ausente.";
  return { title: `PICO mañana · ${dist.nombre} ${dist.turno || ""}`.trim(), body };
}
// ===== FIN LÓGICA PICO =====

Deno.serve(async (req) => {
  if (req.headers.get("x-aviso-secret") !== Deno.env.get("AVISO_SECRET")) return new Response("no autorizado", { status: 401 });
  let opc = {};
  try { opc = await req.json(); } catch (e) { /* sin cuerpo */ }
  // El cron llama a las 8:00 y a las 9:00 UTC; solo se avisa la que cae a las 10:00 en Madrid (verano e invierno).
  const horaMadrid = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }));
  if (!opc.prueba && horaMadrid !== 10) return new Response("no es la hora (" + horaMadrid + ")");

  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const manana = masDias(hoy, 1);
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const [{ data: ds }, { data: emps }, { data: cd }, { data: filas }, { data: picos }, { data: subs }] = await Promise.all([
    sb.from("distritos").select("*"),
    sb.from("empleados").select("*").eq("activo", true),
    sb.from("codigos").select("codigo,cuenta_como_trabajo"),
    sb.from("asignaciones").select("empleado_id,codigo").eq("fecha", manana),
    sb.from("asignaciones").select("empleado_id,fecha").eq("codigo", "PICO").lt("fecha", manana).order("fecha", { ascending: false }).limit(5000),
    sb.from("push_subs").select("*"),
  ]);
  const cods = Object.fromEntries((cd || []).map((c) => [c.codigo, c]));
  const asig = Object.fromEntries((filas || []).map((x) => [x.empleado_id, x.codigo]));
  const ultimo = {};
  for (const x of picos || []) if (!ultimo[x.empleado_id]) ultimo[x.empleado_id] = x.fecha;

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT"), Deno.env.get("VAPID_PUBLIC_KEY"), Deno.env.get("VAPID_PRIVATE_KEY"));
  const informe = [];
  for (const dist of ds || []) {
    const suyos = (emps || []).filter((e) => e.distrito_id === dist.id && !e.fuera).sort((a, b) => a.orden - b.orden);   // "fuera temporalmente" no cuenta
    const aviso = avisoPico(dist, manana, suyos, asig, cods, ultimo);
    if (!aviso) { informe.push(dist.nombre + ": sin aviso"); continue; }
    // A los responsables del distrito (en prueba, solo al administrador)
    const ids = new Set(suyos.filter((e) => (opc.prueba ? e.admin : e.rol === "responsable")).map((e) => e.id));
    const destino = (subs || []).filter((s) => ids.has(s.empleado_id));
    const payload = JSON.stringify({ title: aviso.title, body: aviso.body, tag: "pico-" + dist.id + "-" + manana, url: "./" });
    let n = 0;
    await Promise.all(destino.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); n++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }));
    informe.push(`${dist.nombre}: ${aviso.body} → avisados ${n}`);
  }
  return new Response(informe.join("\n") || "no hay distritos");
});
