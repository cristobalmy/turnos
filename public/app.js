(() => {
"use strict";
const { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC } = window.TURNOS_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $app = document.getElementById("app");

const S = { me: null, emps: [], cods: {}, minimo: 6, tercio: 4, y: 0, m: 0, dias: {}, asig: {}, vista: "res", canal: null, rsel: {} };
const R = { dias: {}, asig: {} };   // datos del resumen (turno actual y siguiente), independientes del mes que se vea
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
const nombreEmp = id => (S.emps.find(e => e.id === id) || {}).nombre || "?";
const esResp = () => S.me && S.me.rol === "responsable";
function toast(msg, ms = 5000) {
  const t = h("div", { class: "toast" }, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}
// Grupo visual de un código: los que solo ponen los responsables (PICO, DESP) son "modificadores".
const grupoDe = c => { const x = S.cods[c]; if (!x) return "e"; if (x.solo_responsables) return "m"; return x.tipo === "Ausencia Justificada" ? "a" : x.tipo === "Tipo trabajo" ? "t" : "e"; };
const claseTipo = c => ({ a: "t-Ausencia", t: "t-Trabajo", m: "t-Mod", e: "t-Especial" })[grupoDe(c)];

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
  $app.replaceChildren(h("div", { class: "login" }, h("h1", {}, "Turno D"), h("div", { class: "sub" }, "Usera – Villaverde"), f));
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
  S.emps = e.data.filter(x => x.activo);
  S.cods = Object.fromEntries(c.data.map(x => [x.codigo, x]));
  const mc = (cfg.data || []).find(x => x.clave === "minimo_operativo");
  if (mc) S.minimo = +mc.valor || 6;
  const tc = (cfg.data || []).find(x => x.clave === "tercio");
  if (tc) S.tercio = +tc.valor || 4;
  S.me = S.emps.find(x => (x.email || "").toLowerCase() === email) || null;
  if (!S.me) return sinAcceso("Tu cuenta no está autorizada en Turno D. Habla con un responsable.");
  if (S.me.clave_cambiada === false) return pantallaNuevaClave(true);
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
  $app.replaceChildren(h("div", { class: "login" }, h("h1", {}, "Turno D"), h("p", { class: "error" }, msg),
    h("button", { class: "btn", onclick: salir }, "Salir")));
}
async function salir() { await sb.auth.signOut(); if (S.canal) sb.removeChannel(S.canal); S.canal = null; pantallaLogin(); }

// ---------- datos del mes ----------
async function cargarMes() {
  const desde = fechaStr(S.y, S.m, 1), hasta = fechaStr(S.y, S.m, new Date(S.y, S.m + 1, 0).getDate());
  const [d, a] = await Promise.all([
    sb.from("dias").select("fecha,turno").gte("fecha", desde).lte("fecha", hasta),
    sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", desde).lte("fecha", hasta),
  ]);
  if (d.error || a.error) { toast("Error al cargar el mes"); return; }
  S.dias = Object.fromEntries(d.data.map(x => [x.fecha, x.turno]));
  S.asig = Object.fromEntries(a.data.map(x => [x.empleado_id + "|" + x.fecha, x.codigo]));
  // Hoy y mañana también (para la recomendación de pico), aunque se esté viendo otro mes.
  const t = new Date(), h0 = fechaStr(t.getFullYear(), t.getMonth(), t.getDate()), t2 = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1), h1 = fechaStr(t2.getFullYear(), t2.getMonth(), t2.getDate());
  if (!(h0 >= desde && h1 <= hasta)) {
    const [d2, a2] = await Promise.all([
      sb.from("dias").select("fecha,turno").gte("fecha", h0).lte("fecha", h1),
      sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", h0).lte("fecha", h1),
    ]);
    if (!d2.error && !a2.error) {
      for (const x of d2.data) if (!(x.fecha in S.dias)) S.dias[x.fecha] = x.turno;
      for (const x of a2.data) { const k = x.empleado_id + "|" + x.fecha; if (!(k in S.asig)) S.asig[k] = x.codigo; }
    }
  }
}

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
      if (c.hecho_por === S.me.id) return;
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
  // libre (sin código) y su pareja ausente
  return S.emps.filter(e => {
    if (e.hace_pico === false) return false;
    if (A[e.id + "|" + f]) return false;
    if (!e.pareja_id) return false;
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
    h("div", { class: "marca" }, h("i", {}, "D"), "Turno D"),
    h("nav", { class: "tabs" }, b("res", "Resumen"), b("cal", "Calendario"), b("form", "Formación"), b("inf", "Informes"), b("hist", "Cambios"), b("cuenta", "Cuenta")),
    h("span", { class: "yo" }, S.me.nombre));
}
function pintar() {
  const w = $app.querySelector(".wrap");
  const pos = w ? [w.scrollLeft, w.scrollTop] : null;
  const cuerpo = S.vista === "res" ? vistaResumen() : S.vista === "cal" ? vistaCalendario() : S.vista === "hist" ? vistaHistorial() : S.vista === "form" ? vistaFormacion() : S.vista === "inf" ? vistaInformes() : vistaCuenta();
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
// El ciclo son bloques de 12 días desde el 1/1/2026: 6 de servicio (M M T T N N) y 6 de descanso.
const BASE = new Date(2026, 0, 1);
function bloqueFechas(k) {
  return Array.from({ length: 6 }, (_, i) => { const x = new Date(2026, 0, 1 + 12 * k + i); return fechaStr(x.getFullYear(), x.getMonth(), x.getDate()); });
}
function bloqueActual() {
  const t = new Date(), dd = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - BASE) / 864e5);
  return Math.max(0, Math.floor(dd / 12));
}
async function cargarResumen() {
  const k = bloqueActual(), mas = (f, n) => { const [y, m, d] = f.split("-").map(Number), t = new Date(y, m - 1, d + n); return fechaStr(t.getFullYear(), t.getMonth(), t.getDate()); };
  // se carga algo más de margen para saber cuántos días seguidos lleva cada ausencia
  const a = mas(bloqueFechas(k)[0], -30), b = mas(bloqueFechas(k + 1)[5], 30);
  await cargarAnio(new Date().getFullYear());
  const [d, x] = await Promise.all([
    sb.from("dias").select("fecha,turno").gte("fecha", a).lte("fecha", b),
    sb.from("asignaciones").select("empleado_id,fecha,codigo").gte("fecha", a).lte("fecha", b),
  ]);
  if (d.error || x.error) { toast("Error al cargar el resumen"); return; }
  R.dias = Object.fromEntries(d.data.map(r => [r.fecha, r.turno]));
  R.asig = Object.fromEntries(x.data.map(r => [r.empleado_id + "|" + r.fecha, r.codigo]));
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
// Días de ausencia justificada ya disfrutados (anteriores a hoy) por persona en el año actual.
function diasCogidos(empId) {
  const hoy = hoyStr(), y = +hoy.slice(0, 4);
  return (S.infAnio[y] || []).filter(r => r.empleado_id === empId && r.fecha < hoy && esAus(r.codigo)).length;
}
// Días de servicio seguidos de ausencia que incluyen el día f (los días libres del ciclo no cortan la racha).
function rachaAusencia(empId, f) {
  const mas = (n) => { const [y, m, d] = f.split("-").map(Number), t = new Date(y, m - 1, d + n); return fechaStr(t.getFullYear(), t.getMonth(), t.getDate()); };
  let n = 1;
  for (const paso of [-1, 1]) {
    for (let i = 1; i < 60; i++) {
      const g = mas(paso * i), t = R.dias[g];
      if (!t) break;
      if (t === "S" || t === "L") continue;
      if (esAus(R.asig[empId + "|" + g])) n++; else break;
    }
  }
  return n;
}
// Recomendación (orden de "quién debe quitarse"): 1) permisos antes que vacaciones, 2) racha más corta, 3) más días cogidos en el año.
function recomendarQuitar(f) {
  const lista = S.emps.filter(e => esAus(R.asig[e.id + "|" + f])).map(e => {
    const c = R.asig[e.id + "|" + f];
    return { e, c, vac: esVac(c) ? 1 : 0, racha: rachaAusencia(e.id, f), tot: diasCogidos(e.id) };
  });
  lista.sort((a, b) => a.vac - b.vac || a.racha - b.racha || b.tot - a.tot || a.e.orden - b.e.orden);
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
        if (!hacePicoFalta(f, R.asig)) return h("td", {}, h("small", {}, "no hace falta"));
        const r = recomendarPico(f, R.asig);
        return h("td", {}, r.length ? [h("small", {}, "recomendado"), h("div", {}, h("b", {}, r[0].e.nombre))] : h("small", {}, "nadie"));
      }),
      fila("Personal activo", "rl", f => h("td", {}, h("ul", {}, S.emps.filter(e => trabajaR(e.id, f)).map(e => persona(e, f))))),
      fila("Ausencias", "rl", f => h("td", {}, h("ul", {}, S.emps.filter(e => !trabajaR(e.id, f)).map(e => persona(e, f))))),
      hayQuitar ? fila("Quitarse", "rq", f => {
        if (f < hoy || tercioR(f) <= S.tercio) return h("td", {});
        const r = recomendarQuitar(f); if (!r.length) return h("td", {});
        const x = r[0], pl = n => n === 1 ? "" : "s";
        return h("td", {}, h("small", {}, "recomendado"), h("div", {}, h("b", {}, x.e.nombre)),
          h("small", {}, `${x.c} · ${x.racha} día${pl(x.racha)} seguido${pl(x.racha)} · ${x.tot} este año`),
          r.length > 1 ? h("small", {}, "luego " + r.slice(1, 3).map(y => y.e.nombre).join(", ")) : null);
      }) : null));
  return h("section", { class: "bloque " + clase },
    h("h3", {}, titulo, h("small", {}, ` · ${fechaCorta(fechas[0])} – ${fechaCorta(fechas[5])}`)),
    h("div", { class: "wrapres" }, tabla));
}
function vistaResumen() {
  const k = bloqueActual(), hoy = hoyStr(), fs = bloqueFechas(k);
  return h("div", { class: "resumenPag" },
    panelBloque(fs.includes(hoy) ? "Turno actual" : "Turno que acaba de pasar", k, "actual"),
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
    h("small", { class: "det" }, "Solo hace falta con número impar de personas. Candidatos: libres con la pareja ausente; va primero quien lleva más tiempo sin pico."));
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
      return h("td", { class: "dia " + cls(d, f) + (t === "S" || t === "L" ? " libre" : "") + (esPasado(f) && !S.me.admin ? " pasado" : ""), onclick: () => { S.sel = f; abrirEdicion(e, f); } },
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
      h("button", { class: "hoybtn", onclick: () => irMes(0, true) }, "Hoy")),
    h("div", { class: "resumen" }, resumenDia()),
    bloquePico(),
    h("div", { style: "height:.7rem" }),
    h("div", { class: "wrap" }, h("table", { class: "cal" + (S.fsel ? " conSel" : "") }, thead, tbody, tfoot)),
    h("div", { class: "leyenda" }, h("span", { class: "a" }, "Vacaciones y permisos"), h("span", { class: "t" }, "Trabajo"), h("span", { class: "m" }, "Modificadores (PICO, DESP)"), h("span", { class: "e" }, "Otros"), h("span", { class: "l" }, "Día libre (L)"),
      h("span", {}, (esResp() ? "Toca una casilla para poner o quitar un código. " : "Toca una casilla tuya para poner o quitar un código. ") + "Toca un nombre para resaltar su fila y un día arriba para ver su resumen.")));
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

