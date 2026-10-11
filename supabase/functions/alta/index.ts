// @ts-nocheck
// Edge Function "alta": el administrador da de alta a una persona desde la app.
// Crea su cuenta de acceso (correo + contraseña provisional) y la apunta en su distrito.
// Se despliega con "Verify JWT" desactivado: la propia función comprueba que quien llama es el administrador.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ===== INICIO LÓGICA ALTA (se prueba por separado) =====
// Revisa los datos del formulario. Devuelve { error } o { datos } ya limpios.
function validarAlta(b) {
  const nombre = String((b && b.nombre) || "").trim();
  const email = String((b && b.email) || "").trim().toLowerCase();
  const clave = String((b && b.clave) || "");
  const rol = b && b.rol === "responsable" ? "responsable" : "agente";
  const distrito_id = Number(b && b.distrito_id);
  if (!nombre || nombre.length > 40) return { error: "Escribe el nombre (máximo 40 letras)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "El correo no es válido." };
  if (clave.length < 8) return { error: "La contraseña provisional debe tener al menos 8 caracteres." };
  if (!Number.isInteger(distrito_id) || distrito_id <= 0) return { error: "Falta el distrito." };
  return { datos: { nombre, email, clave, rol, distrito_id, hace_pico: !(b && b.hace_pico === false) } };
}
// ===== FIN LÓGICA ALTA =====

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // 1) ¿Quién llama? Tiene que ser el administrador.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  const miEmail = (u && u.user && u.user.email || "").toLowerCase();
  if (!miEmail) return responder({ error: "Inicia sesión de nuevo." }, 401);
  const { data: todos } = await sb.from("empleados").select("id,nombre,email,admin,activo,distrito_id");
  const porEmail = (em) => (todos || []).find((e) => (e.email || "").toLowerCase() === em);
  const yo = porEmail(miEmail);
  if (!yo || !yo.admin || !yo.activo) return responder({ error: "Solo el administrador puede dar de alta." }, 403);

  // 2) Datos
  let cuerpo = {};
  try { cuerpo = await req.json(); } catch (e) { /* cuerpo vacío */ }
  const v = validarAlta(cuerpo);
  if (v.error) return responder({ error: v.error }, 400);
  const d = v.datos;
  const { data: dist } = await sb.from("distritos").select("id,nombre,turno").eq("id", d.distrito_id).maybeSingle();
  if (!dist) return responder({ error: "Ese distrito no existe." }, 400);

  // 3) ¿Ya estaba en la app?
  const previo = porEmail(d.email);
  if (previo && previo.activo) return responder({ error: `Ese correo ya está dado de alta (${previo.nombre}).` }, 409);
  const mismo = (todos || []).find((e) => e.distrito_id === d.distrito_id && e.nombre.toLowerCase() === d.nombre.toLowerCase() && (!previo || e.id !== previo.id));
  if (mismo) return responder({ error: `Ya hay alguien llamado ${d.nombre} en ${dist.nombre}. Pon también el apellido.` }, 409);

  // 4) Cuenta de acceso (si ya existía, se deja como está y conserva su contraseña)
  let cuentaNueva = true;
  const { error: errCuenta } = await sb.auth.admin.createUser({ email: d.email, password: d.clave, email_confirm: true });
  if (errCuenta) {
    if (/already|registered|exists/i.test(errCuenta.message)) cuentaNueva = false;
    else return responder({ error: "No se pudo crear la cuenta: " + errCuenta.message }, 500);
  }

  // 5) Ficha en el distrito
  const { data: ult } = await sb.from("empleados").select("orden").eq("distrito_id", d.distrito_id).order("orden", { ascending: false }).limit(1);
  const orden = ult && ult[0] ? ult[0].orden + 1 : 1;
  const ficha = { nombre: d.nombre, email: d.email, rol: d.rol, distrito_id: d.distrito_id, hace_pico: d.hace_pico,
    orden, activo: true, clave_cambiada: !cuentaNueva, pareja_id: null };
  const r = previo
    ? await sb.from("empleados").update(ficha).eq("id", previo.id).select().single()
    : await sb.from("empleados").insert(ficha).select().single();
  if (r.error) return responder({ error: "No se pudo guardar la ficha: " + r.error.message }, 500);

  return responder({ ok: true, empleado: r.data, cuentaNueva, distrito: dist.nombre + " " + dist.turno });
});
