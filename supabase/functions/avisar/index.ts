// @ts-nocheck
// Edge Function "avisar": cuando alguien cambia un código, avisa al móvil de la gente de ese mismo distrito.
// El mensaje dice quién, qué código y qué día; si ese día queda por encima del tercio, lo avisa
// (y a los responsables, además, les dice quién debería quitarse).
// Secretos necesarios (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, AVISO_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

// ===== INICIO LÓGICA DEL MENSAJE (se prueba por separado) =====
const DSEM3 = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function fechaCorta(f) { const p = f.split("-").map(Number); return DSEM3[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + " " + p[2] + "/" + p[1]; }

// cambios: filas de la tabla "cambios"; nombre: id -> nombre. Devuelve { title, body }.
function construirMensaje(cambios, nombre, actor, titulo = "Tercio") {
  const grupos = new Map();
  for (const c of cambios) {
    const quito = !c.codigo_despues;
    const clave = c.empleado_id + "|" + (quito ? "-" + c.codigo_antes : c.codigo_despues);
    if (!grupos.has(clave)) grupos.set(clave, { empleado_id: c.empleado_id, quito, codigo: quito ? c.codigo_antes : c.codigo_despues, fechas: [] });
    grupos.get(clave).fechas.push(c.fecha);
  }
  const lineas = [];
  for (const g of grupos.values()) {
    g.fechas.sort();
    const cuando = g.fechas.length === 1
      ? (g.quito ? "del " : "el ") + fechaCorta(g.fechas[0])
      : g.fechas.length + " días (" + fechaCorta(g.fechas[0]) + " – " + fechaCorta(g.fechas[g.fechas.length - 1]) + ")";
    const de = nombre[g.empleado_id] || "?";
    const quien = g.empleado_id === actor ? de : (nombre[actor] || "?") + " → " + de;
    lineas.push(quien + (g.quito ? " quitó " : ": ") + g.codigo + " " + cuando);
  }
  const mostrar = lineas.slice(0, 4);
  if (lineas.length > 4) mostrar.push("y " + (lineas.length - 4) + " más");
  return { title: titulo, body: mostrar.join("\n") };
}
// ===== FIN LÓGICA DEL MENSAJE =====

// ===== INICIO LÓGICA TERCIO (se prueba por separado) =====
// Ciclo de 12 días (2 mañanas, 2 tardes, 2 noches, 6 libres). D empezó el 1/1/2026; cada turno A–F va 2 días por detrás del anterior.
function turnoCiclo(f, letra) {
  const p = f.split("-").map(Number), n = Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(2026, 0, 1)) / 864e5);
  const off = 2 * ("ABCDEF".indexOf(letra || "D") - 3);
  return "MMTTNNLLLLLL"[(((n - off) % 12) + 12) % 12];
}
function diasCiclo(desde, hasta, letra) { const o = {}; for (let f = desde; f <= hasta; f = masDias(f, 1)) o[f] = turnoCiclo(f, letra); return o; }
function masDias(f, n) { const p = f.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function esAus(cods, c) { return !!(c && cods[c] && cods[c].tipo === "Ausencia Justificada"); }
function esVac(c) { return c === "V1" || c === "V2" || c === "V3"; }
// Orden para quitarse: permisos (AP, CJ, CH, JS, SS, NAV…), todos al mismo nivel, y por último vacaciones: V3, V2 y V1.
function nivelQuitar(c) { return c === "V3" ? 2 : c === "V2" ? 3 : c === "V1" ? 4 : 0; }
// totales[id] = { p: días de AP + CJ + CH + JS disfrutados este año (un solo cómputo), v: días de vacaciones }; se usa el que corresponde al código.
function diasDe(totales, id, c) { const t = totales[id] || {}; return (esVac(c) ? t.v : t.p) || 0; }
// asig: "idEmpleado|fecha" -> código; dias: fecha -> turno (M T N S L)
function contarTercio(emps, cods, asig, f) { return emps.filter((e) => esAus(cods, asig[e.id + "|" + f])).length; }
// Días de servicio seguidos de ausencia que incluyen el día f (los días libres del ciclo no cortan la racha).
function rachaAusencia(cods, asig, dias, empId, f) {
  let n = 1;
  for (const paso of [-1, 1]) {
    for (let i = 1; i < 60; i++) {
      const g = masDias(f, paso * i), t = dias[g];
      if (!t) break;
      if (t === "S" || t === "L") continue;
      if (esAus(cods, asig[empId + "|" + g])) n++; else break;
    }
  }
  return n;
}
// Orden de "quién debe quitarse": 1) permisos (AP, CJ, CH, JS…), V3, V2 y V1; 2) dentro de cada uno, quien más días ha disfrutado este año
// (vacaciones o permisos, contados aparte); 3) orden de la lista.
function recomendarQuitar(emps, cods, asig, dias, totales, f) {
  const lista = emps.filter((e) => esAus(cods, asig[e.id + "|" + f])).map((e) => {
    const c = asig[e.id + "|" + f];
    return { e, c, vac: nivelQuitar(c), racha: rachaAusencia(cods, asig, dias, e.id, f), tot: diasDe(totales, e.id, c) };
  });
  lista.sort((a, b) => a.vac - b.vac || b.tot - a.tot || a.e.orden - b.e.orden);
  return lista;
}
// Línea que se añade al aviso si el día f queda por encima del tercio (o null si no).
// conQuitar: para los responsables, añade a quién(es) se recomienda quitar (tantas personas como sobren).
function lineaTercio(emps, cods, asig, dias, totales, f, tercio, conQuitar) {
  const n = contarTercio(emps, cods, asig, f);
  if (n <= tercio) return null;
  let t = "⚠️ Tercio superado el " + fechaCorta(f) + ": " + n + " de " + tercio;
  if (conQuitar) {
    const sobran = n - tercio, r = recomendarQuitar(emps, cods, asig, dias, totales, f).slice(0, sobran);
    if (r.length) t += ". " + (sobran > 1 ? "Deben quitarse " + sobran + ": " : "Debe quitarse: ") + r.map((x, i) => (sobran > 1 ? i + 1 + "º " : "") + x.e.nombre + " (" + x.c + ")").join(", ");
  }
  return t;
}
// ===== FIN LÓGICA TERCIO =====

Deno.serve(async (req) => {
  if (req.headers.get("x-aviso-secret") !== Deno.env.get("AVISO_SECRET")) return new Response("no autorizado", { status: 401 });
  const { hecho_por, prueba } = await req.json();
  if (prueba) return await avisoPrueba(prueba);
  if (!hecho_por) return new Response("sin autor", { status: 400 });

  // Espera unos segundos: si alguien apunta varios días seguidos, salen todos en un solo aviso.
  await new Promise((r) => setTimeout(r, 4000));

  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  // Se "reclaman" los cambios pendientes de esa persona; si otra llamada ya lo hizo, aquí no queda nada y se termina.
  const { data: cambios, error } = await sb.from("cambios").update({ avisado: true })
    .eq("hecho_por", hecho_por).eq("avisado", false).select();
  if (error) return new Response(error.message, { status: 500 });
  if (!cambios || !cambios.length) return new Response("nada que avisar");

  const { data: emps } = await sb.from("empleados").select("id,nombre,orden,rol,admin,activo,distrito_id");
  const nombre = Object.fromEntries((emps || []).map((e) => [e.id, e.nombre]));
  const distritoDe = Object.fromEntries((emps || []).map((e) => [e.id, e.distrito_id]));
  const { data: ds } = await sb.from("distritos").select("*");
  const distritos = Object.fromEntries((ds || []).map((d) => [d.id, d]));
  const { data: todasSubs } = await sb.from("push_subs").select("*").neq("empleado_id", hecho_por);

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT"), Deno.env.get("VAPID_PUBLIC_KEY"), Deno.env.get("VAPID_PRIVATE_KEY"));
  const enviar = async (lista, m, tag) => {
    const payload = JSON.stringify({ title: m.title, body: m.body, tag, url: "./" });
    let n = 0;
    await Promise.all((lista || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        n++;
      } catch (e) {
        // 404/410: el móvil ya no recibe avisos (desinstaló la app o los quitó): se borra
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
        else console.error("fallo al avisar", s.endpoint.slice(0, 40), e && e.statusCode, e && e.body);
      }
    }));
    return n;
  };
  // Cada distrito recibe solo los avisos de su gente
  const porDistrito = new Map();
  for (const c of cambios) {
    const d = distritoDe[c.empleado_id];
    if (!porDistrito.has(d)) porDistrito.set(d, []);
    porDistrito.get(d).push(c);
  }
  let enviados = 0, total = 0;
  const informe = [];
  for (const [did, lista] of porDistrito) {
    const dist = distritos[did] || { nombre: "Tercio", letra: "D", turno: "", tercio: 4 };
    const suyos = (emps || []).filter((e) => e.distrito_id === did && e.activo !== false);
    const resp = new Set(suyos.filter((e) => e.rol === "responsable" || e.admin).map((e) => e.id));
    const ids = new Set(suyos.map((e) => e.id));
    const subs = (todasSubs || []).filter((s) => ids.has(s.empleado_id));
    total += subs.length;
    const base = construirMensaje(lista, nombre, hecho_por, (dist.nombre + " " + (dist.turno || "")).trim());
    let ter = { todos: [], resp: [] };
    try { ter = await tercioDelCambio(sb, lista, suyos, dist); } catch (e) { console.error("fallo al mirar el tercio", e && e.message); }
    const conLineas = (lin) => (lin.length ? { title: base.title, body: base.body + "\n" + lin.join("\n") } : base);
    const tag = "cambio-" + hecho_por + "-" + did + "-" + Date.now();
    enviados += await enviar(subs.filter((s) => !resp.has(s.empleado_id)), conLineas(ter.todos), tag);
    enviados += await enviar(subs.filter((s) => resp.has(s.empleado_id)), conLineas(ter.resp), tag);
    informe.push(base.body.replace(/\n/g, " / ") + (ter.todos.length ? " / " + ter.todos.join(" / ") : ""));
  }
  return new Response(`avisados ${enviados} de ${total} móviles\n${informe.join("\n")}`);
});

