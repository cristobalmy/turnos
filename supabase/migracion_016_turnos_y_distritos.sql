-- =====================================================================
-- Migración 016 · Turnos A–F, zonas y separación por distrito
-- Ejecutar una vez en Supabase → SQL Editor → Run. Se puede repetir sin problema.
-- No borra datos. Para deshacerla: migracion_016_deshacer.sql
-- =====================================================================

-- 1) Ciclo de 12 días: 2 mañanas, 2 tardes, 2 noches y 6 libres.
--    El antiguo "saliente" (S) pasa a ser libre (L). La app ya lo mostraba como libre.
update public.dias set turno = 'L' where turno = 'S';

-- Qué le toca a un turno (A–F) en una fecha. Cada turno empieza el ciclo 2 días después que el anterior
-- (cuando D hace tardes, E hace mañanas) y D sigue exactamente el calendario que ya había.
create or replace function public.turno_ciclo(letra text, f date) returns text
language sql immutable set search_path = public as $$
  select substr('MMTTNNLLLLLL',
    (((f - date '2026-01-01') - 2 * (position(upper(letra) in 'ABCDEF') - 4)) % 12 + 12) % 12 + 1, 1)
$$;
grant execute on function public.turno_ciclo(text, date) to authenticated;

-- 2) Cada distrito pertenece a un turno (A–F) y a una zona (1 o 2)
alter table public.distritos add column if not exists letra text;
alter table public.distritos add column if not exists zona integer;
update public.distritos set letra = upper(substr(turno, 1, 1)), zona = substr(turno, 2, 1)::int
  where letra is null and turno ~ '^[A-Fa-f][12]$';
update public.distritos set letra = coalesce(letra, 'D'), zona = coalesce(zona, 2);
alter table public.distritos alter column letra set not null;
alter table public.distritos alter column zona  set not null;
alter table public.distritos drop constraint if exists distritos_letra_check;
alter table public.distritos add  constraint distritos_letra_check check (letra in ('A','B','C','D','E','F'));
alter table public.distritos drop constraint if exists distritos_zona_check;
alter table public.distritos add  constraint distritos_zona_check check (zona in (1, 2));

-- El nombre corto del turno ("D2") se rellena solo a partir de la letra y la zona
create or replace function public.distritos_turno() returns trigger
language plpgsql set search_path = public as $$
begin new.turno := new.letra || new.zona; return new; end $$;
drop trigger if exists distritos_turno on public.distritos;
create trigger distritos_turno before insert or update on public.distritos
  for each row execute function public.distritos_turno();
update public.distritos set letra = letra;

-- Dos distritos con el mismo nombre pueden existir en turnos distintos
alter table public.distritos drop constraint if exists distritos_nombre_key;
alter table public.distritos drop constraint if exists distritos_nombre_turno_key;
alter table public.distritos add  constraint distritos_nombre_turno_key unique (nombre, letra, zona);

-- Dos personas con el mismo nombre pueden existir en distritos distintos
alter table public.empleados drop constraint if exists empleados_nombre_key;
alter table public.empleados drop constraint if exists empleados_nombre_distrito_key;
alter table public.empleados add  constraint empleados_nombre_distrito_key unique (distrito_id, nombre);

-- 3) Funciones de apoyo para los permisos
create or replace function public.mi_distrito_id() returns integer
language sql stable security definer set search_path = public as $$
  select distrito_id from public.empleados where id = public.mi_empleado_id()
$$;

-- ¿Puedo ver a esta persona? (es de mi distrito, o soy el administrador)
create or replace function public.veo_empleado(eid integer) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_empleado_id() is not null and (
    public.soy_admin()
    or exists (select 1 from public.empleados where id = eid and distrito_id = public.mi_distrito_id()))
$$;

-- ¿Soy responsable de esta persona? (responsable de su distrito, o administrador)
create or replace function public.mando_en(eid integer) returns boolean
language sql stable security definer set search_path = public as $$
  select public.soy_admin()
    or (public.soy_responsable()
        and exists (select 1 from public.empleados where id = eid and distrito_id = public.mi_distrito_id()))
