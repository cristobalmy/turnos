-- =====================================================================
-- DESHACER la migración 016 (vuelve los permisos y el calendario a como estaban).
-- Solo si algo ha ido mal. Supabase → SQL Editor → pegar entero → Run.
-- No borra asignaciones, personas ni formaciones.
-- =====================================================================

-- 1) Vuelve el "saliente" (S) al séptimo día del ciclo
update public.dias set turno = 'S'
  where turno = 'L' and ((fecha - date '2026-01-01') % 12 + 12) % 12 = 6;

-- 2) Permisos como antes
drop policy if exists leer_empleados on public.empleados;
create policy leer_empleados on public.empleados for select to authenticated using (public.mi_empleado_id() is not null);
drop policy if exists gestionar_empleados on public.empleados;
create policy gestionar_empleados on public.empleados for all to authenticated using (public.soy_responsable()) with check (public.soy_responsable());

drop policy if exists leer_asignaciones on public.asignaciones;
create policy leer_asignaciones on public.asignaciones for select to authenticated using (public.mi_empleado_id() is not null);
drop policy if exists crear_asignaciones on public.asignaciones;
create policy crear_asignaciones on public.asignaciones for insert to authenticated
  with check (public.soy_responsable()
              or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)));
drop policy if exists cambiar_asignaciones on public.asignaciones;
create policy cambiar_asignaciones on public.asignaciones for update to authenticated
  using      (public.soy_responsable()
              or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)))
  with check (public.soy_responsable()
              or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)));
drop policy if exists borrar_asignaciones on public.asignaciones;
create policy borrar_asignaciones on public.asignaciones for delete to authenticated
  using (public.soy_responsable()
         or (empleado_id = public.mi_empleado_id() and not public.codigo_solo_responsables(codigo)));

drop policy if exists leer_cambios on public.cambios;
create policy leer_cambios on public.cambios for select to authenticated using (public.mi_empleado_id() is not null);

drop policy if exists formaciones_ver on public.formaciones;
create policy formaciones_ver on public.formaciones for select to authenticated using (public.mi_empleado_id() is not null);
drop policy if exists formaciones_escribir on public.formaciones;
create policy formaciones_escribir on public.formaciones for all to authenticated
  using      (public.soy_responsable() or empleado_id = public.mi_empleado_id())
  with check (public.soy_responsable() or empleado_id = public.mi_empleado_id());

drop policy if exists gestionar_codigos on public.codigos;
create policy gestionar_codigos on public.codigos for all to authenticated using (public.soy_responsable()) with check (public.soy_responsable());
drop policy if exists cursos_gestionar on public.cursos;
create policy cursos_gestionar on public.cursos for all to authenticated using (public.soy_responsable()) with check (public.soy_responsable());
drop policy if exists gestionar_dias on public.dias;
create policy gestionar_dias on public.dias for all to authenticated using (public.soy_responsable()) with check (public.soy_responsable());
drop policy if exists gestionar_config on public.config;
create policy gestionar_config on public.config for all to authenticated using (public.soy_responsable()) with check (public.soy_responsable());

-- 3) Quita lo añadido
drop function if exists public.mando_en(integer);
drop function if exists public.veo_empleado(integer);
drop function if exists public.mi_distrito_id();
drop function if exists public.turno_ciclo(text, date);
drop trigger  if exists distritos_turno on public.distritos;
drop function if exists public.distritos_turno();

alter table public.empleados drop constraint if exists empleados_nombre_distrito_key;
alter table public.empleados drop constraint if exists empleados_nombre_key;
alter table public.empleados add  constraint empleados_nombre_key unique (nombre);
alter table public.distritos drop constraint if exists distritos_nombre_turno_key;
alter table public.distritos drop constraint if exists distritos_nombre_key;
alter table public.distritos add  constraint distritos_nombre_key unique (nombre);
alter table public.distritos drop column if exists letra;
alter table public.distritos drop column if exists zona;

select 'deshecho' as resultado, (select count(*) from public.dias where turno = 'S') as dias_saliente;
