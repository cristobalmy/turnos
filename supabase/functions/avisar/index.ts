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

  const { data: emps } = await sb.from("empleados").select("id,nombre");
  const nombre = Object.fromEntries((emps || []).map((e) => [e.id, e.nombre]));
  const { data: subs } = await sb.from("push_subs").select("*").neq("empleado_id", hecho_por);

  const msg = construirMensaje(cambios, nombre, hecho_por);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT"), Deno.env.get("VAPID_PUBLIC_KEY"), Deno.env.get("VAPID_PRIVATE_KEY"));
  const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: "cambio-" + hecho_por, url: "./" });

  let enviados = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      enviados++;
    } catch (e) {
      // 404/410: el móvil ya no recibe avisos (desinstaló la app o los quitó): se borra
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("fallo al avisar", s.endpoint.slice(0, 40), e && e.statusCode, e && e.body);
    }
  }));
  return new Response(`avisados ${enviados} de ${(subs || []).length}`);
});
