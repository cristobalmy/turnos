-- Primer acceso: cada persona elige su propia contraseña la primera vez que entra.
alter table public.empleados add column if not exists clave_cambiada boolean not null default false;

create or replace function public.marcar_clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update public.empleados set clave_cambiada = true where id = public.mi_empleado_id();
$$;
revoke all on function public.marcar_clave_cambiada() from public, anon;
grant execute on function public.marcar_clave_cambiada() to authenticated;

select 'listo' as resultado;
