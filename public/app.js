(() => {
"use strict";
const { SUPABASE_URL, SUPABASE_KEY } = window.TURNOS_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $app = document.getElementById("app");

const S = { me: null, emps: [], cods: {}, minimo: 6, y: 0, m: 0, dias: {}, asig: {}, vista: "cal", canal: null };
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DSEM = ["D","L","M","X","J","V","S"];

// ---------- utilidades ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
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
const claseTipo = c => { const t = S.cods[c] && S.cods[c].tipo; return t === "Ausencia Justificada" ? "t-Ausencia" : t === "Tipo trabajo" ? "t-Trabajo" : "t-Especial"; };

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
  } }, email, pass, h("button", { class: "btn full", type: "submit" }, "Entrar"), err);
  $app.replaceChildren(h("div", { class: "login" }, h("h1", {}, "Turno D"), h("div", {}, "Usera – Villaverde"), f));
}

async function arrancar() {
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
  S.me = S.emps.find(x => (x.email || "").toLowerCase() === email) || null;
  if (!S.me) return sinAcceso("Tu cuenta no está autorizada en Turno D. Habla con un responsable.");
  const t = new Date(); S.y = t.getFullYear(); S.m = t.getMonth();
  await cargarMes();
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
}

function suscribir() {
  if (S.canal) return;
  S.canal = sb.channel("turnos")
    .on("postgres_changes", { event: "*", schema: "public", table: "asignaciones" }, p => {
      const r = p.eventType === "DELETE" ? p.old : p.new;
      if (!r || !r.fecha) return;
      const k = r.empleado_id + "|" + r.fecha;
      if (p.eventType === "DELETE") delete S.asig[k]; else S.asig[k] = r.codigo;
      if (S.vista === "cal") pintar();
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
function trabaja(empId, f) {
  const c = S.asig[empId + "|" + f];
  return !c || !!(S.cods[c] && S.cods[c].cuenta_como_trabajo);
}
function candidatosPico(f) {
  // libre (sin código) y su pareja ausente
  return S.emps.filter(e => {
    if (S.asig[e.id + "|" + f]) return false;
    if (!e.pareja_id) return false;
    const cp = S.asig[e.pareja_id + "|" + f];
    return cp && S.cods[cp] && !S.cods[cp].cuenta_como_trabajo;
  });
}

// ---------- pantallas ----------
function cabecera() {
  const b = (v, txt) => h("button", { class: S.vista === v ? "on" : "", onclick: () => { S.vista = v; pintar(); } }, txt);
  return h("header", {}, h("h1", {}, "Turno D"), b("cal", "Calendario"), b("hist", "Cambios"), b("cuenta", "Cuenta"));
}
function pintar() {
  const cuerpo = S.vista === "cal" ? vistaCalendario() : S.vista === "hist" ? vistaHistorial() : vistaCuenta();
  $app.replaceChildren(cabecera(), cuerpo);
  if (S.vista === "cal") {
    const hoy = $app.querySelector("th.hoy");
    if (hoy && !S.yaScroll) { hoy.scrollIntoView({ inline: "center", block: "nearest" }); S.yaScroll = true; }
  }
}

function vistaCalendario() {
  const nd = new Date(S.y, S.m + 1, 0).getDate(), hoy = hoyStr();
  const dias = Array.from({ length: nd }, (_, i) => i + 1);
  const cls = (d, f) => [new Date(S.y, S.m, d).getDay() % 6 === 0 ? "finde" : "", f === hoy ? "hoy" : ""].join(" ");
  const cambiarMes = async dm => {
    S.m += dm; if (S.m < 0) { S.m = 11; S.y--; } if (S.m > 11) { S.m = 0; S.y++; }
    S.yaScroll = true; await cargarMes(); pintar();
  };
  const thead = h("thead", {}, h("tr", {}, h("th", { class: "nom" }, ""), dias.map(d => {
    const f = fechaStr(S.y, S.m, d);
    return h("th", { class: cls(d, f) }, DSEM[new Date(S.y, S.m, d).getDay()], h("small", {}, d));
  })));
  const filaTurno = h("tr", {}, h("th", { class: "nom" }, "Turno"), dias.map(d => {
    const f = fechaStr(S.y, S.m, d), t = S.dias[f] || "";
    return h("td", { class: cls(d, f) }, h("span", { class: "tur " + t }, t));
  }));
  const tbody = h("tbody", {}, filaTurno, S.emps.map(e => h("tr", { class: e.id === S.me.id ? "yo" : "" },
    h("th", { class: "nom" }, e.nombre),
    dias.map(d => {
      const f = fechaStr(S.y, S.m, d), c = S.asig[e.id + "|" + f], t = S.dias[f];
      return h("td", { class: "dia " + cls(d, f) + (t === "S" || t === "L" ? " libre" : ""), onclick: () => abrirEdicion(e, f) },
        c ? h("span", { class: "cod " + claseTipo(c) }, c) : "");
    }))));
  const tfoot = h("tfoot", {}, h("tr", {}, h("th", { class: "nom" }, `Trabajan (mín. ${S.minimo})`), dias.map(d => {
    const f = fechaStr(S.y, S.m, d), t = S.dias[f];
    if (t !== "M" && t !== "T" && t !== "N") return h("td", { class: cls(d, f) }, "–");
    const n = S.emps.filter(e => trabaja(e.id, f)).length;
    return h("td", { class: n < S.minimo ? "bajo" : "ok" }, n);
  })));
  return h("div", {},
    h("div", { class: "mes" }, h("button", { onclick: () => cambiarMes(-1) }, "‹"), h("b", {}, `${MESES[S.m]} ${S.y}`), h("button", { onclick: () => cambiarMes(1) }, "›")),
    h("div", { class: "wrap" }, h("table", { class: "cal" }, thead, tbody, tfoot)),
    h("p", { class: "ayuda" }, esResp() ? "Toca cualquier casilla para poner o quitar un código." : "Toca una casilla tuya para poner o quitar un código. Las casillas rayadas son días de descanso del ciclo."));
}

function abrirEdicion(emp, f) {
  const puede = esResp() || emp.id === S.me.id;
  const actual = S.asig[emp.id + "|" + f] || "";
  const bloqueado = !esResp() && actual && S.cods[actual] && S.cods[actual].solo_responsables;
  if (!puede) { toast(`Solo ${emp.nombre} o un responsable pueden cambiar este día`, 2500); return; }
  if (bloqueado) { toast(`${actual} lo ha puesto un responsable; solo ellos pueden cambiarlo`, 3500); return; }
  const sel = h("select", {}, h("option", { value: "" }, "— Sin código (día normal) —"),
    Object.values(S.cods).filter(c => esResp() || !c.solo_responsables)
      .map(c => h("option", { value: c.codigo, selected: c.codigo === actual }, `${c.codigo} · ${c.descripcion}`)));
  const dlg = h("dialog", {});
  const [y, m, d] = f.split("-").map(Number);
  const cand = esResp() && !actual && ["M","T","N"].includes(S.dias[f]) ? candidatosPico(f) : [];
  dlg.append(
    h("h3", {}, emp.nombre), h("p", { class: "sub" }, `${DSEM[new Date(y, m - 1, d).getDay()]} ${d}/${m}/${y} · turno ${S.dias[f] || "?"}`),
    sel,
    cand.length ? h("div", { class: "cand" }, "Candidatos a PICO (libres con pareja ausente): " + cand.map(c => c.nombre).join(", ")) : null,
    h("div", { class: "fila" },
      h("button", { class: "btn sec", onclick: () => dlg.close() }, "Cancelar"),
      h("button", { class: "btn", onclick: async ev => { ev.target.disabled = true; await guardar(emp, f, sel.value); dlg.close(); } }, "Guardar")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

async function guardar(emp, f, codigo) {
  const k = emp.id + "|" + f, antes = S.asig[k] || "";
  if (codigo === antes) return;
  let error;
  if (codigo) ({ error } = await sb.from("asignaciones").upsert({ empleado_id: emp.id, fecha: f, codigo }, { onConflict: "empleado_id,fecha" }));
  else ({ error } = await sb.from("asignaciones").delete().eq("empleado_id", emp.id).eq("fecha", f));
  if (error) { toast("No se pudo guardar: " + error.message, 6000); return; }
  if (codigo) S.asig[k] = codigo; else delete S.asig[k];
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

function vistaCuenta() {
  const p1 = h("input", { type: "password", placeholder: "Nueva contraseña (mín. 8 caracteres)", autocomplete: "new-password" });
  const p2 = h("input", { type: "password", placeholder: "Repite la contraseña", autocomplete: "new-password" });
  const msg = h("div", { class: "error" });
  return h("div", { class: "pag" },
    h("h2", {}, S.me.nombre), h("p", {}, (S.me.rol === "responsable" ? "Responsable" : "Agente") + " · " + S.me.email),
    h("h3", {}, "Cambiar contraseña"), p1, p2,
    h("button", { class: "btn full", onclick: async () => {
      if (p1.value.length < 8) { msg.textContent = "Mínimo 8 caracteres."; return; }
      if (p1.value !== p2.value) { msg.textContent = "No coinciden."; return; }
      const { error } = await sb.auth.updateUser({ password: p1.value });
      msg.textContent = error ? "No se pudo cambiar: " + error.message : "Contraseña cambiada ✔";
      if (!error) { p1.value = p2.value = ""; }
    } }, "Guardar contraseña"), msg,
    h("hr"), h("button", { class: "btn sec full", onclick: salir }, "Cerrar sesión"));
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
arrancar();
})();
