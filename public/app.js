(() => {
"use strict";
const { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC } = window.TURNOS_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $app = document.getElementById("app");

const S = { me: null, emps: [], cods: {}, minimo: 6, tercio: 4, y: 0, m: 0, dias: {}, asig: {}, vista: "res", canal: null, rsel: {} };
const R = { dias: {}, asig: {} };
S.notas = {};   // mis notas privadas: fecha -> texto
async function cargarNotas(desde, hasta) {
  const n = await sb.from("notas").select("fecha,texto").gte("fecha", desde).lte("fecha", hasta);
  if (n.error) return;   // si todavía no existe la tabla, simplemente no hay notas
  for (let d = desde; d <= hasta; d = nextDay(d)) delete S.notas[d];
  for (const x of n.data) S.notas[x.fecha] = x.texto;
}
const nextDay = f => { const [y, m, d] = f.split("-").map(Number), t = new Date(y, m - 1, d + 1); return fechaStr(t.getFullYear(), t.getMonth(), t.getDate()); };   // datos del resumen (turno actual y siguiente), independientes del mes que se vea
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DSEM = ["D","L","M","X","J","V","S"];

// ---------- tema (claro / oscuro / automático) ----------
const miTema = () => { try { return localStorage.getItem("tema") || "auto"; } catch (e) { return "auto"; } };
function aplicarTema() {
  const p = miTema(), osc = p === "oscuro" || (p === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.tema = osc ? "oscuro" : "claro";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarTema);

// ---------- utilidades ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const pad = n => String(n).padStart(2, "0");
const fechaStr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const fechaCorta = f => { const [, m, d] = f.split("-"); return `${+d}/${+m}`; };
const hoyStr = () => { const t = new Date(); return fechaStr(t.getFullYear(), t.getMonth(), t.getDate()); };
const nombreEmp = id => ((S.todos || S.emps).find(e => e.id === id) || {}).nombre || "?";
const esResp = () => S.me && (S.me.rol === "responsable" || !!S.me.admin);
function toast(msg, ms = 5000) {
  const t = h("div", { class: "toast" }, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}
// Grupo visual de un código: los que solo ponen los responsables (PICO, DESP) son "modificadores".
const grupoDe = c => { const x = S.cods[c]; if (!x) return "e"; if (x.solo_responsables) return "m"; return x.tipo === "Ausencia Justificada" ? "a" : x.tipo === "Tipo trabajo" ? "t" : "e"; };
const claseTipo = c => ({ a: "t-Ausencia", t: "t-Trabajo", m: "t-Mod", e: "t-Especial" })[grupoDe(c)];

// ---------- turnos A–F y distrito que se está viendo ----------
// Ciclo de 12 días: 2 mañanas, 2 tardes, 2 noches y 6 libres. El turno D empezó el ciclo el 1/1/2026
// y cada turno lo empieza 2 días después que el anterior (cuando D hace tardes, E hace mañanas).
const CICLO = "MMTTNNLLLLLL", LETRAS = "ABCDEF";
const desfase = letra => 2 * (LETRAS.indexOf(letra || "D") - 3);
const diasDesde2026 = f => { const [y, m, d] = f.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 864e5); };
const turnoCiclo = (f, letra = S.dist && S.dist.letra) => CICLO[(((diasDesde2026(f) - desfase(letra)) % 12) + 12) % 12];
function diasRango(desde, hasta) {
  const o = {};
  for (let f = desde; f <= hasta; f = nextDay(f)) o[f] = turnoCiclo(f);
  return o;
}
// Tercio = máximo de ausentes por vacaciones y permisos: la tercera parte de las personas activas, redondeando hacia abajo
// (12 → 4, 11 → 3). Si el distrito aún no tiene a nadie, se usa el valor guardado.
const tercioDe = (n, guardado) => n ? Math.floor(n / 3) : (guardado || 4);
const ADMIN_KEY = "modoAdmin", DIST_KEY = "distritoAdmin";
const leerLS = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const ponerLS = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
const modoAdmin = () => !!(S.me && S.me.admin && leerLS(ADMIN_KEY) === "1");
const miDistrito = () => (S.distritos || []).find(d => d.id === S.me.distrito_id)
  || { id: S.me.distrito_id, nombre: "Usera-Villaverde", letra: "D", zona: 2, turno: "D2", minimo_operativo: 6, tercio: 4 };
function ponerDistrito(d) {
  S.dist = Object.assign({ letra: "D", zona: 2 }, d);
  S.dist.turno = S.dist.letra + S.dist.zona;
  S.emps = (S.todos || []).filter(e => e.distrito_id === S.dist.id && !e.fuera);   // "fuera temporalmente" no cuenta
  S.minimo = S.dist.minimo_operativo || 6; S.tercio = tercioDe(S.emps.length, S.dist.tercio);
  const estoy = S.emps.some(e => e.id === S.me.id);
  S.infEmp = estoy ? S.me.id : (S.emps[0] || {}).id || 0;
  S.abiertas = new Set(estoy ? [S.me.id] : []);
  S.fsel = null; S.yaScroll = false;
}
async function cargarDistritos() {
  const { data, error } = await sb.from("distritos").select("*").order("nombre");
  if (!error) S.distritos = data;
}
async function cambiarDistrito(d) {
  ponerDistrito(d);
  ponerLS(DIST_KEY, !d.id || d.id === S.me.distrito_id ? null : String(d.id));
  await Promise.all([cargarMes(), cargarResumen()]);
  pintar();
}

// ---------- acceso ----------
function pantallaLogin(msg) {
  const email = h("input", { type: "email", placeholder: "Correo electrónico", autocomplete: "username", required: true });
  const pass = h("input", { type: "password", placeholder: "Contraseña", autocomplete: "current-password", required: true });
  const err = h("div", { class: "error" }, msg || "");
  const f = h("form", { onsubmit: async ev => {
    ev.preventDefault(); err.textContent = "Entrando…";
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) err.textContent = "Correo o contraseña incorrectos.";
    else arrancar();
  } }, email, pass, h("button", { class: "btn full", type: "submit" }, "Entrar"), err,
    h("button", { class: "enlace", type: "button", onclick: async ev => {
      const em = email.value.trim();
      if (!em) { err.textContent = "Escribe arriba tu correo y vuelve a pulsar."; return; }
      ev.currentTarget.disabled = true; err.textContent = "Enviando…";
      await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
      // Mensaje neutro: no se revela si el correo existe.
      err.textContent = "Si ese correo está autorizado, te llegará un mensaje con un enlace para crear una contraseña nueva. Mira también el correo no deseado.";
    } }, "¿Has olvidado la contraseña?"));
  $app.replaceChildren(h("div", { class: "login" }, h("h1", {}, "Bienvenido a Tercio"), h("div", { class: "sub" }, "Gestión de turnos y vacaciones"), f));
}

function pantallaNuevaClave(primera) {
  const p1 = h("input", { type: "password", placeholder: "Contraseña nueva (mín. 8 caracteres)", autocomplete: "new-password", required: true, minlength: 8 });
  const p2 = h("input", { type: "password", placeholder: "Repite la contraseña", autocomplete: "new-password", required: true });
  const err = h("div", { class: "error" }, "");
  const f = h("form", { onsubmit: async ev => {
    ev.preventDefault();
    if (p1.value.length < 8) { err.textContent = "Mínimo 8 caracteres."; return; }
    if (p1.value !== p2.value) { err.textContent = "Las contraseñas no coinciden."; return; }
    err.textContent = "Guardando…";
    const { error } = await sb.auth.updateUser({ password: p1.value });
    if (error) { err.textContent = "No se pudo cambiar: " + error.message; return; }
    history.replaceState(null, "", location.pathname);
    await sb.rpc("marcar_clave_cambiada");
    S.recuperando = false; arrancar();
  } }, p1, p2, h("button", { class: "btn full", type: "submit" }, "Guardar contraseña"), err);
  $app.replaceChildren(h("div", { class: "login" }, h("h1", {}, primera ? "Elige tu contraseña" : "Contraseña nueva"),
    h("div", { class: "sub" }, primera ? "Es tu primer acceso: elige una contraseña propia. Solo la sabrás tú." : "Elige la que usarás desde ahora"), f,
    primera ? h("button", { class: "enlace", type: "button", onclick: salir }, "Salir") : null));
}
S.recuperando = /type=recovery/.test(location.hash);
sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") { S.recuperando = true; pantallaNuevaClave(); } });

async function arrancar() {
  if (S.recuperando) return pantallaNuevaClave();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return pantallaLogin();
  const email = (session.user.email || "").toLowerCase();
  const [e, c, cfg] = await Promise.all([
    sb.from("empleados").select("*").order("orden"),
    sb.from("codigos").select("*").order("orden"),
    sb.from("config").select("*"),
  ]);
  if (e.error || c.error) return sinAcceso("No se pudieron cargar los datos. Comprueba la conexión.");
  S.fichas = e.data;
  S.todos = e.data.filter(x => x.activo);
  S.emps = S.todos;
  S.cods = Object.fromEntries(c.data.map(x => [x.codigo, x]));
  const mc = (cfg.data || []).find(x => x.clave === "minimo_operativo");
  if (mc) S.minimo = +mc.valor || 6;
  const tc = (cfg.data || []).find(x => x.clave === "tercio");
  if (tc) S.tercio = +tc.valor || 4;
  S.me = S.todos.find(x => (x.email || "").toLowerCase() === email) || null;
  if (!S.me) return sinAcceso("Tu cuenta no está autorizada en Tercio. Habla con un responsable.");
  if (S.me.clave_cambiada === false) return pantallaNuevaClave(true);
  await cargarDistritos();
  const guardado = modoAdmin() && (S.distritos || []).find(d => String(d.id) === leerLS(DIST_KEY));
  ponerDistrito(Object.assign({ minimo_operativo: S.minimo, tercio: S.tercio }, guardado || miDistrito()));
  const t = new Date(); S.y = t.getFullYear(); S.m = t.getMonth(); S.sel = hoyStr();
  const [r1, r2, pc] = await Promise.all([
    sb.from("dias").select("fecha").order("fecha").limit(1),
    sb.from("dias").select("fecha").order("fecha", { ascending: false }).limit(1),
    sb.from("asignaciones").select("empleado_id,fecha").eq("codigo", "PICO"),
  ]);
  S.anioMin = r1.data && r1.data[0] ? +r1.data[0].fecha.slice(0, 4) : S.y;
  S.anioMax = r2.data && r2.data[0] ? +r2.data[0].fecha.slice(0, 4) : S.y;
  S.picos = new Set((pc.data || []).map(x => x.empleado_id + "|" + x.fecha));
  await Promise.all([cargarMes(), cargarResumen()]);
  suscribir();
  pintar();
}
function sinAcceso(msg) {
  $app.replaceChildren(h("div", { class: "login" }, h("h1", {}, "Tercio"), h("p", { class: "error" }, msg),
    h("button", { class: "btn", onclick: salir }, "Salir")));
}
async function salir() { await sb.auth.signOut(); if (S.canal) sb.removeChannel(S.canal); S.canal = null; pantallaLogin(); }

// ---------- datos del mes ----------
async function cargarMes() {
  const desde = fechaStr(S.y, S.m, 1), hasta = fechaStr(S.y, S.m, new Date(S.y, S.m + 1, 0).getDate());
  // Se carga un mes de margen a cada lado para saber cuántos días seguidos lleva cada ausencia (recomendación del tercio).
  const fd = x => fechaStr(x.getFullYear(), x.getMonth(), x.getDate());
  const ext0 = fd(new Date(S.y, S.m - 1, 1)), ext1 = fd(new Date(S.y, S.m + 2, 0));
  const a = await sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", ext0).lte("fecha", ext1);
  if (a.error) { toast("Error al cargar el mes"); return; }
  S.dias = diasRango(desde, hasta);
  S.diasExt = diasRango(ext0, ext1);
  S.asig = Object.fromEntries(a.data.map(x => [x.empleado_id + "|" + x.fecha, x.codigo]));
  cargarNotas(desde, hasta).then(() => { if (S.vista === "cal") pintar(); });
  // Hoy y mañana también (para la recomendación de pico), aunque se esté viendo otro mes.
  const t = new Date(), h0 = fechaStr(t.getFullYear(), t.getMonth(), t.getDate()), t2 = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1), h1 = fechaStr(t2.getFullYear(), t2.getMonth(), t2.getDate());
  if (!(h0 >= desde && h1 <= hasta)) {
    const a2 = await sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", h0).lte("fecha", h1);
    if (!a2.error) {
      for (const [f, t] of Object.entries(diasRango(h0, h1))) if (!(f in S.dias)) S.dias[f] = t;
      for (const x of a2.data) { const k = x.empleado_id + "|" + x.fecha; if (!(k in S.asig)) S.asig[k] = x.codigo; }
    }
  }
}

// Al volver a la app (móvil dormido, pestaña olvidada, cambio de día) se recargan los datos para no enseñar nada viejo.
S.ultimaCarga = Date.now(); S.diaCarga = hoyStr();
async function refrescar() {
  if (!S.me || document.hidden) return;
  const cambioDia = hoyStr() !== S.diaCarga;
  if (!cambioDia && Date.now() - S.ultimaCarga < 5 * 60 * 1000) return;
  S.ultimaCarga = Date.now(); S.diaCarga = hoyStr();
  if (cambioDia) { const t = new Date(); S.y = t.getFullYear(); S.m = t.getMonth(); S.sel = hoyStr(); S.yaScroll = false; }
  await Promise.all([cargarMes(), cargarResumen()]);
  if (S.vista === "cal" || S.vista === "res") pintar();
}
document.addEventListener("visibilitychange", refrescar);

function suscribir() {
  if (S.canal) return;
  S.canal = sb.channel("turnos")
    .on("postgres_changes", { event: "*", schema: "public", table: "asignaciones" }, p => {
      const r = p.eventType === "DELETE" ? p.old : p.new;
      if (!r || !r.fecha) return;
      const k = r.empleado_id + "|" + r.fecha;
      if (p.eventType === "DELETE") { delete S.asig[k]; delete R.asig[k]; } else { S.asig[k] = r.codigo; R.asig[k] = r.codigo; }
      if (S.picos) { if (p.eventType !== "DELETE" && r.codigo === "PICO") S.picos.add(k); else S.picos.delete(k); }
      if (S.vista === "cal" || S.vista === "res") pintar();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "cambios" }, p => {
      const c = p.new;
      if (c.hecho_por === S.me.id || !S.emps.some(e => e.id === c.empleado_id)) return;
      const quien = nombreEmp(c.hecho_por), de = nombreEmp(c.empleado_id);
      const que = c.codigo_despues ? c.codigo_despues : "quitado " + (c.codigo_antes || "");
      toast(`${quien}${c.hecho_por === c.empleado_id ? "" : " → " + de}: ${que} el ${fechaCorta(c.fecha)}`);
    })
    .subscribe();
}

// ---------- cálculo ----------
// Tercio: personas con una ausencia justificada (vacaciones, AP, CH, CJ, JS, SS, NAV) ese día.
function enTercio(f) {
  return S.emps.filter(e => { const c = S.asig[e.id + "|" + f]; return c && S.cods[c] && S.cods[c].tipo === "Ausencia Justificada"; }).length;
}
function trabaja(empId, f) {
  const c = S.asig[empId + "|" + f];
  return !c || !!(S.cods[c] && S.cods[c].cuenta_como_trabajo);
}
// Último PICO de cada persona antes del día f (cadena vacía = nunca).
function ultimoPico(empId, f) {
  let u = "";
  for (const k of S.picos || []) { const [id, fe] = k.split("|"); if (+id === empId && fe < f && fe > u) u = fe; }
  return u;
}
// Recomendación: entre los candidatos, quien lleva más tiempo sin PICO (o nunca); a igualdad, por orden de la lista.
// Solo hace falta pico cuando trabaja un número impar de personas (con número par los binomios se reordenan).
function nTrabajan(f, A = S.asig) {
  return S.emps.filter(e => { const c = A[e.id + "|" + f]; return !c || !!(S.cods[c] && S.cods[c].cuenta_como_trabajo); }).length;
}
const hacePicoFalta = (f, A = S.asig) => nTrabajan(f, A) % 2 === 1;
function recomendarPico(f, A = S.asig) {
  if (!hacePicoFalta(f, A)) return [];
  const cand = candidatosPico(f, A).map(e => ({ e, u: ultimoPico(e.id, f) }));
  cand.sort((a, b) => a.u === b.u ? a.e.orden - b.e.orden : (a.u < b.u ? -1 : 1));
  return cand;
}
function candidatosPico(f, A = S.asig) {
  // libre (sin código) y su binomio ausente. Quien no tiene binomio (o lo tiene de baja, p. ej. destinado
  // temporalmente en otro equipo) es candidato siempre que esté libre.
  return S.emps.filter(e => {
    if (e.hace_pico === false) return false;
    if (A[e.id + "|" + f]) return false;
    if (!e.pareja_id || !S.emps.some(x => x.id === e.pareja_id)) return true;
    const cp = A[e.pareja_id + "|" + f];
    return cp && S.cods[cp] && !S.cods[cp].cuenta_como_trabajo;
  });
}

// ---------- pantallas ----------
const ICON = {
  res: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  inf: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  form: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
  cuenta: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
};
const icono = k => { const s = document.createElement("span"); s.innerHTML = `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`; return s.firstChild; };
const TURNO_NOMBRE = { M: "Mañana", T: "Tarde", N: "Noche", S: "Libre", L: "Libre" };
const tl = t => (t === "S" ? "L" : t || "");      // la "S" (saliente) se muestra como "L" (libre)
const DLARGO = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

function cabecera() {
  const b = (v, txt) => h("button", { class: S.vista === v ? "on" : "", onclick: () => { S.vista = v; pintar(); } }, icono(v), txt);
  return h("header", {},
    modoAdmin()
      ? h("div", { class: "marca admin" },
          h("button", { class: "selturno", title: "Elegir turno", onclick: ev => menuTurnos(ev.currentTarget) }, h("i", {}, S.dist.turno, h("b", {}, "▾"))),
          h("button", { class: "seldis", title: "Elegir distrito", onclick: ev => menuDistritos(ev.currentTarget) }, h("span", {}, S.dist.nombre), h("b", {}, "▾")),
          h("span", { class: "adm" }, "ADMIN"))
      : h("div", { class: "marca" }, h("i", {}, S.dist.turno), S.dist.nombre),
    h("nav", { class: "tabs" }, b("res", "Resumen"), b("cal", "Calendario"), b("form", "Formación"), b("inf", "Informes"), b("hist", "Cambios"), b("cuenta", "Cuenta")),
    h("span", { class: "yo" }, S.me.nombre));
}
function pintar() {
  const w = $app.querySelector(".wrap");
  const pos = w ? [w.scrollLeft, w.scrollTop] : null;
  const vacio = !S.emps.length && (S.vista === "res" || S.vista === "cal" || S.vista === "inf");
  const cuerpo = vacio ? distritoVacio() : S.vista === "res" ? vistaResumen() : S.vista === "cal" ? vistaCalendario() : S.vista === "hist" ? vistaHistorial() : S.vista === "form" ? vistaFormacion() : S.vista === "inf" ? vistaInformes() : vistaCuenta();
  $app.replaceChildren(cabecera(), cuerpo);
  if (S.vista !== "cal") return;
  const nw = $app.querySelector(".wrap");
  if (!S.yaScroll) {
    const hoy = $app.querySelector("th.hoy") || $app.querySelector("th.sel");
    if (hoy) nw.scrollLeft = Math.max(0, hoy.offsetLeft - nw.clientWidth / 2);
    S.yaScroll = true;
  } else if (pos) { nw.scrollLeft = pos[0]; nw.scrollTop = pos[1]; }
}

function resumenDia() {
  const f = S.sel, [y, m, d] = f.split("-").map(Number), t = S.dias[f];
  const dow = DLARGO[new Date(y, m - 1, d).getDay()];
  const titulo = `${dow[0].toUpperCase() + dow.slice(1)} ${d} de ${MESES[m - 1]}`;
  if (t !== "M" && t !== "T" && t !== "N")
    return h("div", { class: "card" }, h("div", {}, h("div", { class: "tit" }, titulo), h("span", { class: "pill" }, "Día libre del ciclo")),
      h("div", { class: "det" }, "Sin servicio este día."));
  const n = S.emps.filter(e => trabaja(e.id, f)).length;
  const aus = S.emps.filter(e => { const c = S.asig[e.id + "|" + f]; return c && !(S.cods[c] && S.cods[c].cuenta_como_trabajo); })
    .map(e => `${e.nombre} (${S.asig[e.id + "|" + f]})`);
  const con = c => S.emps.filter(e => S.asig[e.id + "|" + f] === c).map(e => e.nombre);
  const extra = ["PICO", "DESP"].filter(c => con(c).length).map(c => `${c}: ${con(c).join(", ")}`);
  return h("div", { class: "card" },
    h("div", {}, h("div", { class: "tit" }, titulo), h("span", { class: "pill" }, "Turno " + TURNO_NOMBRE[t].toLowerCase())),
    h("div", {}, h("div", { class: "grande " + (n < S.minimo ? "bajo" : "ok") }, `${n}/${S.emps.length}`), h("small", { class: "det" }, `trabajan (mín. ${S.minimo})`)),
    h("div", {}, h("div", { class: "grande " + (enTercio(f) > S.tercio ? "bajo" : "ok") }, `${enTercio(f)}/${S.tercio}`), h("small", { class: "det" }, "tercio")),
    h("div", { class: "det" }, aus.length ? "Ausentes: " + aus.join(" · ") : "Nadie ausente.", extra.length ? h("div", {}, extra.join(" · ")) : null));
}

// ---------- resumen diario: turno actual (o el que acaba de pasar) y siguiente ----------
// El ciclo son bloques de 12 días: 6 de servicio (M M T T N N) y 6 de descanso. Cada turno (A–F) los empieza en un día distinto.
function bloqueFechas(k) {
  const off = desfase(S.dist && S.dist.letra);
  return Array.from({ length: 6 }, (_, i) => { const x = new Date(2026, 0, 1 + 12 * k + off + i); return fechaStr(x.getFullYear(), x.getMonth(), x.getDate()); });
}
function bloqueActual() {
  return Math.floor((diasDesde2026(hoyStr()) - desfase(S.dist && S.dist.letra)) / 12);
}
async function cargarResumen() {
  const k = bloqueActual(), mas = (f, n) => { const [y, m, d] = f.split("-").map(Number), t = new Date(y, m - 1, d + n); return fechaStr(t.getFullYear(), t.getMonth(), t.getDate()); };
  // se carga algo más de margen para saber cuántos días seguidos lleva cada ausencia
  const a = mas(bloqueFechas(k)[0], -30), b = mas(bloqueFechas(k + 1)[5], 30);
  await cargarAnio(new Date().getFullYear());
  const x = await sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", a).lte("fecha", b);
  if (x.error) { toast("Error al cargar el resumen"); return; }
  R.dias = diasRango(a, b);
  R.asig = Object.fromEntries(x.data.map(r => [r.empleado_id + "|" + r.fecha, r.codigo]));
  cargarNotas(bloqueFechas(k)[0], bloqueFechas(k + 1)[5]).then(() => { if (S.vista === "res") pintar(); });
  // mantiene S.asig de hoy y mañana coherente para el pico recomendado
}
// ---------- datos del año completo (informes y recomendación de ausencias) ----------
S.infAnio = {};
async function cargarAnio(y) {
  const rows = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from("asignaciones").select("empleado_id,fecha,codigo")
      .gte("fecha", `${y}-01-01`).lte("fecha", `${y}-12-31`).order("fecha").order("empleado_id").range(desde, desde + 999);
    if (error) { toast("Error al cargar el año"); return S.infAnio[y] || []; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  S.infAnio[y] = rows;
  return rows;
}
const esAus = c => !!(c && S.cods[c] && S.cods[c].tipo === "Ausencia Justificada");
const esVac = c => ["V1", "V2", "V3"].includes(c);
// Al superar el tercio se quitan primero los permisos (AP, CJ, CH, JS, SS, NAV…), todos al mismo nivel,
// y por último las vacaciones, que entre ellas tienen prioridad V1 sobre V2 y V2 sobre V3 (se quita antes V3).
const nivelQuitar = c => ({ V3: 2, V2: 3, V1: 4 })[c] ?? 0;
// Días ya disfrutados (anteriores a hoy) en el año actual, contados aparte: para las vacaciones, los días de vacaciones;
// para el resto, el cómputo total de AP + CJ + CH + JS (quien más ha librado por estos días se quita antes).
const CUENTA_PERM = ["AP", "CJ", "CH", "JS"];
function diasCogidos(empId, c) {
  const hoy = hoyStr(), y = +hoy.slice(0, 4), cuenta = esVac(c) ? esVac : (x => CUENTA_PERM.includes(x));
  return (S.infAnio[y] || []).filter(r => r.empleado_id === empId && r.fecha < hoy && cuenta(r.codigo)).length;
}
// Días de servicio seguidos de ausencia que incluyen el día f (los días libres del ciclo no cortan la racha).
function rachaAusencia(empId, f, A = R.asig, D = R.dias) {
  const mas = (n) => { const [y, m, d] = f.split("-").map(Number), t = new Date(y, m - 1, d + n); return fechaStr(t.getFullYear(), t.getMonth(), t.getDate()); };
  let n = 1;
  for (const paso of [-1, 1]) {
    for (let i = 1; i < 60; i++) {
      const g = mas(paso * i), t = D[g];
      if (!t) break;
      if (t === "S" || t === "L") continue;
      if (esAus(A[empId + "|" + g])) n++; else break;
    }
  }
  return n;
}
// Recomendación (orden de "quién debe quitarse"): 1) permisos (AP, CJ, CH, JS…), V3, V2 y V1; 2) dentro de cada uno, quien más días ha disfrutado
// este año (vacaciones o permisos, contados aparte); 3) orden de la lista.
function recomendarQuitar(f, A = R.asig, D = R.dias) {
  const lista = S.emps.filter(e => esAus(A[e.id + "|" + f])).map(e => {
    const c = A[e.id + "|" + f];
    return { e, c, vac: nivelQuitar(c), racha: rachaAusencia(e.id, f, A, D), tot: diasCogidos(e.id, c) };
  });
  lista.sort((a, b) => a.vac - b.vac || b.tot - a.tot || a.e.orden - b.e.orden);
  return lista;
}
const trabajaR = (id, f) => { const c = R.asig[id + "|" + f]; return !c || !!(S.cods[c] && S.cods[c].cuenta_como_trabajo); };

function panelBloque(titulo, k, clase) {
  const fechas = bloqueFechas(k), hoy = hoyStr();
  const tercioR = f => S.emps.filter(e => { const c = R.asig[e.id + "|" + f]; return c && S.cods[c] && S.cods[c].tipo === "Ausencia Justificada"; }).length;
  const hayQuitar = fechas.some(f => f >= hoy && tercioR(f) > S.tercio);
  const fila = (etq, cls, celda) => h("tr", { class: cls }, h("th", {}, etq), fechas.map(f => celda(f)));
  const persona = (e, f) => { const c = R.asig[e.id + "|" + f]; return h("li", {}, h("span", { class: "pn" }, e.nombre), c ? h("span", { class: "cod " + claseTipo(c) }, c) : null); };
  const tabla = h("table", { class: "res" },
    h("thead", {}, h("tr", {}, h("th", {}, ""), fechas.map(f => {
      const [y, m, d] = f.split("-").map(Number);
      return h("th", { class: f === hoy ? "hoy" : "" }, h("small", {}, DSEM[new Date(y, m - 1, d).getDay()]), `${d}/${m}`);
    }))),
    h("tbody", {},
      fila("Turno", "rt", f => h("td", {}, h("span", { class: "tur " + tl(R.dias[f]) }, tl(R.dias[f])))),
      fila("Trabajan", "rn", f => { const n = S.emps.filter(e => trabajaR(e.id, f)).length; return h("td", { class: n < S.minimo ? "bajo" : "ok" }, n); }),
      fila("Tercio", "rn", f => { const n = tercioR(f); return h("td", { class: n > S.tercio ? "bajo" : "ok" }, n); }),
      fila("Pico", "rp", f => {
        if (f < hoy) return h("td", {}, "–");
        const ya = S.emps.filter(e => R.asig[e.id + "|" + f] === "PICO").map(e => e.nombre);
        if (ya.length) return h("td", {}, h("small", {}, "asignado"), h("div", {}, ya.join(", ")));
        if (!hacePicoFalta(f, R.asig)) return h("td", {}, "–");
        const r = recomendarPico(f, R.asig);
        return h("td", {}, r.length ? h("b", {}, r[0].e.nombre) : h("small", {}, "nadie"));
      }),
      fila("Personal activo", "rl", f => h("td", {}, h("ul", {}, S.emps.filter(e => trabajaR(e.id, f)).map(e => persona(e, f))))),
      fila("Ausencias", "rl", f => h("td", {}, h("ul", {}, S.emps.filter(e => !trabajaR(e.id, f)).map(e => persona(e, f))))),
      fechas.some(f => S.notas[f]) ? fila("Mi nota", "rnota", f => h("td", {}, S.notas[f] ? h("small", {}, S.notas[f]) : "")) : null,
      hayQuitar ? fila("Quitarse", "rq", f => {
        if (f < hoy || tercioR(f) <= S.tercio) return h("td", {});
        const r = recomendarQuitar(f); if (!r.length) return h("td", {});
        // Se nombra a tantas personas como sobran, por orden de preferencia
        const sobran = tercioR(f) - S.tercio, fuera = r.slice(0, sobran), luego = r.slice(sobran), pl = n => n === 1 ? "" : "s";
        return h("td", {}, h("small", {}, sobran > 1 ? `deben quitarse ${sobran}` : "recomendado"),
          fuera.map((x, i) => [h("div", {}, h("b", {}, `${i + 1}º ${x.e.nombre}`)),
            h("small", {}, `${x.c} · ${x.tot} día${pl(x.tot)} de ${esVac(x.c) ? "vacaciones" : "AP/CJ/CH/JS"} este año`)]),
          luego.length ? h("small", {}, "luego " + luego.map((y, i) => `${sobran + i + 1}º ${y.e.nombre}`).join(", ")) : null);
      }) : null));
  return h("section", { class: "bloque " + clase },
    h("h3", {}, titulo, h("small", {}, ` · ${fechaCorta(fechas[0])} – ${fechaCorta(fechas[5])}`)),
    h("div", { class: "wrapres" }, tabla));
}
function vistaResumen() {
  const k = bloqueActual(), hoy = hoyStr(), fs = bloqueFechas(k);
  return h("div", { class: "resumenPag" },
    panelBloque(fs.includes(hoy) ? "Turno actual" : "Turno anterior", k, "actual"),
    panelBloque("Turno siguiente", k + 1, "siguiente"));
}

function bloquePico() {
  const t = new Date(), mk = n => { const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return fechaStr(x.getFullYear(), x.getMonth(), x.getDate()); };
  const linea = (etq, f) => {
    const tn = S.dias[f];
    if (tn !== "M" && tn !== "T" && tn !== "N") return h("div", { class: "pl" }, h("span", { class: "pe" }, etq), h("span", { class: "pv" }, "sin servicio"));
    const ya = S.emps.filter(e => S.asig[e.id + "|" + f] === "PICO").map(e => e.nombre);
    if (ya.length) return h("div", { class: "pl" }, h("span", { class: "pe" }, etq), h("span", { class: "pv" }, "ya asignado: " + ya.join(", ")));
    if (!hacePicoFalta(f)) return h("div", { class: "pl" }, h("span", { class: "pe" }, etq), h("span", { class: "pv" }, "no hace falta (trabajan " + nTrabajan(f) + ")"));
    const r = recomendarPico(f);
    if (!r.length) return h("div", { class: "pl" }, h("span", { class: "pe" }, etq), h("span", { class: "pv" }, "nadie candidato"));
    return h("div", { class: "pl" }, h("span", { class: "pe" }, etq), h("span", { class: "pv" }, h("b", {}, r[0].e.nombre),
      r.length > 1 ? h("small", {}, " · luego " + r.slice(1).map(x => x.e.nombre).join(", ")) : null));
  };
  const lineas = [linea("Hoy", mk(0)), linea("Mañana", mk(1))];
  if (S.sel !== mk(0) && S.sel !== mk(1)) lineas.push(linea(fechaCorta(S.sel), S.sel));
  return h("div", { class: "picoreco" }, h("div", { class: "pt" }, "Pico recomendado"), lineas,
    h("small", { class: "det" }, "Solo hace falta con número impar de personas. Candidatos: libres con su binomio ausente; va primero quien lleva más tiempo sin pico."));
}

// Selector directo de mes y año
async function abrirSelectorMes(irA) {
  // Se vuelve a mirar hasta qué año hay datos, por si se añadieron después de abrir la app.
  const r2 = await sb.from("dias").select("fecha").order("fecha", { ascending: false }).limit(1);
  if (r2.data && r2.data[0]) S.anioMax = Math.max(S.anioMax, +r2.data[0].fecha.slice(0, 4));
  let anio = S.y;
  const dlg = h("dialog", {});
  const cont = h("div", {});
  const dibujar = () => {
    cont.replaceChildren(
      h("div", { class: "anio" }, h("button", { disabled: anio <= S.anioMin, onclick: () => { anio--; dibujar(); } }, "‹"), h("b", {}, anio),
        h("button", { disabled: anio >= S.anioMax, onclick: () => { anio++; dibujar(); } }, "›")),
      h("div", { class: "meses" }, MESES.map((n, i) => h("button", { class: "mesb" + (anio === S.y && i === S.m ? " act" : ""), onclick: () => { dlg.close(); irA(anio, i); } }, n.slice(0, 3)))));
  };
  dibujar();
  dlg.append(h("h3", {}, "Ir a un mes"), cont, h("div", { class: "fila" }, h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cerrar")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

// ---------- exportar el mes (Excel y PDF) ----------
const COLGRP = { a: ["#CFE3FB", "#0C3B7A"], t: ["#2563B8", "#FFFFFF"], m: ["#111111", "#FFFFFF"], e: ["#F8D4D0", "#8A1F14"] };
function datosMes() {
  const nd = new Date(S.y, S.m + 1, 0).getDate(), dias = Array.from({ length: nd }, (_, i) => i + 1);
  const serv = f => ["M", "T", "N"].includes(S.dias[f]);
  return { dias, titulo: `${S.dist.nombre} ${S.dist.turno} · ${MESES[S.m]} ${S.y}`, serv,
    tercio: dias.map(d => { const f = fechaStr(S.y, S.m, d); return serv(f) ? enTercio(f) : null; }),
    trabajan: dias.map(d => { const f = fechaStr(S.y, S.m, d); return serv(f) ? S.emps.filter(e => trabaja(e.id, f)).length : null; }) };
}
function descargar(nombre, contenido, tipo) {
  const a = h("a", { href: URL.createObjectURL(new Blob([contenido], { type: tipo })), download: nombre });
  document.body.append(a); a.click(); a.remove();
}
function exportarExcel() {
  const D = datosMes();
  const cel = (v, st) => `<Cell${st ? ` ss:StyleID="${st}"` : ""}><Data ss:Type="${typeof v === "number" ? "Number" : "String"}">${xmlEsc(v)}</Data></Cell>`;
  const fila = cs => `<Row>${cs.join("")}</Row>`;
  const filas = [
    fila([cel(D.titulo, "n"), ...D.dias.map(d => cel(DSEM[new Date(S.y, S.m, d).getDay()] + " " + d, "h"))]),
    fila([cel("Turno", "n"), ...D.dias.map(d => cel(tl(S.dias[fechaStr(S.y, S.m, d)]), "c"))]),
    ...S.emps.map(e => fila([cel(e.nombre, "n"), ...D.dias.map(d => { const c = S.asig[e.id + "|" + fechaStr(S.y, S.m, d)]; return cel(c || "", c ? "g" + grupoDe(c) : "c"); })])),
    fila([cel(`Tercio (máx. ${S.tercio})`, "n"), ...D.tercio.map(n => n == null ? cel("–", "c") : cel(n, n > S.tercio ? "b" : "c"))]),
    fila([cel("Trabajan", "n"), ...D.trabajan.map(n => n == null ? cel("–", "c") : cel(n, n < S.minimo ? "b" : "c"))]),
  ];
  const est = (id, bg, fg, extra = "") => `<Style ss:ID="${id}"><Alignment ss:Horizontal="Center"/><Interior ss:Color="${bg}" ss:Pattern="Solid"/><Font ss:Color="${fg}"${extra}/></Style>`;
  const estilos = `<Styles><Style ss:ID="n"><Font ss:Bold="1"/></Style><Style ss:ID="c"><Alignment ss:Horizontal="Center"/></Style>` +
    est("h", "#E8F1FD", "#0F2A4A", ' ss:Bold="1"') + est("b", "#FBD5D0", "#C0392B", ' ss:Bold="1"') +
    Object.entries(COLGRP).map(([g, [bg, fg]]) => est("g" + g, bg, fg, ' ss:Bold="1"')).join("") + `</Styles>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${estilos}<Worksheet ss:Name="${xmlEsc(MESES[S.m] + " " + S.y)}"><Table><Column ss:Width="95"/>${filas.join("")}</Table></Worksheet></Workbook>`;
  descargar(`calendario-${S.y}-${pad(S.m + 1)}.xml`, xml, "application/xml");
}
function exportarPDF() {
  const D = datosMes(), ant = document.getElementById("imprimir");
  if (ant) ant.remove();
  const celdaCod = (c) => c ? h("td", { class: "pc", style: `background:${COLGRP[grupoDe(c)][0]};color:${COLGRP[grupoDe(c)][1]}` }, c) : h("td", {});
  const doc = h("div", { id: "imprimir" }, h("h2", {}, D.titulo),
    h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, ""), D.dias.map(d => h("th", {}, DSEM[new Date(S.y, S.m, d).getDay()], h("br"), d)))),
      h("tbody", {},
        h("tr", {}, h("th", {}, "Turno"), D.dias.map(d => h("td", {}, tl(S.dias[fechaStr(S.y, S.m, d)])))),
        S.emps.map(e => h("tr", {}, h("th", {}, e.nombre), D.dias.map(d => celdaCod(S.asig[e.id + "|" + fechaStr(S.y, S.m, d)])))),
        h("tr", {}, h("th", {}, `Tercio (máx. ${S.tercio})`), D.tercio.map(n => h("td", { class: n != null && n > S.tercio ? "pbajo" : "" }, n == null ? "–" : n))),
        h("tr", {}, h("th", {}, "Trabajan"), D.trabajan.map(n => h("td", { class: n != null && n < S.minimo ? "pbajo" : "" }, n == null ? "–" : n))))));
  document.body.append(doc);
  document.body.classList.add("imprimiendo");
  const limpiar = () => { document.body.classList.remove("imprimiendo"); const x = document.getElementById("imprimir"); if (x) x.remove(); };
  window.addEventListener("afterprint", limpiar, { once: true });
  setTimeout(() => window.print(), 80);
}

function vistaCalendario() {
  const nd = new Date(S.y, S.m + 1, 0).getDate(), hoy = hoyStr();
  const dias = Array.from({ length: nd }, (_, i) => i + 1);
  const cls = (d, f) => [new Date(S.y, S.m, d).getDay() % 6 === 0 ? "finde" : "", f === hoy ? "hoy" : "", f === S.sel ? "sel" : ""].join(" ");
  const irAMes = async (y, m) => {
    S.y = y; S.m = m; const h0 = hoyStr();
    S.sel = h0.startsWith(`${S.y}-${pad(S.m + 1)}`) ? h0 : fechaStr(S.y, S.m, 1);
    S.yaScroll = false; await cargarMes(); pintar();
  };
  const irMes = async (dm, aHoy) => {
    if (aHoy) { const t = new Date(); S.y = t.getFullYear(); S.m = t.getMonth(); }
    else { S.m += dm; if (S.m < 0) { S.m = 11; S.y--; } if (S.m > 11) { S.m = 0; S.y++; } }
    const h0 = hoyStr();
    S.sel = h0.startsWith(`${S.y}-${pad(S.m + 1)}`) ? h0 : fechaStr(S.y, S.m, 1);
    S.yaScroll = false; await cargarMes(); pintar();
  };
  const thead = h("thead", {}, h("tr", {}, h("th", { class: "nom" }, ""), dias.map(d => {
    const f = fechaStr(S.y, S.m, d);
    return h("th", { class: cls(d, f), onclick: () => { S.sel = f; pintar(); } }, DSEM[new Date(S.y, S.m, d).getDay()], h("small", {}, d));
  })));
  const filaTurno = h("tr", { class: "turno" }, h("th", { class: "nom" }, "Turno"), dias.map(d => {
    const f = fechaStr(S.y, S.m, d), t = tl(S.dias[f]);
    return h("td", { class: cls(d, f) }, h("span", { class: "tur " + t }, t));
  }));
  const tbody = h("tbody", {}, filaTurno, S.emps.map(e => h("tr", { class: (e.id === S.me.id ? "yo " : "") + (e.id === S.fsel ? "fsel" : "") },
    h("th", { class: "nom", title: "Resaltar su fila", onclick: () => { S.fsel = S.fsel === e.id ? null : e.id; pintar(); } }, e.nombre),
    dias.map(d => {
      const f = fechaStr(S.y, S.m, d), c = S.asig[e.id + "|" + f], t = S.dias[f];
      return h("td", { class: "dia " + cls(d, f) + (S.rango && S.rango.emp.id === e.id && S.rango.desde === f ? " rinicio" : "") + (t === "S" || t === "L" ? " libre" : "") + (esPasado(f) && !S.me.admin ? " pasado" : "") + (e.id === S.me.id && S.notas[f] ? " nota" : ""), title: e.id === S.me.id && S.notas[f] ? S.notas[f] : null, onclick: () => tocarDia(e, f) },
        c ? h("span", { class: "cod " + claseTipo(c) }, c) : "");
    }))));
  const filaTercio = h("tr", {}, h("th", { class: "nom", title: "Ausentes por vacaciones o permisos" }, `Tercio (máx. ${S.tercio})`), dias.map(d => {
    const f = fechaStr(S.y, S.m, d), t = S.dias[f];
    if (t !== "M" && t !== "T" && t !== "N") return h("td", { class: cls(d, f) }, "–");
    const n = enTercio(f);
    return h("td", { class: n > S.tercio ? "bajo" : "ok" }, n);
  }));
  const tfoot = h("tfoot", {}, filaTercio, h("tr", {}, h("th", { class: "nom" }, "Trabajan"), dias.map(d => {
    const f = fechaStr(S.y, S.m, d), t = S.dias[f];
    if (t !== "M" && t !== "T" && t !== "N") return h("td", { class: cls(d, f) }, "–");
    const n = S.emps.filter(e => trabaja(e.id, f)).length;
    return h("td", { class: n < S.minimo ? "bajo" : "ok" }, n);
  })));
  return h("div", {},
    h("div", { class: "mes" }, h("button", { onclick: () => irMes(-1) }, "‹"), h("b", { class: "mesSel", title: "Elegir mes y año", onclick: () => abrirSelectorMes(irAMes) }, `${MESES[S.m]} ${S.y} ▾`), h("button", { onclick: () => irMes(1) }, "›"),
      h("div", { class: "mesacc" },
        h("button", { class: "hoybtn", onclick: () => irMes(0, true) }, "Hoy"),
        h("button", { class: "hoybtn", title: "Descargar el mes en Excel", onclick: exportarExcel }, "Excel"),
        h("button", { class: "hoybtn", title: "Guardar el mes en PDF", onclick: exportarPDF }, "PDF"))),
    h("div", { class: "resumen" }, resumenDia()),
    bloquePico(),
    h("div", { style: "height:.7rem" }),
    S.rango ? h("div", { class: "rangoaviso" },
      h("span", {}, "Varios días para ", h("b", {}, S.rango.emp.nombre), ` desde el ${fechaSem(S.rango.desde)}. Toca el último día en su fila.`),
      h("button", { class: "btn sec mini", onclick: () => { S.rango = null; pintar(); } }, "Cancelar")) : null,
    h("div", { class: "wrap" }, h("table", { class: "cal" + (S.fsel ? " conSel" : "") + (S.rango ? " enRango" : "") }, thead, tbody, tfoot)),
    bloqueQuitar(),
    h("div", { class: "leyenda" }, h("span", { class: "a" }, "Vacaciones y permisos"), h("span", { class: "t" }, "Trabajo"), h("span", { class: "m" }, "Modificadores (PICO, DESP)"), h("span", { class: "e" }, "Otros"), h("span", { class: "l" }, "Día libre (L)"),
      h("span", {}, (esResp() ? "Toca una casilla para poner o quitar un código. " : "Toca una casilla tuya para poner o quitar un código. ") + "Toca un nombre para resaltar su fila y un día arriba para ver su resumen.")));
}

// Debajo del calendario: días del mes (de hoy en adelante) que superan el tercio y quién debería quitarse.
function bloqueQuitar() {
  const hoy = hoyStr(), nd = new Date(S.y, S.m + 1, 0).getDate();
  const ultimo = fechaStr(S.y, S.m, nd);
  if (ultimo < hoy) return null;                       // mes ya pasado: no se puede cambiar nada
  const pl = n => n === 1 ? "" : "s";
  const lineas = [];
  for (let d = 1; d <= nd; d++) {
    const f = fechaStr(S.y, S.m, d);
    if (f < hoy || !["M", "T", "N"].includes(S.dias[f])) continue;
    const n = enTercio(f);
    if (n <= S.tercio) continue;
    const r = recomendarQuitar(f, S.asig, S.diasExt || S.dias), sobran = n - S.tercio;
    const fuera = r.slice(0, sobran), luego = r.slice(sobran);
    lineas.push(h("div", { class: "pl" + (f === S.sel ? " sel" : ""), title: "Ver este día", onclick: () => { S.sel = f; pintar(); } },
      h("span", { class: "pe" }, `${DSEM[new Date(S.y, S.m, d).getDay()]} ${d}/${S.m + 1}`),
      h("span", { class: "pv" },
        h("span", { class: "exceso" }, `${n} de ${S.tercio}`), " ",
        fuera.length ? [sobran > 1 ? `Deben quitarse ${sobran}: ` : "Debe quitarse: ",
          fuera.map((x, i) => [i ? ", " : "", h("b", {}, `${i + 1}º ${x.e.nombre}`), h("small", {}, ` (${x.c} · ${x.tot} día${pl(x.tot)} de ${esVac(x.c) ? "vacaciones" : "AP/CJ/CH/JS"} este año)`)])] : "sin candidatos",
        luego.length ? h("small", {}, " · luego " + luego.map((x, i) => `${sobran + i + 1}º ${x.e.nombre} (${x.c} · ${x.tot})`).join(", ")) : null)));
  }
  return h("div", { class: "picoreco quitareco" }, h("div", { class: "pt" }, "Tercio superado: quién debe quitarse"),
    lineas.length ? lineas : h("div", { class: "pl" }, h("span", { class: "pv" }, S.y === +hoy.slice(0, 4) && S.m === +hoy.slice(5, 7) - 1 ? "Ningún día que queda de este mes supera el tercio." : "Ningún día de este mes supera el tercio.")),
    h("small", { class: "det" }, "Solo días de hoy en adelante. Orden para quitarse: AP, CJ, CH y JS (todos igual); después V3, V2 y por último V1. Dentro de cada uno, primero quien más días lleva este año: AP + CJ + CH + JS se suman en un solo cómputo; las vacaciones se cuentan aparte. El número entre paréntesis son esos días. Toca un día para ver su resumen."));
}

const GRUPOS = [["a", "Vacaciones y permisos"], ["t", "Trabajo"], ["m", "Modificadores"], ["e", "Otros"]];
const esPasado = f => f < hoyStr();
function avisoDiaBloqueado(f) {
  const adm = S.emps.find(e => e.admin);
  const dlg = h("dialog", {});
  dlg.append(h("h3", {}, "Día bloqueado"),
    h("p", { class: "sub" }, fechaLarga(f)),
    h("p", {}, "No se pueden modificar los días que ya han pasado."),
    h("p", {}, "Si necesitas cambiar algo, ponte en contacto con el administrador" + (adm ? " (" + adm.nombre + ")" : "") + "."),
    h("div", { class: "fila" }, h("button", { class: "btn", onclick: () => dlg.close() }, "Entendido")));
  dlg.addEventListener("close", () => { dlg.remove(); pintar(); });
  document.body.append(dlg); dlg.showModal();
}

function bloqueNota(f) {
  const ta = h("textarea", { maxlength: "500", rows: "2", placeholder: "Nota privada: solo la ves tú" });
  ta.value = S.notas[f] || "";
  const msg = h("small", { class: "det" }, "");
  const guardarNota = async ev => {
    ev.currentTarget.disabled = true;
    const txt = ta.value.trim();
    const { error } = txt
      ? await sb.from("notas").upsert({ empleado_id: S.me.id, fecha: f, texto: txt, actualizado: new Date().toISOString() }, { onConflict: "empleado_id,fecha" })
      : await sb.from("notas").delete().eq("empleado_id", S.me.id).eq("fecha", f);
    ev.currentTarget.disabled = false;
    if (error) { msg.textContent = "No se pudo guardar la nota."; return; }
    if (txt) S.notas[f] = txt; else delete S.notas[f];
    msg.textContent = txt ? "Nota guardada ✔" : "Nota borrada";
  };
  return h("div", { class: "nota-bloque" }, h("h4", {}, "Nota del día"), ta, h("div", { class: "fila" }, h("button", { class: "btn sec mini", onclick: guardarNota }, "Guardar nota"), msg));
}

const fechaSem = f => { const [y, m, d] = f.split("-").map(Number); return `${DSEM3[new Date(y, m - 1, d).getDay()]} ${d}/${m}`; };
const DSEM3 = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
// Toque en una casilla: normal (un día) o, si se está eligiendo un rango, el último día.
function tocarDia(e, f) {
  if (!S.rango) { S.sel = f; abrirEdicion(e, f); return; }
  if (e.id !== S.rango.emp.id) { toast(`Toca un día de la fila de ${S.rango.emp.nombre}, o pulsa Cancelar arriba`, 3500); return; }
  const a = S.rango.desde < f ? S.rango.desde : f, b = S.rango.desde < f ? f : S.rango.desde;
  S.rango = null; S.sel = b;
  if (a === b) { abrirEdicion(e, a); return; }
  abrirEdicion(e, a, b);
}
// Desplegables de códigos: un apartado por grupo; se abre el del código actual y, al abrir uno, se cierran los demás.
function seccionesCodigos(emp, actual, elegir) {
  const lista = GRUPOS.map(([tipo, titulo]) => {
    const cs = Object.values(S.cods).filter(c => !c.oculto && grupoDe(c.codigo) === tipo && (esResp() || !c.solo_responsables) && !(c.codigo === "PICO" && emp.hace_pico === false));
    if (!cs.length) return null;
    const det = h("details", { class: "grupo g-" + tipo, open: cs.some(c => c.codigo === actual) },
      h("summary", {}, h("span", { class: "gpunto" }), titulo, h("small", {}, String(cs.length))),
      h("div", { class: "chips" }, cs.map(c =>
        h("button", { class: `chip ${claseTipo(c.codigo)} ${c.codigo === actual ? "act" : ""}`, onclick: ev => elegir(c.codigo, ev.currentTarget) },
          h("b", {}, c.codigo), h("span", {}, c.descripcion)))));
    return det;
  }).filter(Boolean);
  lista.forEach(d => d.addEventListener("toggle", () => { if (d.open) lista.forEach(o => { if (o !== d) o.open = false; }); }));
  return lista;
}
function abrirEdicion(emp, f, hasta) {
  if (hasta) return abrirEdicionRango(emp, f, hasta);
  if (esPasado(f) && !S.me.admin) { avisoDiaBloqueado(f); return; }
  const puede = esResp() || emp.id === S.me.id;
  const actual = S.asig[emp.id + "|" + f] || "";
  const bloqueado = !esResp() && actual && S.cods[actual] && S.cods[actual].solo_responsables;
  if (!puede) { pintar(); toast(`Solo ${emp.nombre} o un responsable pueden cambiar este día`, 2500); return; }
  if (bloqueado) { pintar(); toast(`${actual} lo ha puesto un responsable; solo ellos pueden cambiarlo`, 3500); return; }
  const dlg = h("dialog", {});
  const [y, m, d] = f.split("-").map(Number);
  const elegir = async (codigo, btn) => { btn.disabled = true; await guardar(emp, f, codigo); dlg.close(); };
  const cand = esResp() && !actual && ["M", "T", "N"].includes(S.dias[f]) && hacePicoFalta(f) ? candidatosPico(f) : [];
  dlg.append(...[
    h("div", { class: "dcab" },
      h("div", {}, h("h3", {}, emp.nombre), h("p", { class: "sub" }, `${DLARGO[new Date(y, m - 1, d).getDay()]} ${d}/${m}/${y} · turno ${TURNO_NOMBRE[S.dias[f]] ? TURNO_NOMBRE[S.dias[f]].toLowerCase() : "?"}`)),
      h("button", { class: "btn mini varios", title: "Elegir hasta qué día", onclick: () => { S.rango = { emp, desde: f }; dlg.close(); toast(`Ahora toca el último día en la fila de ${emp.nombre}`, 3000); } }, h("span", { class: "vi" }, "📅"), "Varios días")),
    cand.length ? h("div", { class: "cand" }, "Candidatos a PICO (libres con su binomio ausente): " + cand.map(c => c.nombre).join(", ")) : null,
    h("div", { class: "contenido" }, seccionesCodigos(emp, actual, elegir)),
    emp.id === S.me.id ? bloqueNota(f) : null,
    h("div", { class: "fila" },
      h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cerrar"),
      actual ? h("button", { class: "btn sec", onclick: ev => elegir("", ev.currentTarget) }, "Quitar código") : null)].filter(Boolean));
  dlg.addEventListener("close", () => { dlg.remove(); pintar(); });
  document.body.append(dlg); dlg.showModal();
}
// Varios días: solo los días de servicio del rango; se saltan los libres, los pasados (salvo administrador)
// y, para quien no es responsable, los que tienen un código que solo ponen los responsables.
function abrirEdicionRango(emp, desde, hasta) {
  if (!(esResp() || emp.id === S.me.id)) { toast(`Solo ${emp.nombre} o un responsable pueden cambiar sus días`, 2500); return; }
  const todos = [];
  for (let f = desde; f <= hasta && todos.length < 120; f = nextDay(f)) todos.push(f);
  const servicio = todos.filter(f => ["M", "T", "N"].includes(turnoCiclo(f)));
  const pasados = servicio.filter(f => esPasado(f) && !S.me.admin);
  const reservados = servicio.filter(f => !esResp() && S.asig[emp.id + "|" + f] && S.cods[S.asig[emp.id + "|" + f]] && S.cods[S.asig[emp.id + "|" + f]].solo_responsables);
  const dias = servicio.filter(f => !pasados.includes(f) && !reservados.includes(f));
  if (!dias.length) { toast("En ese rango no hay ningún día de servicio que se pueda cambiar", 4000); return; }
  const pl = n => n === 1 ? "" : "s";
  const dlg = h("dialog", {});
  const msg = h("div", { class: "error" });
  const conCodigo = dias.filter(f => S.asig[emp.id + "|" + f]);
  const elegir = async (codigo, btn) => {
    let objetivo = dias;
    const distintos = dias.filter(f => S.asig[emp.id + "|" + f] && S.asig[emp.id + "|" + f] !== codigo);
    if (codigo && distintos.length) {
      const lista = distintos.map(f => `${fechaSem(f)} (${S.asig[emp.id + "|" + f]})`).join(", ");
      if (!confirm(`${distintos.length} día${pl(distintos.length)} ya tiene${distintos.length === 1 ? "" : "n"} otro código: ${lista}.\n\nAceptar = sustituirlo${distintos.length === 1 ? "" : "s"} por ${codigo}\nCancelar = dejarlo${distintos.length === 1 ? "" : "s"} como está${distintos.length === 1 ? "" : "n"}`))
        objetivo = dias.filter(f => !distintos.includes(f));
    }
    if (codigo) objetivo = objetivo.filter(f => S.asig[emp.id + "|" + f] !== codigo);
    else objetivo = objetivo.filter(f => S.asig[emp.id + "|" + f]);
    if (!objetivo.length) { dlg.close(); toast("No había nada que cambiar"); return; }
    btn.disabled = true; msg.textContent = "Guardando…";
    const { error } = codigo
      ? await sb.from("asignaciones").upsert(objetivo.map(f => ({ empleado_id: emp.id, fecha: f, codigo })), { onConflict: "empleado_id,fecha" })
      : await sb.from("asignaciones").delete().eq("empleado_id", emp.id).in("fecha", objetivo);
    if (error) { btn.disabled = false; msg.textContent = "No se pudo guardar: " + error.message; return; }
    for (const f of objetivo) {
      const k = emp.id + "|" + f;
      if (codigo) { S.asig[k] = codigo; R.asig[k] = codigo; } else { delete S.asig[k]; delete R.asig[k]; }
      if (S.picos) { if (codigo === "PICO") S.picos.add(k); else S.picos.delete(k); }
    }
    dlg.close();
    toast(codigo ? `${codigo} puesto en ${objetivo.length} día${pl(objetivo.length)}` : `Quitado el código de ${objetivo.length} día${pl(objetivo.length)}`, 3000);
  };
  const avisos = [
    todos.length > servicio.length ? `${todos.length - servicio.length} día${pl(todos.length - servicio.length)} libre${pl(todos.length - servicio.length)} del ciclo se salta${todos.length - servicio.length === 1 ? "" : "n"}.` : null,
    pasados.length ? `${pasados.length} día${pl(pasados.length)} ya pasado${pl(pasados.length)}: no se toca${pasados.length === 1 ? "" : "n"}.` : null,
    reservados.length ? `${reservados.length} día${pl(reservados.length)} con PICO/DESP: solo lo cambia un responsable.` : null].filter(Boolean);
  dlg.append(...[
    h("h3", {}, emp.nombre),
    h("p", { class: "sub rango" }, h("b", {}, `${fechaSem(desde)} → ${fechaSem(hasta)}`), ` · ${dias.length} día${pl(dias.length)} de servicio`),
    h("div", { class: "rdias" }, dias.map(f => h("span", { class: "rd" + (S.asig[emp.id + "|" + f] ? " con" : "") }, fechaSem(f), S.asig[emp.id + "|" + f] ? h("small", {}, " " + S.asig[emp.id + "|" + f]) : null))),
    avisos.length ? h("small", { class: "det" }, avisos.join(" ")) : null,
    h("div", { class: "contenido" }, seccionesCodigos(emp, "", elegir)),
    msg,
    h("div", { class: "fila" },
      h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cerrar"),
      conCodigo.length ? h("button", { class: "btn sec", onclick: ev => elegir("", ev.currentTarget) }, "Quitar códigos") : null)].filter(Boolean));
  dlg.addEventListener("close", () => { dlg.remove(); pintar(); });
  document.body.append(dlg); dlg.showModal();
}

async function guardar(emp, f, codigo) {
  const k = emp.id + "|" + f, antes = S.asig[k] || "";
  if (codigo === antes) return;
  let error;
  if (codigo) ({ error } = await sb.from("asignaciones").upsert({ empleado_id: emp.id, fecha: f, codigo }, { onConflict: "empleado_id,fecha" }));
  else ({ error } = await sb.from("asignaciones").delete().eq("empleado_id", emp.id).eq("fecha", f));
  if (error) {
    if (/días pasados/.test(error.message)) { avisoDiaBloqueado(f); return; }
    toast("No se pudo guardar: " + error.message, 6000); return;
  }
  if (codigo) { S.asig[k] = codigo; R.asig[k] = codigo; } else { delete S.asig[k]; delete R.asig[k]; }
  if (S.picos) { if (codigo === "PICO") S.picos.add(k); else S.picos.delete(k); }
  pintar();
}

function vistaHistorial() {
  const ul = h("ul", { class: "hist" }, h("li", {}, "Cargando…"));
  sb.from("cambios").select("*").order("creado_en", { ascending: false }).limit(modoAdmin() ? 400 : 60).then(({ data, error }) => {
    if (error) { ul.replaceChildren(h("li", {}, "No se pudo cargar el historial")); return; }
    const ids = new Set(S.emps.map(e => e.id));
    data = data.filter(c => ids.has(c.empleado_id)).slice(0, 60);
    ul.replaceChildren(...(data.length ? data.map(c => {
      const cuando = new Date(c.creado_en).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const txt = `${nombreEmp(c.empleado_id)} · ${fechaCorta(c.fecha)}: ${c.codigo_antes || "—"} → ${c.codigo_despues || "—"}`;
      return h("li", {}, txt, h("small", {}, `${cuando} · por ${nombreEmp(c.hecho_por)}`));
    }) : [h("li", {}, "Todavía no hay cambios.")]));
  });
  return h("div", { class: "pag" }, h("h2", {}, "Últimos cambios"), ul);
}

// ---------- formaciones y habilitaciones ----------
const fechaLarga = f => { if (!f) return "Sin fecha"; const [y, m, d] = f.split("-"); return `${d}/${m}/${y}`; };
async function cargarCursos() {
  const { data, error } = await sb.from("cursos").select("*").order("orden");
  S.cursos = error ? [] : data;
}
// Orden: primero formaciones, luego habilitaciones y luego material; dentro de cada apartado, alfabético.
const RANGO_TIPO = { "Formación": 0, "Habilitación": 1, "Material": 2 };
const alfa = (x, y) => x.localeCompare(y, "es", { numeric: true, sensitivity: "base" });
const cmpRegistros = (f, g) => (RANGO_TIPO[tipoDe(f.nombre)] ?? 0) - (RANGO_TIPO[tipoDe(g.nombre)] ?? 0)
  || alfa(f.nombre, g.nombre) || (g.fecha || "").localeCompare(f.fecha || "");
const tipoDe = nombre => { const c = (S.cursos || []).find(x => x.nombre === nombre); return c ? c.tipo : "Formación"; };
async function cargarForms() {
  const { data, error } = await sb.from("formaciones").select("*").order("fecha", { ascending: false, nullsFirst: false });
  if (error) { toast("No se pudieron cargar las formaciones: " + error.message, 6000); return; }
  S.forms = data;
}

function editarFormacion(emp, item) {
  const dlg = h("dialog", {});
  const cursos = S.cursos || [];
  const grupo = (titulo, t) => h("optgroup", { label: titulo }, cursos.filter(c => c.tipo === t).sort((x, y) => alfa(x.nombre, y.nombre)).map(c => h("option", { value: c.nombre, selected: item && item.nombre === c.nombre }, c.nombre)));
  const fuera = item && !cursos.some(c => c.nombre === item.nombre);   // registro antiguo que no está en la lista
  const nombre = h("select", {}, !item ? h("option", { value: "" }, "— Elige —") : null,
    fuera ? h("option", { value: item.nombre, selected: true }, item.nombre + " (ya no está en la lista)") : null,
    grupo("Formaciones", "Formación"), grupo("Habilitaciones", "Habilitación"), grupo("Material de dotación", "Material"));
  const fecha = h("input", { type: "date", value: item && item.fecha ? item.fecha : hoyStr() });
  const sinFecha = h("input", { type: "checkbox", checked: !!item && !item.fecha });
  const sync = () => { fecha.disabled = sinFecha.checked; };
  sinFecha.addEventListener("change", sync); sync();
  const bloqueFecha = h("div", {}, h("label", {}, "Fecha en que se hizo", fecha), h("label", { class: "check" }, sinFecha, " No recuerdo la fecha"));
  const ajustar = () => { bloqueFecha.style.display = tipoDe(nombre.value) === "Material" ? "none" : ""; };
  nombre.addEventListener("change", ajustar);
  const err = h("div", { class: "error" });
  const guardarF = async ev => {
    const n = nombre.value;
    if (!n) { err.textContent = "Elige el curso."; return; }
    const material = tipoDe(n) === "Material";
    if (!material && !sinFecha.checked && !fecha.value) { err.textContent = "Indica la fecha o marca «No recuerdo la fecha»."; return; }
    ev.target.disabled = true;
    const fila = { empleado_id: emp.id, nombre: n, fecha: material || sinFecha.checked ? null : fecha.value };
    const { error } = item ? await sb.from("formaciones").update(fila).eq("id", item.id) : await sb.from("formaciones").insert(fila);
    if (error) { ev.target.disabled = false; err.textContent = "No se pudo guardar: " + error.message; return; }
    await cargarForms(); dlg.close();
  };
  dlg.append(
    h("h3", {}, item ? "Editar" : "Añadir"), h("p", { class: "sub" }, emp.nombre),
    h("label", {}, "Curso o habilitación", nombre), bloqueFecha, err,
    h("div", { class: "fila" },
      item ? h("button", { class: "btn sec", onclick: async ev => {
        if (!confirm("¿Borrar «" + item.nombre + "»?")) return;
        ev.target.disabled = true;
        const { error } = await sb.from("formaciones").delete().eq("id", item.id);
        if (error) { ev.target.disabled = false; err.textContent = "No se pudo borrar: " + error.message; return; }
        await cargarForms(); dlg.close();
      } }, "Borrar") : h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cancelar"),
      h("button", { class: "btn", onclick: guardarF }, "Guardar")));
  dlg.addEventListener("close", () => { dlg.remove(); pintar(); });
  ajustar();
  document.body.append(dlg); dlg.showModal(); nombre.focus();
}

function vistaFormacion() {
  const cont = h("div", { class: "form-pag" });
  const lista = h("div", {});
  const buscar = h("input", { type: "search", placeholder: "Buscar curso o persona…", value: S.fq || "" });
  const pintarLista = () => {
    const q = (buscar.value || "").trim().toLowerCase();
    S.fq = buscar.value;
    const orden = S.emps.some(e => e.id === S.me.id) ? [S.me, ...S.emps.filter(e => e.id !== S.me.id)] : S.emps;
    const bloques = orden.map(e => {
      const todas = (S.forms || []).filter(f => f.empleado_id === e.id).sort(cmpRegistros);
      const coincideNombre = q && e.nombre.toLowerCase().includes(q);
      const items = q && !coincideNombre ? todas.filter(f => f.nombre.toLowerCase().includes(q) || tipoDe(f.nombre).toLowerCase().includes(q)) : todas;
      if (q && !items.length) return null;
      const puede = esResp() || e.id === S.me.id;
      const abierta = !!q || S.abiertas.has(e.id);
      return h("section", { class: "fpers" + (e.id === S.me.id ? " yo" : "") + (abierta ? " abierta" : "") },
        h("div", { class: "fcab", role: "button", tabindex: "0", "aria-expanded": String(abierta), onclick: () => { if (q) return; if (S.abiertas.has(e.id)) S.abiertas.delete(e.id); else S.abiertas.add(e.id); pintarLista(); } },
          h("span", { class: "chev" }, "›"), h("b", {}, e.id === S.me.id ? e.nombre + " (tú)" : e.nombre), h("span", { class: "fn" }, String(todas.length)),
          puede ? h("button", { class: "btn mini", onclick: ev => { ev.stopPropagation(); editarFormacion(e, null); } }, "+ Añadir") : null),
        !abierta ? null : items.length ? items.map(f => h("div", { class: "fila-f" + (puede ? " edit" : ""), onclick: puede ? () => editarFormacion(e, f) : null },
          h("span", { class: "ftipo " + ({ "Habilitación": "hab", "Material": "mat" }[tipoDe(f.nombre)] || "for") }, tipoDe(f.nombre)),
          h("span", { class: "fnom" }, f.nombre), h("span", { class: "ffecha" }, tipoDe(f.nombre) === "Material" ? "" : fechaLarga(f.fecha))))
          : h("div", { class: "vacio" }, e.id === S.me.id ? "Aún no has añadido ninguna. Pulsa «+ Añadir»." : "Sin registros"));
    }).filter(Boolean);
    lista.replaceChildren(...(bloques.length ? bloques : [h("div", { class: "vacio" }, "Nada coincide con la búsqueda.")]));
  };
  if (!S.abiertas) S.abiertas = new Set(S.emps.some(e => e.id === S.me.id) ? [S.me.id] : []);
  buscar.addEventListener("input", pintarLista);
  const todo = h("button", { class: "btn sec mini", onclick: () => { if (S.abiertas.size >= S.emps.length) S.abiertas = new Set(); else S.abiertas = new Set(S.emps.map(e => e.id)); pintarLista(); todo.textContent = S.abiertas.size >= S.emps.length ? "Plegar todo" : "Desplegar todo"; } }, "Desplegar todo");
  cont.append(h("h2", {}, "Formaciones y habilitaciones"), h("p", { class: "sub" }, esResp() ? "Cada uno puede editar las suyas; como responsable puedes editar las de todos." : "Puedes añadir, corregir o borrar las tuyas. Las de los compañeros son solo de lectura."), h("div", { class: "fbarra" }, buscar, todo), lista);
  const cargar = () => Promise.all([cargarCursos(), cargarForms()]).then(pintarLista);
  if (S.forms && S.cursos) pintarLista(); else lista.append(h("div", { class: "vacio" }, "Cargando…"));
  cargar();
  return cont;
}

// ---------- avisos al móvil (push) ----------
const b64aBytes = s => { const p = "=".repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, c => c.charCodeAt(0)); };
const pushDisponible = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
async function suscripcionActual() {
  if (!pushDisponible()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function activarAvisos() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Has bloqueado los avisos. Actívalos en los ajustes del móvil para esta app.", 6000); return false; }
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(VAPID_PUBLIC) }));
  const j = sub.toJSON();
  const { error } = await sb.from("push_subs").upsert({ endpoint: j.endpoint, empleado_id: S.me.id, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
  if (error) { toast("No se pudo guardar el aviso: " + error.message, 6000); return false; }
  return true;
}
async function desactivarAvisos() {
  const sub = await suscripcionActual();
  if (!sub) return;
  await sb.from("push_subs").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
function bloqueAvisos() {
  const estado = h("div", { class: "sub" }, "Comprobando…");
  const caja = h("div", {}, estado);
  const pintarEstado = async () => {
    if (!pushDisponible()) {
      estado.textContent = "Este navegador no permite avisos. En iPhone, instala primero la app en la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde ahí.";
      return;
    }
    const sub = await suscripcionActual();
    const on = !!sub && Notification.permission === "granted";
    estado.textContent = on ? "Avisos activados en este móvil." : (Notification.permission === "denied" ? "Avisos bloqueados en los ajustes del móvil." : "Avisos desactivados en este móvil.");
    const bs = [h("button", { class: "btn full", onclick: async ev => { ev.target.disabled = true; if (on) await desactivarAvisos(); else await activarAvisos(); pintarEstado(); } }, on ? "Desactivar avisos" : "Activar avisos")];
    if (on) bs.push(h("button", { class: "btn sec full", onclick: async () => { const r = await navigator.serviceWorker.ready; r.showNotification("Tercio", { body: "Los avisos funcionan en este móvil ✔", icon: "icon-192.png" }); } }, "Probar en este móvil"));
    caja.replaceChildren(estado, ...bs);
  };
  pintarEstado();
  return caja;
}

// ---------- mi año: los 12 meses de una persona de un vistazo ----------
function bloqueMiAnio(empId, y) {
  const cod = {};
  for (const r of S.infAnio[y] || []) if (r.empleado_id === empId) cod[r.fecha] = r.codigo;
  const hoy = hoyStr();
  const irA = (m, f) => { S.y = y; S.m = m; S.sel = f; S.vista = "cal"; S.yaScroll = false; cargarMes().then(pintar); };
  const meses = MESES.map((nombre, m) => {
    const nd = new Date(y, m + 1, 0).getDate(), hueco = (new Date(y, m, 1).getDay() + 6) % 7;
    const celdas = [];
    for (let i = 0; i < hueco; i++) celdas.push(h("span", { class: "md0" }));
    let nv = 0, np = 0;
    for (let d = 1; d <= nd; d++) {
      const f = fechaStr(y, m, d), t = turnoCiclo(f), c = cod[f];
      if (c && esVac(c)) nv++; else if (c && esAus(c)) np++;
      const cls = "md " + (c ? "c-" + grupoDe(c) : ["M", "T", "N"].includes(t) ? "s-" + t : "lib") + (f === hoy ? " hoy" : "");
      celdas.push(h("button", { class: cls, title: `${fechaSem(f)} · ${TURNO_NOMBRE[t] || "Libre"}${c ? " · " + c + (S.cods[c] && S.cods[c].descripcion ? " (" + S.cods[c].descripcion + ")" : "") : ""}`, onclick: () => irA(m, f) },
        h("span", {}, d), c ? h("i", {}, c) : null));
    }
    return h("div", { class: "mmes" },
      h("div", { class: "mtit2" }, nombre[0].toUpperCase() + nombre.slice(1),
        nv || np ? h("small", {}, [nv ? `${nv} vac` : null, np ? `${np} perm` : null].filter(Boolean).join(" · ")) : null),
      h("div", { class: "mgrid" }, ["L", "M", "X", "J", "V", "S", "D"].map(x => h("span", { class: "mds" }, x)), celdas));
  });
  return h("div", {},
    h("div", { class: "anioleyenda" },
      h("span", { class: "s-M" }, "Mañana"), h("span", { class: "s-T" }, "Tarde"), h("span", { class: "s-N" }, "Noche"),
      h("span", { class: "c-a" }, "Vacaciones y permisos"), h("span", { class: "c-t" }, "Trabajo"), h("span", { class: "c-m" }, "PICO/DESP"), h("span", { class: "c-e" }, "Otros")),
    h("div", { class: "anio12" }, meses),
    h("small", { class: "det" }, "Toca un día para abrirlo en el calendario."));
}

// ---------- informes ----------
S.infY = 0; S.infEmp = 0;
function vistaInformes() {
  const hoy = hoyStr(), anioHoy = +hoy.slice(0, 4);
  if (!S.infY) S.infY = anioHoy;
  if (!S.infEmp) S.infEmp = S.me.id;
  const cont = h("div", {});
  const filas = () => (S.infAnio[S.infY] || []).filter(r => r.fecha < hoy);   // solo lo ya disfrutado
  const dibujar = () => {
    const rows = filas();
    const sel = h("select", { class: "infsel", title: "Elegir persona", onchange: ev => { S.infEmp = +ev.target.value; dibujar(); } },
      (esResp() ? S.emps : [S.me]).map(e => h("option", { value: e.id, selected: e.id === S.infEmp }, e.nombre)));
    const propias = rows.filter(r => r.empleado_id === S.infEmp);
    const porCodigo = {};
    for (const r of propias) (porCodigo[r.codigo] = porCodigo[r.codigo] || []).push(r.fecha);
    const codigos = Object.keys(porCodigo).filter(c => !(S.cods[c] && S.cods[c].oculto)).sort((a, b) => (S.cods[a] ? S.cods[a].orden : 99) - (S.cods[b] ? S.cods[b].orden : 99));
    const totAus = propias.filter(r => esAus(r.codigo)).length, totVac = propias.filter(r => esVac(r.codigo)).length;
    const tarjetas = GRUPOS.map(([g, titulo]) => {
      const cs = codigos.filter(c => grupoDe(c) === g); if (!cs.length) return null;
      return [h("h4", {}, titulo), cs.map(c => h("details", { class: "icod" },
        h("summary", {}, h("span", { class: "cod " + claseTipo(c) }, c), h("span", { class: "idesc" }, S.cods[c] ? S.cods[c].descripcion : ""), h("b", {}, porCodigo[c].length)),
        h("div", { class: "ifechas" }, porCodigo[c].map(fechaCorta).join(" · "))))];
    });
    // reparto de picos
    const picosEmp = S.emps.filter(e => e.hace_pico !== false).map(e => {
      const mios = rows.filter(r => r.empleado_id === e.id && r.codigo === "PICO"), des = rows.filter(r => r.empleado_id === e.id && r.codigo === "DESP");
      return { e, n: mios.length, d: des.length, ult: mios.length ? mios[mios.length - 1].fecha : "" };
    }).sort((a, b) => b.n - a.n || a.e.orden - b.e.orden);
    cont.replaceChildren(
      h("div", { class: "mes" },
        h("button", { disabled: S.infY <= S.anioMin, onclick: async () => { S.infY--; await cargarAnio(S.infY); dibujar(); } }, "‹"), h("b", {}, S.infY),
        h("button", { disabled: S.infY >= S.anioMax, onclick: async () => { S.infY++; await cargarAnio(S.infY); dibujar(); } }, "›"),
        esResp() ? h("div", { class: "mesacc" }, sel) : null),
      h("div", { class: "pag anchoanio" },
        h("h2", {}, S.infEmp === S.me.id ? "Mi año" : `Año de ${nombreEmp(S.infEmp)}`), bloqueMiAnio(S.infEmp, S.infY)),
      h("div", { class: "pag ancho" },
        h("h2", {}, S.infEmp === S.me.id ? "Mis días" : `Días de ${nombreEmp(S.infEmp)}`), esResp() ? null : h("p", { class: "sub" }, S.me.nombre),
        h("p", { class: "sub" }, "Solo cuentan los días ya pasados."),
        h("div", { class: "itot" }, h("div", {}, h("b", {}, totAus), h("small", {}, "ausencias justificadas")), h("div", {}, h("b", {}, totVac), h("small", {}, "de vacaciones"))),
        codigos.length ? tarjetas : h("p", { class: "det" }, "Todavía no hay días apuntados.")),
      h("div", { class: "pag ancho" },
        h("h2", {}, "Reparto de picos"), h("p", { class: "sub" }, "Picos ya hechos este año, de más a menos."),
        h("table", { class: "ipicos" }, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Picos"), h("th", {}, "Desplazado"), h("th", {}, "Último pico"))),
          h("tbody", {}, picosEmp.map(x => h("tr", {}, h("td", {}, x.e.nombre), h("td", {}, h("b", {}, x.n)), h("td", {}, x.d), h("td", {}, x.ult ? fechaLarga(x.ult) : "–"))))),
        null));
  };
  dibujar();
  cargarAnio(S.infY).then(dibujar);   // refresca al entrar
  return cont;
}

// ---------- modo administrador: elegir y crear turnos/distritos ----------
function distritoVacio() {
  if (!S.dist.id) return h("div", { class: "pag" }, h("h2", {}, `Turno ${S.dist.turno}`),
    h("p", {}, "Este turno todavía no tiene ningún distrito."),
    h("button", { class: "btn", onclick: () => crearDistrito(S.dist.letra, S.dist.zona) }, `+ Crear un distrito en ${S.dist.turno}`));
  return h("div", { class: "pag" }, h("h2", {}, `${S.dist.nombre} · ${S.dist.turno}`),
    h("p", {}, "Este distrito todavía no tiene personas dadas de alta."),
    h("p", { class: "sub" }, `Turno ${S.dist.letra}, zona ${S.dist.zona}. Su calendario ya sigue el ciclo del turno ${S.dist.letra}.`),
    h("button", { class: "btn", onclick: () => abrirPersonas() }, "+ Dar de alta personas"));
}
// ---------- desplegables de la cabecera (modo administrador) ----------
function abrirMenu(ancla, contenido) {
  cerrarMenu();
  const r = ancla.getBoundingClientRect();
  const m = h("div", { class: "menu", id: "menuCab", role: "menu" }, contenido);
  m.style.top = (r.bottom + 6) + "px";
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - 300)) + "px";
  document.body.append(m);
  setTimeout(() => document.addEventListener("click", fueraMenu, true), 0);
}
function fueraMenu(ev) { const m = document.getElementById("menuCab"); if (m && !m.contains(ev.target)) { ev.stopPropagation(); ev.preventDefault(); cerrarMenu(); } }
function cerrarMenu() { const m = document.getElementById("menuCab"); if (m) m.remove(); document.removeEventListener("click", fueraMenu, true); }
const distritosDe = (letra, zona) => (S.distritos || []).filter(d => d.letra === letra && d.zona === zona);
const personasDe = id => (S.todos || []).filter(e => e.distrito_id === id).length;
function irATurno(letra, zona) {
  cerrarMenu();
  const ds = distritosDe(letra, zona);
  const mio = ds.find(d => d.id === S.me.distrito_id);
  cambiarDistrito(mio || ds[0] || { id: null, nombre: "Sin distritos", letra, zona, minimo_operativo: 6, tercio: 4 });
}
function menuTurnos(ancla) {
  abrirMenu(ancla, [h("div", { class: "mtit" }, "Turno"),
    h("div", { class: "rejilla" }, [...LETRAS].flatMap(l => [1, 2].map(z => {
      const n = distritosDe(l, z).length, act = S.dist.letra === l && S.dist.zona === z;
      return h("button", { class: "mt" + (act ? " act" : "") + (n ? "" : " vacio"), title: n ? `${n} distrito${n === 1 ? "" : "s"}` : "Sin distritos", onclick: () => irATurno(l, z) }, l + z, h("small", {}, n || "–"));
    })))]);
}
function menuDistritos(ancla) {
  const ds = distritosDe(S.dist.letra, S.dist.zona);
  abrirMenu(ancla, [h("div", { class: "mtit" }, `Distritos del ${S.dist.turno}`),
    ds.length ? ds.map(d => h("button", { class: "md" + (d.id === S.dist.id ? " act" : ""), onclick: () => { cerrarMenu(); cambiarDistrito(d); } },
      h("span", {}, d.nombre), h("small", {}, `${personasDe(d.id)} persona${personasDe(d.id) === 1 ? "" : "s"}`)))
      : h("div", { class: "mvacio" }, "Todavía no hay distritos en este turno."),
    h("hr"),
    S.dist.id ? h("button", { class: "md acc", onclick: () => { cerrarMenu(); abrirPersonas(); } }, `👥 Personas de ${S.dist.nombre}`) : null,
    h("button", { class: "md acc", onclick: () => { cerrarMenu(); crearDistrito(S.dist.letra, S.dist.zona); } }, `+ Crear un distrito en ${S.dist.turno}`)]);
}
function crearDistrito(letra, zona) {
  const dlg = h("dialog", { class: "seldist" });
  const nombre = h("input", { type: "text", placeholder: "Nombre del distrito", maxlength: "60" });
  const minimo = h("input", { type: "number", min: "1", max: "50", value: "6" });
  const err = h("div", { class: "error" });
  const crear = async ev => {
    const n = nombre.value.trim();
    if (!n) { err.textContent = "Escribe el nombre del distrito."; return; }
    const btn = ev.currentTarget; btn.disabled = true; err.textContent = "Creando…";
    const { data, error } = await sb.from("distritos")
      .insert({ nombre: n, letra, zona, minimo_operativo: +minimo.value || 6 }).select().single();
    if (error) { btn.disabled = false; err.textContent = /duplicate|unique/i.test(error.message) ? "Ya existe un distrito con ese nombre en este turno." : "No se pudo crear: " + error.message; return; }
    await cargarDistritos(); dlg.close(); toast(`Distrito «${data.nombre}» creado en ${letra}${zona}`, 3000);
    cambiarDistrito(data);
  };
  dlg.append(h("h3", {}, `Nuevo distrito en ${letra}${zona}`),
    h("div", { class: "nuevodist", style: "border:0;margin:0;padding:0" },
      h("label", {}, "Nombre", nombre),
      h("label", {}, "Mínimo de personas trabajando", minimo),
      h("small", { class: "det" }, "El tercio (máximo de ausentes) se calcula solo: la tercera parte de las personas del distrito.")),
    err, h("div", { class: "fila" }, h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cancelar"), h("button", { class: "btn", onclick: crear }, "Crear distrito")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); nombre.focus();
}
function bloqueAdmin() {
  const on = modoAdmin();
  return [h("h3", {}, "Modo administrador"),
    h("p", { class: "sub" }, on
      ? `Activado. Estás viendo ${S.dist.nombre} (${S.dist.turno}). Arriba, pulsa el recuadro del turno para cambiar de turno, y el nombre del distrito para cambiar de distrito, crear uno nuevo o gestionar sus personas.`
      : "Solo lo tienes tú. Te deja ver cualquier turno y distrito y crear distritos nuevos. Apagado, ves tu distrito como siempre."),
    h("div", { class: "opciones" },
      h("button", { class: "btn sec" + (on ? "" : " act"), onclick: async () => { if (!on) return; ponerLS(ADMIN_KEY, null); ponerLS(DIST_KEY, null); await cambiarDistrito(miDistrito()); } }, "Apagado"),
      h("button", { class: "btn sec" + (on ? " act" : ""), onclick: async () => { if (on) return; ponerLS(ADMIN_KEY, "1"); await cargarDistritos(); pintar(); } }, "Encendido")),
    on && S.dist.id ? h("button", { class: "btn full", onclick: () => abrirPersonas() }, `👥 Personas de ${S.dist.nombre}`) : null];
}

// ---------- personas del distrito (solo administrador) ----------
async function recargarEmpleados() {
  const { data, error } = await sb.from("empleados").select("*").order("orden");
  if (error) { toast("No se pudo recargar la lista: " + error.message, 6000); return; }
  S.fichas = data; S.todos = data.filter(x => x.activo);
  S.me = S.todos.find(x => x.id === S.me.id) || S.me;
  const sel = S.dist;
  S.emps = S.todos.filter(e => e.distrito_id === sel.id && !e.fuera);
  S.tercio = tercioDe(S.emps.length, sel.tercio);   // si alguien se da de baja o de alta, el tercio se recalcula
}
function abrirPersonas() {
  const dlg = h("dialog", { class: "seldist" });
  const cont = h("div", {});
  const ROL = { responsable: "Responsable", agente: "Agente" };
  const dibujar = () => {
    const del = (S.fichas || []).filter(e => e.distrito_id === S.dist.id);
    const activas = del.filter(e => e.activo && !e.fuera), fuera = del.filter(e => e.activo && e.fuera), bajas = del.filter(e => !e.activo);
    const cambiarRol = async (e, btn) => {
      const nuevo = e.rol === "responsable" ? "agente" : "responsable";
      if (e.id === S.me.id && nuevo === "agente") { toast("No puedes quitarte a ti mismo de responsable.", 3500); return; }
      if (!confirm(nuevo === "responsable" ? `¿Hacer responsable a ${e.nombre}? Podrá editar a todo su distrito y poner PICO y DESP.` : `¿Quitar a ${e.nombre} de responsable? Pasará a editar solo sus propios días.`)) return;
      btn.disabled = true;
      const { error } = await sb.from("empleados").update({ rol: nuevo }).eq("id", e.id);
      if (error) { btn.disabled = false; toast("No se pudo cambiar: " + error.message, 6000); return; }
      await recargarEmpleados(); dibujar();
    };
    const fila = e => h("div", { class: "persona" },
      h("button", { class: "pcol", title: "Editar datos, baja o borrar", onclick: () => editarPersona(e, dibujar) },
        h("b", {}, e.nombre), h("small", { class: "correo" }, e.email || "sin correo"),
        h("small", {}, (ROL[e.rol] || e.rol) + (e.admin ? " · admin" : "") + (e.hace_pico === false ? " · sin PICO" : "") + (e.pareja_id ? " · binomio: " + nombreEmp(e.pareja_id) : ""))),
      e.id === S.me.id ? null : h("button", { class: "btn mini " + (e.rol === "responsable" ? "sec" : ""), onclick: ev => cambiarRol(e, ev.currentTarget) }, e.rol === "responsable" ? "Quitar responsable" : "Hacer responsable"));
    cont.replaceChildren(...[
      h("p", { class: "sub" }, `${activas.length} persona${activas.length === 1 ? "" : "s"} en ${S.dist.nombre} (${S.dist.turno}). Pulsa en alguien para cambiar sus datos, darle de baja o borrarlo.`),
      h("button", { class: "btn full", onclick: () => editarPersona(null, dibujar) }, "+ Dar de alta a una persona"),
      h("div", { class: "distlista" }, activas.map(fila)),
      fuera.length ? [h("h4", {}, "Fuera temporalmente"), h("p", { class: "sub" }, "Pueden entrar y ver el calendario, pero no salen en él, no cuentan en el tercio ni en el PICO."),
        h("div", { class: "distlista" }, fuera.map(e => h("div", { class: "persona fuera" },
          h("button", { class: "pcol", onclick: () => editarPersona(e, dibujar) }, h("b", {}, e.nombre), h("small", {}, e.pareja_id ? "binomio: " + nombreEmp(e.pareja_id) : "sin binomio")),
          h("button", { class: "btn mini", onclick: async ev => {
            if (!confirm(`¿${e.nombre} vuelve al equipo? Volverá a salir en el calendario y a contar en el tercio y el PICO.`)) return;
            ev.currentTarget.disabled = true;
            const { error } = await sb.from("empleados").update({ fuera: false }).eq("id", e.id);
            if (error) { ev.currentTarget.disabled = false; toast("No se pudo: " + error.message, 6000); return; }
            await recargarEmpleados(); dibujar(); pintar(); toast(`${e.nombre} vuelve al equipo`, 3000);
          } }, "Vuelve al equipo"))))] : null,
      bajas.length ? [h("h4", {}, "De baja"), h("div", { class: "distlista" }, bajas.map(e => h("button", { class: "btn sec full persona baja", onclick: async ev => {
        if (!confirm(`¿Volver a dar de alta a ${e.nombre}? Podrá entrar otra vez con su correo y su contraseña.`)) return;
        ev.currentTarget.disabled = true;
        const { error } = await sb.from("empleados").update({ activo: true }).eq("id", e.id);
        if (error) { toast("No se pudo: " + error.message, 6000); return; }
        await recargarEmpleados(); dibujar(); pintar();
      } }, h("span", {}, e.nombre), h("small", {}, "Reactivar"))))] : null].flat().filter(Boolean));
  };
  dibujar();
  dlg.append(h("h3", {}, `Personas · ${S.dist.nombre} (${S.dist.turno})`), cont, h("div", { class: "fila" }, h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cerrar")));
  dlg.addEventListener("close", () => { dlg.remove(); pintar(); });
  document.body.append(dlg); dlg.showModal();
}
const claveProvisional = () => { const L = "abcdefghjkmnpqrstuvwxyz", N = "23456789", r = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  return Array.from({ length: 6 }, () => L[r(L.length)]).join("") + Array.from({ length: 3 }, () => N[r(N.length)]).join(""); };
async function ponerPareja(id, parejaId) {
  // La pareja es de ida y vuelta: si A es pareja de B, B es pareja de A. Se deshacen las anteriores.
  const f = id => (S.fichas || []).find(e => e.id === id) || {};
  const antes = f(id).pareja_id || null;
  if (antes === parejaId) return null;
  const cambios = [];
  if (antes && f(antes).pareja_id === id) cambios.push([antes, null]);
  if (parejaId) { const suya = f(parejaId).pareja_id; if (suya && suya !== id) cambios.push([suya, null]); cambios.push([parejaId, id]); }
  cambios.push([id, parejaId]);
  for (const [a, b] of cambios) { const { error } = await sb.from("empleados").update({ pareja_id: b }).eq("id", a); if (error) return error; }
  return null;
}
function editarPersona(emp, alVolver) {
  const nueva = !emp;
  const dlg = h("dialog", { class: "seldist" });
  const nombre = h("input", { type: "text", maxlength: "40", value: emp ? emp.nombre : "", placeholder: "Como aparecerá en el calendario" });
  const email = h("input", { type: "email", placeholder: "correo@ejemplo.com", autocomplete: "off" });
  const clave = h("input", { type: "text", value: claveProvisional(), autocomplete: "off" });
  const rol = h("select", {}, [["agente", "Agente"], ["responsable", "Responsable"]].map(([v, t]) => h("option", { value: v, selected: emp ? emp.rol === v : v === "agente" }, t)));
  const pico = h("input", { type: "checkbox", checked: emp ? emp.hace_pico !== false : true });
  const fueraChk = h("input", { type: "checkbox", checked: !!(emp && emp.fuera) });
  const otros = S.todos.filter(e => e.distrito_id === S.dist.id && (!emp || e.id !== emp.id));
  const pareja = h("select", {}, h("option", { value: "" }, "— Sin binomio —"), otros.map(e => h("option", { value: e.id, selected: emp && emp.pareja_id === e.id }, e.nombre)));
  const err = h("div", { class: "error" });
  const guardarP = async ev => {
    const btn = ev.currentTarget, n = nombre.value.trim();
    if (!n) { err.textContent = "Escribe el nombre."; return; }
    btn.disabled = true; err.textContent = nueva ? "Creando la cuenta…" : "Guardando…";
    let id = emp && emp.id, cuentaNueva = true;
    if (nueva) {
      const { data, error } = await sb.functions.invoke("alta", { body: { nombre: n, email: email.value.trim(), clave: clave.value, rol: rol.value, hace_pico: pico.checked, distrito_id: S.dist.id } });
      let msg = data && data.error;
      if (error) { try { msg = (await error.context.json()).error; } catch (e) { msg = msg || error.message; } }
      if (msg || !data) { btn.disabled = false; err.textContent = msg || "No se pudo dar de alta."; return; }
      id = data.empleado.id; cuentaNueva = data.cuentaNueva;
    } else {
      const cambios = { nombre: n, rol: rol.value, hace_pico: pico.checked };
      if (fueraChk.checked !== !!emp.fuera) cambios.fuera = fueraChk.checked;
      const { error } = await sb.from("empleados").update(cambios).eq("id", id);
      if (error && /fuera/.test(error.message)) { btn.disabled = false; err.textContent = "Falta ejecutar en Supabase la migración 019 (fuera temporalmente)."; return; }
      if (error) { btn.disabled = false; err.textContent = /duplicate|unique/i.test(error.message) ? "Ya hay alguien con ese nombre en este distrito." : "No se pudo guardar: " + error.message; return; }
    }
    await recargarEmpleados();
    const e2 = await ponerPareja(id, pareja.value ? +pareja.value : null);
    if (e2) toast("Guardado, pero no se pudo poner el binomio: " + e2.message, 6000);
    await recargarEmpleados();
    dlg.close(); if (alVolver) alVolver();
    if (nueva) avisoAlta(n, email.value.trim().toLowerCase(), clave.value, cuentaNueva);
  };
  const baja = emp && emp.id !== S.me.id ? h("button", { class: "btn sec", onclick: async ev => {
    if (!confirm(`¿Dar de baja a ${emp.nombre}? Dejará de poder entrar y de salir en el calendario. Sus días apuntados se conservan y se puede reactivar.`)) return;
    ev.currentTarget.disabled = true;
    await ponerPareja(emp.id, null);
    const { error } = await sb.from("empleados").update({ activo: false }).eq("id", emp.id);
    if (error) { ev.currentTarget.disabled = false; err.textContent = "No se pudo: " + error.message; return; }
    await recargarEmpleados(); dlg.close(); if (alVolver) alVolver();
  } }, "Dar de baja") : null;
  const borrar = emp && emp.id !== S.me.id ? h("button", { class: "btn peligro", onclick: async ev => {
    const btn = ev.currentTarget;
    btn.disabled = true; err.textContent = "Comprobando…";
    const [a, f] = await Promise.all([
      sb.from("asignaciones").select("fecha", { count: "exact", head: true }).eq("empleado_id", emp.id),
      sb.from("formaciones").select("id", { count: "exact", head: true }).eq("empleado_id", emp.id)]);
    btn.disabled = false; err.textContent = "";
    const nA = a.count || 0, nF = f.count || 0;
    if (a.error || f.error) { err.textContent = "No se pudo comprobar su historial."; return; }
    if (nA || nF) { err.textContent = `No se puede borrar: tiene ${nA} día${nA === 1 ? "" : "s"} apuntado${nA === 1 ? "" : "s"} y ${nF} formación${nF === 1 ? "" : "es"}. Usa «Dar de baja»: deja de entrar pero su historial se conserva.`; return; }
    // Doble aviso
    if (!confirm(`¿BORRAR a ${emp.nombre} para siempre?\n\nEsto no se puede deshacer. Si solo deja el equipo, usa «Dar de baja».`)) return;
    const escrito = prompt(`Segundo aviso. Para confirmar, escribe el nombre exacto: ${emp.nombre}`);
    if (escrito == null) return;
    if (escrito.trim() !== emp.nombre) { err.textContent = "El nombre no coincide. No se ha borrado nada."; return; }
    btn.disabled = true;
    await ponerPareja(emp.id, null);
    const { error } = await sb.from("empleados").delete().eq("id", emp.id);
    if (error) { btn.disabled = false; err.textContent = /foreign key|violates/i.test(error.message) ? "No se puede borrar porque aparece en el historial de cambios de otros. Usa «Dar de baja»." : "No se pudo borrar: " + error.message; return; }
    await recargarEmpleados(); dlg.close(); if (alVolver) alVolver(); toast(`${emp.nombre} borrado`, 3000);
  } }, "Borrar") : null;
  dlg.append(
    h("h3", {}, nueva ? "Dar de alta" : emp.nombre), h("p", { class: "sub" }, `${S.dist.nombre} · ${S.dist.turno}`),
    h("div", { class: "nuevodist", style: "border:0;margin:0;padding:0" },
      h("label", {}, "Nombre", nombre),
      nueva ? [h("label", {}, "Correo (con el que entrará)", email), h("label", {}, "Contraseña provisional", clave),
        h("small", { class: "det" }, "Se la das tú. La primera vez que entre, la app le pedirá que elija la suya.")] : h("small", { class: "det" }, emp.email || ""),
      h("label", {}, "Papel", rol),
      h("label", {}, "Binomio", pareja),
      h("label", { class: "check" }, pico, " Hace PICO"),
      !nueva && emp.id !== S.me.id ? [h("label", { class: "check" }, fueraChk, " Fuera temporalmente (en otro equipo)"),
        h("small", { class: "det" }, "Sigue pudiendo entrar y ver el calendario, pero no sale en él ni cuenta en el tercio ni en el PICO. Su binomio queda como «sin binomio» mientras tanto.")] : null),
    err,
    emp ? h("div", { class: "fila peligros" }, baja, borrar) : null,
    h("div", { class: "fila" }, h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cancelar"),
      h("button", { class: "btn", onclick: guardarP }, nueva ? "Dar de alta" : "Guardar")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); nombre.focus();
}
function avisoAlta(nombre, email, clave, cuentaNueva) {
  const texto = cuentaNueva
    ? `Hola ${nombre}, ya tienes acceso a Tercio.\nEntra en ${location.origin} con:\nCorreo: ${email}\nContraseña provisional: ${clave}\nAl entrar te pedirá que elijas tu propia contraseña.`
    : `Hola ${nombre}, ya tienes acceso a Tercio en ${location.origin}. Entra con tu correo (${email}) y tu contraseña de siempre.`;
  const dlg = h("dialog", {});
  dlg.append(h("h3", {}, "Alta hecha ✔"),
    h("p", {}, cuentaNueva ? "Pásale estos datos para que pueda entrar:" : "Ese correo ya tenía cuenta, así que conserva su contraseña. Pásale este mensaje:"),
    h("pre", { class: "mensajeAlta" }, texto),
    h("div", { class: "fila" },
      h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cerrar"),
      h("button", { class: "btn", onclick: async ev => { try { await navigator.clipboard.writeText(texto); ev.currentTarget.textContent = "Copiado ✔"; } catch (e) { toast("No se pudo copiar; selecciona el texto a mano"); } } }, "Copiar mensaje")));
  dlg.addEventListener("close", () => { dlg.remove(); pintar(); });
  document.body.append(dlg); dlg.showModal();
}

// ---------- copia de seguridad (solo administrador) ----------
async function leerTodo(tabla, orden) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select("*").order(orden).range(desde, desde + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const xmlEsc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function hojaXml(nombre, filas) {
  const cols = filas.length ? Object.keys(filas[0]) : [];
  const cel = v => `<Cell><Data ss:Type="${typeof v === "number" ? "Number" : "String"}">${xmlEsc(v)}</Data></Cell>`;
  return `<Worksheet ss:Name="${xmlEsc(nombre)}"><Table><Row>${cols.map(cel).join("")}</Row>` +
    filas.map(f => `<Row>${cols.map(c => cel(f[c])).join("")}</Row>`).join("") + `</Table></Worksheet>`;
}
async function descargarCopia(btn, msg) {
  btn.disabled = true; msg.textContent = "Preparando la copia…";
  try {
    const t = [["Calendario", "dias", "fecha"], ["Asignaciones", "asignaciones", "fecha"], ["Empleados", "empleados", "orden"], ["Codigos", "codigos", "orden"], ["Distritos", "distritos", "id"],
      ["Formaciones", "formaciones", "id"], ["Cursos", "cursos", "orden"], ["Cambios", "cambios", "creado_en"]];
    const hojas = [];
    for (const [n, tabla, ord] of t) hojas.push(hojaXml(n, await leerTodo(tabla, ord)));
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${hojas.join("")}</Workbook>`;
    const a = h("a", { href: URL.createObjectURL(new Blob([xml], { type: "application/xml" })), download: `copia-tercio-${hoyStr()}.xml` });
    document.body.append(a); a.click(); a.remove();
    msg.textContent = "Copia descargada ✔ (ábrela con Excel)";
  } catch (e) { msg.textContent = "No se pudo hacer la copia: " + (e.message || e); }
  btn.disabled = false;
}

// ---------- calendario en el móvil ----------
function bloqueCalendario() {
  const caja = h("div", {}, h("p", { class: "sub" }, "Cargando…"));
  const nuevoToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
  const urlDe = t => `${SUPABASE_URL}/functions/v1/calendario?t=${t}`;
  const dibujar = token => {
    if (!token) {
      caja.replaceChildren(h("button", { class: "btn sec full", onclick: async () => {
        const t = nuevoToken(); const { error } = await sb.from("calendario_tokens").upsert({ empleado_id: S.me.id, token: t }, { onConflict: "empleado_id" });
        if (error) { toast("No se pudo crear el enlace"); return; } dibujar(t);
      } }, "Crear mi enlace"));
      return;
    }
    const url = urlDe(token), msg = h("small", { class: "det" }, "");
    caja.replaceChildren(
      h("input", { type: "text", readonly: true, value: url, onfocus: ev => ev.target.select() }),
      h("div", { class: "fila" },
        h("button", { class: "btn sec mini", onclick: async () => { try { await navigator.clipboard.writeText(url); msg.textContent = "Enlace copiado ✔"; } catch (e) { msg.textContent = "Mantén pulsado el enlace para copiarlo."; } } }, "Copiar"),
        h("a", { class: "btn sec mini", href: url.replace(/^https:/, "webcal:") }, "iPhone: añadir al calendario"),
        h("a", { class: "btn sec mini", target: "_blank", rel: "noopener", href: "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(url.replace(/^https:/, "webcal:")) }, "Android: añadir a Google Calendar"),
        h("button", { class: "btn sec mini", onclick: async () => { if (!confirm("El enlace anterior dejará de funcionar. ¿Crear uno nuevo?")) return;
          const t = nuevoToken(); const { error } = await sb.from("calendario_tokens").upsert({ empleado_id: S.me.id, token: t }, { onConflict: "empleado_id" }); if (!error) dibujar(t); } }, "Cambiar enlace")),
      msg, h("p", { class: "sub" }, "Es privado: quien lo tenga ve tus turnos. No lo compartas."),
      h("p", { class: "sub" }, "Android: si el botón no te lo añade, copia el enlace, abre calendar.google.com (desde el ordenador o con «Sitio de escritorio» en el navegador del móvil), entra en Otros calendarios → Desde URL y pégalo. Después aparece en la app Calendario de tu Android. Google lo actualiza solo, pero puede tardar hasta un día en reflejar los cambios."));
  };
  sb.from("calendario_tokens").select("token").eq("empleado_id", S.me.id).maybeSingle().then(({ data, error }) => {
    if (error) caja.replaceChildren(h("p", { class: "sub" }, "No disponible todavía."));
    else dibujar(data ? data.token : null);
  });
  return caja;
}

function vistaCuenta() {
  const msgCopia = h("div", { class: "sub" });
  const p1 = h("input", { type: "password", placeholder: "Nueva contraseña (mín. 8 caracteres)", autocomplete: "new-password" });
  const p2 = h("input", { type: "password", placeholder: "Repite la contraseña", autocomplete: "new-password" });
  const msg = h("div", { class: "error" });
  return h("div", { class: "pag" },
    h("h2", {}, S.me.nombre), h("p", {}, (S.me.rol === "responsable" ? "Responsable" : "Agente") + " · " + S.me.email),
    h("h3", {}, "Avisos de cambios"),
    h("p", { class: "sub" }, "Recibe una notificación cuando alguien del equipo apunte o cambie un código."),
    bloqueAvisos(),
    h("h3", {}, "Calendario en el móvil"),
    h("p", { class: "sub" }, "Tus turnos y vacaciones dentro de la aplicación Calendario de tu teléfono, al día automáticamente."),
    bloqueCalendario(),
    h("h3", {}, "Apariencia"),
    h("div", { class: "opciones" }, [["auto", "Automático"], ["claro", "Claro"], ["oscuro", "Oscuro"]].map(([v, t]) =>
      h("button", { class: "btn sec" + (miTema() === v ? " act" : ""), onclick: () => { try { localStorage.setItem("tema", v); } catch (e) {} aplicarTema(); pintar(); } }, t))),
    h("h3", {}, "Cambiar contraseña"), p1, p2,
    h("button", { class: "btn full", onclick: async () => {
      if (p1.value.length < 8) { msg.textContent = "Mínimo 8 caracteres."; return; }
      if (p1.value !== p2.value) { msg.textContent = "No coinciden."; return; }
      const { error } = await sb.auth.updateUser({ password: p1.value });
      msg.textContent = error ? "No se pudo cambiar: " + error.message : "Contraseña cambiada ✔";
      if (!error) { p1.value = p2.value = ""; sb.rpc("marcar_clave_cambiada"); }
    } }, "Guardar contraseña"), msg,
    S.me.admin ? bloqueAdmin() : null,
    S.me.admin ? [h("h3", {}, "Copia de seguridad"), h("p", { class: "sub" }, "Descarga todo (calendario, asignaciones, formaciones y cambios) en un archivo que abre Excel. Guárdalo de vez en cuando."),
      h("button", { class: "btn sec full", onclick: ev => descargarCopia(ev.currentTarget, msgCopia) }, "Descargar copia"), msgCopia] : null,
    h("hr"), h("button", { class: "btn sec full", onclick: salir }, "Cerrar sesión"));
}

if ("serviceWorker" in navigator) {
  // Aviso de versión nueva: cuando el service worker nuevo toma el control (y no es la primera instalación) se enseña una barra para recargar.
  let habiaControl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habiaControl) { habiaControl = true; return; }
    if (document.getElementById("barraActualizar")) return;
    document.body.append(h("div", { id: "barraActualizar", role: "status" },
      h("span", {}, "Hay una versión nueva de la app."),
      h("button", { onclick: () => location.reload() }, "Actualizar")));
  });
  navigator.serviceWorker.register("sw.js").then(reg => {
    const buscar = () => { reg.update().catch(() => {}); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) buscar(); });
    setInterval(buscar, 30 * 60 * 1000);
  }).catch(() => {});
}
arrancar();
})();
