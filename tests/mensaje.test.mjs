// Prueba la redacción de los avisos (la parte de la Edge Function que no necesita internet). Uso: node tests/mensaje.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../supabase/functions/avisar/index.ts", import.meta.url), "utf8");
const trozo = src.split("// ===== INICIO LÓGICA DEL MENSAJE (se prueba por separado) =====")[1].split("// ===== FIN LÓGICA DEL MENSAJE =====")[0];
const construirMensaje = new Function(trozo + "; return construirMensaje;")();
const nombre = { 1: "Cristóbal", 3: "Nacho", 4: "Gustavo" };
let fallos = 0;
const eq = (a, b, t) => { if (a === b) console.log("OK   " + t); else { fallos++; console.log("FALLO " + t + "\n  esperado: " + JSON.stringify(b) + "\n  obtenido: " + JSON.stringify(a)); } };
const c = (emp, fecha, antes, despues) => ({ empleado_id: emp, fecha, codigo_antes: antes, codigo_despues: despues });

eq(construirMensaje([c(4, "2026-10-14", null, "V2")], nombre, 4).body, "Gustavo: V2 el 14/10", "un día propio");
eq(construirMensaje([c(4, "2026-10-14", "V2", null)], nombre, 4).body, "Gustavo quitó V2 del 14/10", "quitar un día");
eq(construirMensaje([c(4, "2026-10-12", null, "PICO")], nombre, 3).body, "Nacho → Gustavo: PICO el 12/10", "un responsable pone PICO a otro");
eq(construirMensaje([c(4, "2026-10-15", null, "V1"), c(4, "2026-10-13", null, "V1"), c(4, "2026-10-14", null, "V1")], nombre, 4).body, "Gustavo: V1 3 días (13/10 – 15/10)", "varios días seguidos en un solo aviso");
eq(construirMensaje([c(4, "2026-10-13", null, "V1"), c(4, "2026-10-14", null, "AP")], nombre, 4).body, "Gustavo: V1 el 13/10\nGustavo: AP el 14/10", "dos códigos distintos");
const muchos = [1, 2, 3, 4, 5, 6].map(i => c(4, "2026-10-1" + i, null, "X" + i));
eq(construirMensaje(muchos, nombre, 4).body.split("\n").length, 5, "más de 4 líneas se resume");
eq(construirMensaje([c(4, "2026-10-14", null, "V2")], nombre, 4).title, "Turno D", "título");
process.exit(fallos ? 1 : 0);