function abrirEdicion(emp, f) {
  if (esPasado(f) && !S.me.admin) { avisoDiaBloqueado(f); return; }
  const puede = esResp() || emp.id === S.me.id;
  const actual = S.asig[emp.id + "|" + f] || "";
  const bloqueado = !esResp() && actual && S.cods[actual] && S.cods[actual].solo_responsables;
  if (!puede) { pintar(); toast(`Solo ${emp.nombre} o un responsable pueden cambiar este día`, 2500); return; }
  if (bloqueado) { pintar(); toast(`${actual} lo ha puesto un responsable; solo ellos pueden cambiarlo`, 3500); return; }
  const dlg = h("dialog", {});
  const [y, m, d] = f.split("-").map(Number);
  const elegir = async (codigo, btn) => { btn.disabled = true; await guardar(emp, f, codigo); dlg.close(); };
  const secciones = GRUPOS.map(([tipo, titulo]) => {
    const lista = Object.values(S.cods).filter(c => grupoDe(c.codigo) === tipo && (esResp() || !c.solo_responsables) && !(c.codigo === "PICO" && emp.hace_pico === false));
    if (!lista.length) return null;
    return [h("h4", {}, titulo), h("div", { class: "chips" }, lista.map(c =>
      h("button", { class: `chip ${claseTipo(c.codigo)} ${c.codigo === actual ? "act" : ""}`, onclick: ev => elegir(c.codigo, ev.currentTarget) },
        h("b", {}, c.codigo), h("span", {}, c.descripcion))))];
  });
  const cand = esResp() && !actual && ["M", "T", "N"].includes(S.dias[f]) && hacePicoFalta(f) ? candidatosPico(f) : [];
  dlg.append(...[
    h("h3", {}, emp.nombre), h("p", { class: "sub" }, `${DLARGO[new Date(y, m - 1, d).getDay()]} ${d}/${m}/${y} · turno ${TURNO_NOMBRE[S.dias[f]] ? TURNO_NOMBRE[S.dias[f]].toLowerCase() : "?"}`),
    cand.length ? h("div", { class: "cand" }, "Candidatos a PICO (libres con pareja ausente): " + cand.map(c => c.nombre).join(", ")) : null,
    h("div", { class: "contenido" }, secciones),
    h("div", { class: "fila" },
      h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cerrar"),
      actual ? h("button", { class: "btn sec", onclick: ev => elegir("", ev.currentTarget) }, "Quitar código") : null)].filter(Boolean));
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
  sb.from("cambios").select("*").order("creado_en", { ascending: false }).limit(60).then(({ data, error }) => {
    if (error) { ul.replaceChildren(h("li", {}, "No se pudo cargar el historial")); return; }
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
    const orden = [S.me, ...S.emps.filter(e => e.id !== S.me.id)];
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
  if (!S.abiertas) S.abiertas = new Set([S.me.id]);
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
    if (on) bs.push(h("button", { class: "btn sec full", onclick: async () => { const r = await navigator.serviceWorker.ready; r.showNotification("Turno D", { body: "Los avisos funcionan en este móvil ✔", icon: "icon-192.png" }); } }, "Probar en este móvil"));
    caja.replaceChildren(estado, ...bs);
  };
  pintarEstado();
  return caja;
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
    const sel = h("select", { onchange: ev => { S.infEmp = +ev.target.value; dibujar(); } },
      (esResp() ? S.emps : [S.me]).map(e => h("option", { value: e.id, selected: e.id === S.infEmp }, e.nombre)));
    const propias = rows.filter(r => r.empleado_id === S.infEmp);
    const porCodigo = {};
    for (const r of propias) (porCodigo[r.codigo] = porCodigo[r.codigo] || []).push(r.fecha);
    const codigos = Object.keys(porCodigo).sort((a, b) => (S.cods[a] ? S.cods[a].orden : 99) - (S.cods[b] ? S.cods[b].orden : 99));
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
    const sinPico = S.emps.filter(e => e.hace_pico === false).map(e => e.nombre);
    cont.replaceChildren(
      h("div", { class: "mes" },
        h("button", { disabled: S.infY <= S.anioMin, onclick: async () => { S.infY--; await cargarAnio(S.infY); dibujar(); } }, "‹"), h("b", {}, S.infY),
        h("button", { disabled: S.infY >= S.anioMax, onclick: async () => { S.infY++; await cargarAnio(S.infY); dibujar(); } }, "›")),
      h("div", { class: "pag ancho" },
        h("h2", {}, "Mis días"), esResp() ? sel : h("p", { class: "sub" }, S.me.nombre),
        h("p", { class: "sub" }, "Solo cuentan los días ya pasados."),
        h("div", { class: "itot" }, h("div", {}, h("b", {}, totAus), h("small", {}, "ausencias justificadas")), h("div", {}, h("b", {}, totVac), h("small", {}, "de vacaciones"))),
        codigos.length ? tarjetas : h("p", { class: "det" }, "Todavía no hay días apuntados.")),
      h("div", { class: "pag ancho" },
        h("h2", {}, "Reparto de picos"), h("p", { class: "sub" }, "Picos ya hechos este año, de más a menos."),
        h("table", { class: "ipicos" }, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Picos"), h("th", {}, "Desp."), h("th", {}, "Último pico"))),
          h("tbody", {}, picosEmp.map(x => h("tr", {}, h("td", {}, x.e.nombre), h("td", {}, h("b", {}, x.n)), h("td", {}, x.d), h("td", {}, x.ult ? fechaLarga(x.ult) : "–"))))),
        sinPico.length ? h("p", { class: "det" }, sinPico.join(", ") + ": no hace pico.") : null));
  };
  dibujar();
  cargarAnio(S.infY).then(dibujar);   // refresca al entrar
  return cont;
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
    const t = [["Calendario", "dias", "fecha"], ["Asignaciones", "asignaciones", "fecha"], ["Empleados", "empleados", "orden"], ["Codigos", "codigos", "orden"],
      ["Formaciones", "formaciones", "id"], ["Cursos", "cursos", "orden"], ["Cambios", "cambios", "creado_en"]];
    const hojas = [];
    for (const [n, tabla, ord] of t) hojas.push(hojaXml(n, await leerTodo(tabla, ord)));
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${hojas.join("")}</Workbook>`;
    const a = h("a", { href: URL.createObjectURL(new Blob([xml], { type: "application/xml" })), download: `copia-turno-d-${hoyStr()}.xml` });
    document.body.append(a); a.click(); a.remove();
    msg.textContent = "Copia descargada ✔ (ábrela con Excel)";
  } catch (e) { msg.textContent = "No se pudo hacer la copia: " + (e.message || e); }
  btn.disabled = false;
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
    S.me.admin ? [h("h3", {}, "Copia de seguridad"), h("p", { class: "sub" }, "Descarga todo (calendario, asignaciones, formaciones y cambios) en un archivo que abre Excel. Guárdalo de vez en cuando."),
      h("button", { class: "btn sec full", onclick: ev => descargarCopia(ev.currentTarget, msgCopia) }, "Descargar copia"), msgCopia] : null,
    h("hr"), h("button", { class: "btn sec full", onclick: salir }, "Cerrar sesión"));
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
arrancar();
})();
