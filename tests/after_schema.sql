-- Supabase da estos permisos por defecto; aquí se replican para la prueba.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
update public.empleados set email='cristobal@t.es' where nombre='Cristobal';  -- responsable
update public.empleados set email='nacho@t.es'     where nombre='Nacho';      -- responsable
update public.empleados set email='gustavo@t.es'   where nombre='Gustavo';    -- agente
