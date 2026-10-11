// Prueba la lógica pura de las Edge Functions (tercio y calendario). Uso: node tests/funciones.test.mjs
import { readFileSync } from "node:fs";
const trozo = (ruta, ini, fin) => readFileSync(new URL(ruta, import.meta.url), "utf8").split(ini)[1].split(fin)[0];
const av = trozo("../supabase/functions/avisar/index.ts", "// ===== INICIO LÓGICA TERCIO (se prueba por separado) =====", "// ===== FIN LÓGICA TERCIO =====");
const { avisoTercio, recomendarQuitar, turnoCiclo, diasCiclo } = new Function('function fechaCorta(f){const p=f.split("-");return Number(p[2])+"/"+Number(p[1]);}' + av + "; return { avisoTercio, recomendarQuitar, turnoCiclo, diasCiclo };")();
const ics = trozo("../supabase/functions/calendario/index.ts", "// ===== INICIO LÓGICA ICS (se prueba por separado) =====", "// ===== FIN LÓGICA ICS =====");
const { construirIcs } = new Function(ics + "; return { construirIcs };")();
let fallos = 0;
const eq = (a, b, t) => { if (JSON.stringify(a) === JSON.stringify(b)) console.log("OK   " + t); else { fallos++; console.log("FALLO " + t + "\n  esperado: " + JSON.stringify(b) + "\n  obtenido: " + JSON.stringify(a)); } };

const nombres = ["Cristobal", "Cristina", "Nacho", "Gustavo", "Alfonso", "Ruben"];
const emps = nombres.map((n, i) => ({ id: i + 1, nombre: n, orden: i + 1 }));
const cods = { V1: { tipo: "Ausencia Justificada" }, V2: { tipo: "Ausencia Justificada" }, AP: { tipo: "Ausencia Justificada" }, CJ: { tipo: "Ausencia Justificada" }, PICO: { tipo: "Tipo trabajo" } };
const dias = {}; for (let d = 14; d <= 24; d++) dias["2026-10-" + d] = d <= 21 ? "MMTTNN"[(d - 14) % 6] : "S";
// 5 ausentes el 20/10: 1 AP (1 día), 2 V1 (14..21 seguidos), 3 CJ (20 y 21), 4 AP (20), 5 V2 (20)
const asig = { "1|2026-10-20": "AP", "2|2026-10-20": "V1", "3|2026-10-20": "CJ", "3|2026-10-21": "CJ", "4|2026-10-20": "AP", "5|2026-10-20": "V2", "6|2026-10-20": "PICO" };
for (let d = 16; d <= 21; d++) asig["2|2026-10-" + d] = "V1";
const totales = { 1: 3, 4: 0 };
const r = recomendarQuitar(emps, cods, asig, dias, totales, "2026-10-20");
eq(r.map(x => x.e.nombre), ["Cristobal", "Gustavo", "Nacho", "Alfonso", "Cristina"], "orden: permisos primero (más días cogidos, luego racha), vacaciones al final y entre ellas la racha más corta antes");
eq(r[2].racha, 2, "racha del permiso de 2 días");
eq(avisoTercio(emps, cods, asig, dias, totales, "2026-10-20", 4, 4).body, "Tercio superado el 20/10 (5 de 4). Recomendado quitarse: Cristobal (AP)", "mensaje al pasar el tercio");
eq(avisoTercio(emps, cods, asig, dias, totales, "2026-10-20", 4, 5), null, "si ya estaba pasado, no vuelve a avisar");
eq(avisoTercio(emps, cods, asig, dias, totales, "2026-10-20", 5, 4), null, "con tercio 5 y 5 personas no se supera");
eq(avisoTercio(emps, cods, asig, dias, totales, "2026-10-21", 4, 0), null, "un día con pocas ausencias no avisa");
// rachas que saltan los días libres del ciclo: S/L no cortan
const dias2 = { "2026-10-19": "N", "2026-10-20": "S", "2026-10-21": "L", "2026-10-22": "M" };
const asig2 = { "1|2026-10-19": "V1", "1|2026-10-22": "V1" };
const rr = recomendarQuitar([emps[0]], cods, { ...asig2, "1|2026-10-22": "V1" }, dias2, {}, "2026-10-22");
eq(rr[0].racha, 2, "los días libres del ciclo no cortan la racha");

const calendario = construirIcs("Gustavo", [{ fecha: "2026-10-20", turno: "M" }, { fecha: "2026-10-21", turno: "S" }, { fecha: "2026-10-22", turno: "T" }, { fecha: "2026-10-23", turno: "N" }, { fecha: "2026-10-26", turno: "L" }],
  { "2026-10-22": "V1", "2026-10-23": "PICO", "2026-10-26": "AP" },
  { V1: { descripcion: "Vacaciones 1", cuenta_como_trabajo: false }, PICO: { descripcion: "PICO", cuenta_como_trabajo: true }, AP: { descripcion: "Asuntos particulares", cuenta_como_trabajo: false } }, new Date("2026-10-10T12:00:00Z"));
