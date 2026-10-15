-- =====================================================================
-- Migración 019 · "Fuera temporalmente" (p. ej. destinado unas semanas en otro equipo)
-- La persona sigue pudiendo entrar y ver el calendario, pero no sale en las filas, no cuenta en el tercio
-- ni en los que trabajan, no entra en el PICO y su binomio queda como "sin binomio".
-- Ejecutar una vez en Supabase → SQL Editor → Run. Se puede repetir. No borra datos.
-- Para deshacer: alter table public.empleados drop column fuera;
-- =====================================================================
alter table public.empleados add column if not exists fuera boolean not null default false;
select nombre, activo, fuera from public.empleados order by orden;