$$;

revoke all on function public.mi_distrito_id(), public.veo_empleado(integer), public.mando_en(integer) from public, anon;
grant execute on function public.mi_distrito_id(), public.veo_empleado(integer), public.mando_en(integer) to authenticated;

-- 4) Personas: cada uno ve a los de su distrito; los responsables gestionan solo su distrito
drop policy if exists leer_empleados on public.empleados;
create policy leer_empleados on public.empleados for select to authenticated
  using (public.mi_empleado_id() is not null and (public.soy_admin() or distrito_id = public.mi_distrito_id()));
drop policy if exists gestionar_empleados on public.empleados;
create policy gestionar_empleados on public.empleados for all to authenticated
  using      (public.soy_admin() or (public.soy_responsable() and distrito_id = public.mi_distrito_id()))
  with check (public.soy_admin() or (public.soy_responsable() and distrito_id = public.mi_distrito_id()));

-- 5) Calendario: solo se ve y se edita el propio distrito
drop policy if exists leer_asignaciones on public.asignaciones;
create policy leer_asignaciones on public.asignaciones for select to authenticated
  using (public.veo_empleado(empleado_id));

drop policy if exists crear_asignaciones on public.asignaciones;
create policy crear_asignaciones on public.asignaciones for insert to authenticated
  with check (public.mando_en(empleado_id)
              or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)));

drop policy if exists cambiar_asignaciones on public.asignaciones;
create policy cambiar_asignaciones on public.asignaciones for update to authenticated
  using      (public.mando_en(empleado_id)
              or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)))
  with check (public.mando_en(empleado_id)
              or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)));

drop policy if exists borrar_asignaciones on public.asignaciones;
create policy borrar_asignaciones on public.asignaciones for delete to authenticated
  using (public.mando_en(empleado_id)
         or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)));

-- 6) Historial de cambios: solo los del propio distrito
drop policy if exists leer_cambios on public.cambios;
create policy leer_cambios on public.cambios for select to authenticated
  using (public.veo_empleado(empleado_id));

-- 7) Formaciones: se ven las del propio distrito; cada uno edita las suyas y los responsables las de su distrito
drop policy if exists formaciones_ver on public.formaciones;
create policy formaciones_ver on public.formaciones for select to authenticated
  using (public.veo_empleado(empleado_id));
drop policy if exists formaciones_escribir on public.formaciones;
create policy formaciones_escribir on public.formaciones for all to authenticated
  using      (public.mando_en(empleado_id) or empleado_id = public.mi_empleado_id())
  with check (public.mando_en(empleado_id) or empleado_id = public.mi_empleado_id());

-- 8) Lo que es común a todos los distritos (códigos, cursos, calendario, ajustes): solo lo cambia el administrador.
--    (La app no tenía ninguna pantalla para cambiarlo, así que nadie pierde nada.)
drop policy if exists gestionar_codigos on public.codigos;
create policy gestionar_codigos on public.codigos for all to authenticated using (public.soy_admin()) with check (public.soy_admin());
drop policy if exists cursos_gestionar on public.cursos;
create policy cursos_gestionar on public.cursos for all to authenticated using (public.soy_admin()) with check (public.soy_admin());
drop policy if exists gestionar_dias on public.dias;
create policy gestionar_dias on public.dias for all to authenticated using (public.soy_admin()) with check (public.soy_admin());
drop policy if exists gestionar_config on public.config;
create policy gestionar_config on public.config for all to authenticated using (public.soy_admin()) with check (public.soy_admin());

-- Comprobación: debe salir 1 fila (Usera-Villaverde, D, 2, D2), 12 personas y 0 días "S"
select d.nombre, d.letra, d.zona, d.turno,
       (select count(*) from public.empleados e where e.distrito_id = d.id) as personas,
       (select count(*) from public.dias where turno = 'S') as dias_saliente
from public.distritos d;