eq(calendario.match(/SUMMARY:.*/g), ["SUMMARY:Mañana", "SUMMARY:V1 · Vacaciones 1", "SUMMARY:Noche · PICO", "SUMMARY:AP · Asuntos particulares"], "títulos de los eventos (un día libre sin nada no genera evento)");
eq(calendario.includes("DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021"), true, "evento de día completo");
eq(calendario.startsWith("BEGIN:VCALENDAR\r\n") && calendario.endsWith("END:VCALENDAR\r\n"), true, "estructura del calendario");
eq(new Set(calendario.match(/UID:.*/g)).size, 4, "cada evento tiene un identificador distinto");
eq(["C", "D", "E"].map(l => turnoCiclo("2026-10-18", l)), ["N", "T", "M"], "ciclo: cuando D hace tarde, C hace noche y E mañana");
eq(["E", "F"].map(l => turnoCiclo("2026-10-20", l)), ["T", "M"], "ciclo: cuando E hace tarde, F hace mañana");
eq(["F", "A"].map(l => turnoCiclo("2026-10-22", l)), ["T", "M"], "ciclo: cuando F hace tarde, A hace mañana");
eq(Object.values(diasCiclo("2026-01-01", "2026-01-12", "D")).join(""), "MMTTNNLLLLLL", "ciclo D desde el 1/1/2026 con 6 libres");
const ics2 = trozo("../supabase/functions/calendario/index.ts", "// ===== INICIO LÓGICA ICS (se prueba por separado) =====", "// ===== FIN LÓGICA ICS =====");
const cal2 = new Function(ics2 + "; return { diasCiclo };")();
eq(cal2.diasCiclo("2026-10-18", "2026-10-19", "E"), [{ fecha: "2026-10-18", turno: "M" }, { fecha: "2026-10-19", turno: "M" }], "el calendario del móvil sigue el turno del distrito");
const al = trozo("../supabase/functions/alta/index.ts", "// ===== INICIO LÓGICA ALTA (se prueba por separado) =====", "// ===== FIN LÓGICA ALTA =====");
const { validarAlta } = new Function(al + "; return { validarAlta };")();
eq(validarAlta({ nombre: " Laura ", email: " Laura@Gmail.com ", clave: "abcdefgh", distrito_id: 2 }).datos,
  { nombre: "Laura", email: "laura@gmail.com", clave: "abcdefgh", rol: "agente", distrito_id: 2, hace_pico: true }, "alta: limpia nombre y correo; agente y con PICO por defecto");
eq(validarAlta({ nombre: "Laura", email: "laura@gmail.com", clave: "corta", distrito_id: 2 }).error, "La contraseña provisional debe tener al menos 8 caracteres.", "alta: contraseña demasiado corta");
eq(validarAlta({ nombre: "Laura", email: "lauragmail.com", clave: "abcdefgh", distrito_id: 2 }).error, "El correo no es válido.", "alta: correo mal escrito");
eq(validarAlta({ nombre: "", email: "l@g.es", clave: "abcdefgh", distrito_id: 2 }).error, "Escribe el nombre (máximo 40 letras).", "alta: sin nombre");
eq(validarAlta({ nombre: "L", email: "l@g.es", clave: "abcdefgh" }).error, "Falta el distrito.", "alta: sin distrito");
eq(validarAlta({ nombre: "L", email: "l@g.es", clave: "abcdefgh", distrito_id: 1, rol: "admin" }).datos.rol, "agente", "alta: nadie puede colarse como administrador");
const pc = trozo("../supabase/functions/pico/index.ts", "// ===== INICIO LÓGICA PICO (se prueba por separado) =====", "// ===== FIN LÓGICA PICO =====");
const { avisoPico } = new Function(pc + "; return { avisoPico };")();
const dD = { nombre: "Usera-Villaverde", letra: "D", turno: "D2" };
const cP = { V1: { cuenta_como_trabajo: false }, AP: { cuenta_como_trabajo: false }, PICO: { cuenta_como_trabajo: true }, DESP: { cuenta_como_trabajo: true } };
const ep = [1, 2, 3, 4, 5, 6, 7].map(i => ({ id: i, nombre: "P" + i, orden: i, hace_pico: i !== 1, pareja_id: i % 2 ? i + 1 : i - 1 }));
ep[6].pareja_id = null;
// 20/10/2026: D hace noche. 7 personas trabajan → impar
eq(avisoPico(dD, "2026-10-20", ep, {}, cP, {}), { title: "PICO mañana · Usera-Villaverde D2", body: "Mañana martes 20/10 (noche) trabajan 7: hace falta PICO. No hay ningún candidato libre con su binomio ausente." }, "pico: impar sin candidatos lo dice");
eq(avisoPico(dD, "2026-10-20", ep, { 2: "V1" }, cP, {}), null, "pico: con número par no avisa");
eq(avisoPico(dD, "2026-10-20", ep, { 3: "V1", 5: "AP" }, cP, { 4: "2026-09-01", 6: "2025-12-20" }).body, "Mañana martes 20/10 (noche) trabajan 5: hace falta PICO. Recomendado: P6 (luego P4)", "pico: recomienda a quien lleva más tiempo sin PICO, aunque fuera el año anterior");
eq(avisoPico(dD, "2026-10-20", ep, { 3: "V1", 5: "AP" }, cP, { 6: "2026-09-01" }).body.endsWith("Recomendado: P4 (luego P6)"), true, "pico: quien nunca lo ha hecho va primero");
eq(avisoPico(dD, "2026-10-20", ep, { 3: "V1", 5: "AP", 2: "V1", 4: "PICO" }, cP, {}), null, "pico: si ya está puesto no avisa");
eq(avisoPico(dD, "2026-10-20", ep, { 2: "V1", 3: "V1", 7: "DESP" }, cP, {}).body.endsWith("trabajan 5: hace falta PICO. Recomendado: P4"), true, "pico: DESP cuenta como que trabaja, no como PICO; y quien no hace PICO no sale");
eq(avisoPico(dD, "2026-10-22", ep, {}, cP, {}), null, "pico: día libre del ciclo no avisa");
process.exit(fallos ? 1 : 0);
