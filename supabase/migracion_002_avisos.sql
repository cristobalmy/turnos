-- Avisos al móvil cuando alguien apunta o cambia un código.
-- ANTES de ejecutar: cambia __SECRETO__ (aparece una sola vez, más abajo) por el secreto que te di.
-- Ejecutar una vez en el SQL Editor de Supabase.

create extension if not exists pg_net with schema extensions;

-- 1) Marca de "ya avisado" en el historial (los cambios anteriores no generan avisos)
alter table public.cambios add column if not exists avisado boolean not null default false;
update public.cambios set avisado = true;

-- 2) Dónde se guarda cada móvil que activa los avisos
create table if not exists public.push_subs (
  endpoint     text primary key,
  empleado_id  integer not null references public.empleados(id) on delete cascade,
  p256dh       text not null,
  auth         text not null,
  creado_en    timestamptz not null default now()
);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon;
grant select, insert, update, delete on public.push_subs to authenticated;

drop policy if exists push_subs_propias on public.push_subs;
create policy push_subs_propias on public.push_subs for all to authenticated
  using (empleado_id = public.mi_empleado_id())
  with check (empleado_id = public.mi_empleado_id());

-- 3) Cada cambio avisa a la función "avisar" (que espera unos segundos y junta los cambios seguidos en un solo aviso)
create or replace function public.avisar_cambio() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.hecho_por is null then return null; end if;      -- cambios hechos desde el panel de Supabase: sin aviso
  perform net.http_post(
    url     := 'https://exhushxtnbyyveflefgw.supabase.co/functions/v1/avisar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-secret', '__SECRETO__'),
    body    := jsonb_build_object('hecho_por', new.hecho_por)
  );
  return null;
end $$;

drop trigger if exists cambios_avisar on public.cambios;
create trigger cambios_avisar after insert on public.cambios
  for each row execute function public.avisar_cambio();

select 'listo' as resultado;
