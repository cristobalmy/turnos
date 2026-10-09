-- Cristobal nunca hace PICO. Ejecutar una vez en el SQL Editor de Supabase.
alter table public.empleados add column if not exists hace_pico boolean not null default true;
update public.empleados set hace_pico = false where id = 1; -- Cristobal

create or replace function public.asignaciones_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.codigo = 'PICO' and exists (select 1 from public.empleados where id = new.empleado_id and not hace_pico) then
    raise exception 'Esta persona no hace PICO';
  end if;
  new.actualizado_por := public.mi_empleado_id();
  new.actualizado_en  := now();
  return new;
end $$;

select nombre, hace_pico from public.empleados order by orden;
