// @ts-nocheck
// Edge Function "avisar": manda una notificación al móvil de todo el equipo cuando alguien cambia un código.
// Secretos necesarios (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, AVISO_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

// ===== INICIO LÓGICA DEL MENSAJE (se prueba por separado) =====
function fechaCorta(f) { const p = f.split("-"); return Number(p[2]) + "/" + Number(p[1]); }

// cambios: filas de la tabla "cambios"; nombre: id -> nombre. Devuelve { title, body }.
function construirMensaje(cambios, nombre, actor) {
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
  return { title: "Turno D", body: mostrar.join("\n") };
}
// ===== FIN LÓGICA DEL MENSAJE =====

// ===== INICIO LÓGICA TERCIO (se prueba por separado) =====
function masDias(f, n) { const p = f.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function esAus(cods, c) { return !!(c && cods[c] && cods[c].tipo === "Ausencia Justificada"); }
function esVac(c) { return c === "V1" || c === "V2" || c === "V3"; }
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
// Orden de "quién debe quitarse": 1) permisos antes que vacaciones, 2) racha más corta, 3) más días ya disfrutados este año.
function recomendarQuitar(emps, cods, asig, dias, totales, f) {
  const lista = emps.filter((e) => esAus(cods, asig[e.id + "|" + f])).map((e) => {
    const c = asig[e.id + "|" + f];
    return { e, c, vac: esVac(c) ? 1 : 0, racha: rachaAusencia(cods, asig, dias, e.id, f), tot: totales[e.id] || 0 };
  });
  lista.sort((a, b) => a.vac - b.vac || a.racha - b.racha || b.tot - a.tot || a.e.orden - b.e.orden);
  return lista;
}
// antes: personas en el tercio ese día justo antes de este cambio. Devuelve el aviso, o null si no se acaba de superar.
function avisoTercio(emps, cods, asig, dias, totales, f, tercio, antes) {
  const ahora = contarTercio(emps, cods, asig, f);
  if (!(antes <= tercio && ahora > tercio)) return null;
  const r = recomendarQuitar(emps, cods, asig, dias, totales, f);
  let body = "Tercio superado el " + fechaCorta(f) + " (" + ahora + " de " + tercio + ")";
  if (r.length) body += ". Recomendado quitarse: " + r[0].e.nombre + " (" + r[0].c + ")";
  return { title: "Tercio superado", body };
}
// ===== FIN LÓGICA TERCIO =====

Deno.serve(async (req) => {
  if (req.headers.get("x-aviso-secret") !== Deno.env.get("AVISO_SECRET")) return new Response("no autorizado", { status: 401 });
  const { hecho_por } = await req.json();
  if (!hecho_por) return new Response("sin autor", { status: 400 });

  // Espera unos segundos: si alguien apunta varios días seguidos, salen todos en un solo aviso.
  await new Promise((r) => setTimeout(r, 4000));

  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  // Se "reclaman" los cambios pendientes de esa persona; si otra llamada ya lo hizo, aquí no queda nada y se termina.
  const { data: cambios, error } = await sb.from("cambios").update({ avisado: true })
    .eq("hecho_por", hecho_por).eq("avisado", false).select();
  if (error) return new Response(error.message, { status: 500 });
  if (!cambios || !cambios.length) return new Response("nada que avisar");

  const { data: emps } = await sb.from("empleados").select("id,nombre,orden");
  const nombre = Object.fromEntries((emps || []).map((e) => [e.id, e.nombre]));
  const { data: subs } = await sb.from("push_subs").select("*").neq("empleado_id", hecho_por);

  const msg = construirMensaje(cambios, nombre, hecho_por);
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
  const enviados = await enviar(subs, msg, "cambio-" + hecho_por);

  // Aviso a los responsables si algún día futuro acaba de superar el tercio
  let alertas = 0;
  try { alertas = await alertarTercio(sb, cambios, emps, enviar); } catch (e) { console.error("fallo en la alerta de tercio", e && e.message); }
  return new Response(`avisados ${enviados} de ${(subs || []).length}; alertas de tercio ${alertas}`);
});

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

async function alertarTercio(sb, cambios, emps, enviar) {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const { data: cd } = await sb.from("codigos").select("codigo,tipo");
  const cods = Object.fromEntries((cd || []).map((c) => [c.codigo, c]));
  // Tercio del distrito (si todavía no existe la tabla de distritos, 4)
  let tercio = 4;
  const { data: dd } = await sb.from("distritos").select("tercio").limit(1);
  if (dd && dd[0]) tercio = dd[0].tercio;
  // Variación por día: +1 si se añade una ausencia justificada, -1 si se quita
  const delta = new Map();
  for (const c of cambios) {
    if (c.fecha < hoy) continue;
    const d = (esAus(cods, c.codigo_despues) ? 1 : 0) - (esAus(cods, c.codigo_antes) ? 1 : 0);
    if (d !== 0) delta.set(c.fecha, (delta.get(c.fecha) || 0) + d);
  }
  if (!delta.size) return 0;
  const { data: resp } = await sb.from("empleados").select("id").eq("rol", "responsable");
  const ids = (resp || []).map((r) => r.id);
  const { data: subs } = await sb.from("push_subs").select("*").in("empleado_id", ids);
  if (!subs || !subs.length) return 0;
  const año = hoy.slice(0, 4);
  const pasadas = await leerTodo(() => sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", año + "-01-01").lt("fecha", hoy).order("fecha").order("empleado_id"));
  const totales = {};
  for (const r of pasadas) if (esAus(cods, r.codigo)) totales[r.empleado_id] = (totales[r.empleado_id] || 0) + 1;
  let enviadas = 0;
  for (const [f, d] of delta) {
    const [{ data: dias }, { data: filas }] = await Promise.all([
      sb.from("dias").select("fecha,turno").gte("fecha", masDias(f, -30)).lte("fecha", masDias(f, 30)),
      sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", masDias(f, -30)).lte("fecha", masDias(f, 30)),
    ]);
    const mapaDias = Object.fromEntries((dias || []).map((x) => [x.fecha, x.turno]));
    if (!["M", "T", "N"].includes(mapaDias[f])) continue;   // el tercio solo cuenta en días de servicio
    const asig = Object.fromEntries((filas || []).map((x) => [x.empleado_id + "|" + x.fecha, x.codigo]));
    const ahora = contarTercio(emps, cods, asig, f);
    const aviso = avisoTercio(emps, cods, asig, mapaDias, totales, f, tercio, ahora - d);
    if (aviso) enviadas += await enviar(subs, aviso, "tercio-" + f);
  }
  return enviadas;
}
