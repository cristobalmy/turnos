"""Genera supabase/seed.sql a partir del Excel (hoja Usera + catálogo de Config).
Uso: python3 scripts/make_seed.py <TURNO_D.xlsx> <TURNO_D_limpia.xlsx> supabase/seed.sql
 - 1er archivo: el original (valores en caché, para fechas y turnos)
 - 2º archivo: la copia limpia (catálogo de códigos en Config)
"""
import sys, datetime, openpyxl

orig, limpia, salida = sys.argv[1:4]
RESPONSABLES = {'Cristobal', 'Nacho', 'Cristina', 'Sobrino'}
q = lambda s: "'" + str(s).replace("'", "''") + "'"

wo = openpyxl.load_workbook(orig, data_only=True)
wl = openpyxl.load_workbook(limpia, data_only=True)
us, cfg = wo['Usera'], wl['Config']
COLS = range(5, 370)

# --- códigos (Config H2:N..) ---
codigos = []
for r in range(2, 60):
    cod = cfg.cell(r, 8).value
    if not cod: break
    codigos.append((cod, cfg.cell(r, 9).value, cfg.cell(r, 10).value,
                    cfg.cell(r, 13).value == 'SÍ', cfg.cell(r, 14).value == 'SÍ', r - 1))

# --- empleados (Config B7:B18) y parejas (Config E3:F8) ---
nombres = [wo['Config'].cell(r, 2).value for r in range(7, 19)]
ids = {n: i + 1 for i, n in enumerate(nombres)}
parejas = {}
for r in range(3, 9):
    a, b = wo['Config'].cell(r, 5).value, wo['Config'].cell(r, 6).value
    if a and b: parejas[a] = b; parejas[b] = a
assert set(parejas) == set(nombres), (set(nombres) ^ set(parejas))

# --- días y asignaciones (Usera) ---
fechas = {c: us.cell(3, c).value.date() for c in COLS}
dias = [(fechas[c], us.cell(4, c).value) for c in COLS]
asig = []
for r in range(5, 17):
    n = us.cell(r, 1).value
    assert n in ids, n
    for c in COLS:
        v = us.cell(r, c).value
        if v not in (None, ''): asig.append((ids[n], fechas[c], v))
usados = {a[2] for a in asig}
assert usados <= {c[0] for c in codigos}, usados - {c[0] for c in codigos}

L = ['-- Datos iniciales generados desde el Excel (scripts/make_seed.py). Ejecutar DESPUÉS de schema.sql.', 'begin;']
L.append('insert into public.codigos(codigo,descripcion,tipo,cuenta_como_trabajo,solo_responsables,orden) values')
L.append(',\n'.join(f"({q(c)},{q(d)},{q(t)},{str(w).lower()},{str(s).lower()},{o})" for c, d, t, w, s, o in codigos) + ';')
L.append('insert into public.empleados(id,nombre,rol,orden) overriding system value values')
L.append(',\n'.join(f"({ids[n]},{q(n)},{q('responsable' if n in RESPONSABLES else 'agente')},{ids[n]})" for n in nombres) + ';')
L.append("select setval(pg_get_serial_sequence('public.empleados','id'), 12);")
L.append(';\n'.join(f"update public.empleados set pareja_id={ids[parejas[n]]} where id={ids[n]}" for n in nombres) + ';')
L.append("insert into public.config(clave,valor) values ('minimo_operativo','%s'), ('inicio_calendario','2026-01-01');" % int(cfg['L2'].value))
L.append('insert into public.dias(fecha,turno) values')
L.append(',\n'.join(f"('{f}',{q(t)})" for f, t in dias) + ';')
L.append('insert into public.asignaciones(empleado_id,fecha,codigo) values')
L.append(',\n'.join(f"({e},'{f}',{q(c)})" for e, f, c in asig) + ';')
L.append('commit;')
open(salida, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print(f'codigos={len(codigos)} empleados={len(nombres)} dias={len(dias)} asignaciones={len(asig)}')
