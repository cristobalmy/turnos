-- Bloquea los cambios en días ya pasados (solo el administrador puede). Ejecutar una vez en el SQL Editor de Supabase.

-- 1) Quién es administrador (solo Cristobal, id 1)
alter table public.empleados add column if not exists admin boolean not null default false;
update public.empleados set admin = true where id = 1;

create or replace function public.soy_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empleados
    where activo and admin
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

-- Nadie puede nombrarse administrador (ni quitárselo a otro) si no lo es ya.
-- Los cambios hechos desde el panel de Supabase sí se permiten.
create or replace function public.empleados_guarda_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.mi_empleado_id() is null or public.soy_admin() then return new; end if;
  if tg_op = 'INSERT' and new.admin then raise exception 'Solo el administrador puede nombrar administradores'; end if;
  if tg_op = 'UPDATE' and new.admin is distinct from old.admin then raise exception 'Solo el administrador puede cambiar quién es administrador'; end if;
  return new;
end $$;
drop trigger if exists empleados_admin on public.empleados;
create trigger empleados_admin before insert or update on public.empleados
  for each row execute function public.empleados_guarda_admin();

-- 2) Días pasados del calendario: bloqueados para todos menos el administrador
create or replace function public.asignaciones_no_pasado() returns trigger
language plpgsql security definer set search_path = public as $$
declare hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  if public.mi_empleado_id() is null or public.soy_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('UPDATE','DELETE') and old.fecha < hoy then
    raise exception 'No se pueden modificar días pasados. Contacta con el administrador.';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.fecha < hoy then
    raise exception 'No se pueden modificar días pasados. Contacta con el administrador.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists asignaciones_pasado on public.asignaciones;
create trigger asignaciones_pasado before insert or update or delete on public.asignaciones
  for each row execute function public.asignaciones_no_pasado();

select nombre, admin from public.empleados order by orden;