// Prueba: manda un aviso a los móviles de una persona y cuenta lo que pasa (lo usa la comprobación de la migración 018).
async function avisoPrueba(empleadoId) {
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: subs, error } = await sb.from("push_subs").select("*").eq("empleado_id", empleadoId);
  if (error) return new Response("error leyendo móviles: " + error.message, { status: 500 });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT"), Deno.env.get("VAPID_PUBLIC_KEY"), Deno.env.get("VAPID_PRIVATE_KEY"));
  const payload = JSON.stringify({ title: "Tercio", body: "Aviso de prueba desde el servidor ✔", tag: "prueba-" + Date.now(), url: "./" });
  let ok = 0; const fallos = [];
  for (const s of subs || []) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); ok++; }
    catch (e) {
      fallos.push((e && e.statusCode) + " " + String((e && e.body) || (e && e.message) || "").slice(0, 80));
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
    }
  }
  return new Response(`prueba: ${(subs || []).length} móviles apuntados, ${ok} enviados` + (fallos.length ? "; fallos: " + fallos.join(" | ") : ""));
}

// Mira los días tocados (de hoy en adelante y de servicio) y devuelve las líneas de tercio superado:
// "todos" para el equipo y "resp" (con quién debe quitarse) para los responsables.
async function tercioDelCambio(sb, cambios, emps, dist) {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const fechas = [...new Set(cambios.map((c) => c.fecha))].filter((f) => f >= hoy).sort();
  const out = { todos: [], resp: [] };
  if (!fechas.length) return out;
  const { data: cd } = await sb.from("codigos").select("codigo,tipo");
  const cods = Object.fromEntries((cd || []).map((c) => [c.codigo, c]));
  const tercio = dist.tercio || 4, misIds = emps.map((e) => e.id);
  const desde = masDias(fechas[0], -30), hasta = masDias(fechas[fechas.length - 1], 30);
  const filas = await leerTodo(() => sb.from("asignaciones").select("empleado_id,fecha,codigo").in("empleado_id", misIds).gte("fecha", desde).lte("fecha", hasta).order("fecha").order("empleado_id"));
  const asig = Object.fromEntries(filas.map((x) => [x.empleado_id + "|" + x.fecha, x.codigo]));
  const dias = diasCiclo(desde, hasta, dist.letra);
  const año = hoy.slice(0, 4);
  const pasadas = await leerTodo(() => sb.from("asignaciones").select("empleado_id,fecha,codigo").in("empleado_id", misIds).gte("fecha", año + "-01-01").lt("fecha", hoy).order("fecha").order("empleado_id"));
  const totales = {};
  for (const r of pasadas) if (esAus(cods, r.codigo)) { const t = (totales[r.empleado_id] = totales[r.empleado_id] || { p: 0, v: 0 }); if (esVac(r.codigo)) t.v++; else if (["AP", "CJ", "CH", "JS"].includes(r.codigo)) t.p++; }
  for (const f of fechas.slice(0, 4)) {
    if (!["M", "T", "N"].includes(dias[f])) continue;   // el tercio solo cuenta en días de servicio
    const a = lineaTercio(emps, cods, asig, dias, totales, f, tercio, false);
    if (!a) continue;
    out.todos.push(a);
    out.resp.push(lineaTercio(emps, cods, asig, dias, totales, f, tercio, true));
  }
  return out;
}

async function leerTodo(consulta) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
