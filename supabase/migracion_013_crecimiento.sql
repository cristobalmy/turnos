-- 1) Calendario de turnos hasta 2035 (continúa el ciclo de 12 días M M T T N N S L L L L L). Se puede repetir sin problema.
insert into public.dias (fecha, turno)
select d::date, substr('MMTTNNSLLLLL', ((d::date - date '2026-01-01') % 12) + 1, 1)
from generate_series(date '2027-01-01', date '2035-12-31', interval '1 day') as d
on conflict (fecha) do nothing;

-- 2) Preparación para varios distritos: lista de distritos y distrito de cada persona
create table if not exists public.distritos (
  id               integer generated always as identity primary key,
  nombre           text not null unique,
  turno            text not null default 'D2',
  minimo_operativo integer not null default 6,
  tercio           integer not null default 4
);
insert into public.distritos (nombre, turno, minimo_operativo, tercio)
select 'Usera-Villaverde', 'D2',
       coalesce((select valor::int from public.config where clave = 'minimo_operativo'), 6),
       coalesce((select valor::int from public.config where clave = 'tercio'), 4)
where not exists (select 1 from public.distritos);
alter table public.empleados add column if not exists distrito_id integer references public.distritos(id);
update public.empleados set distrito_id = (select min(id) from public.distritos) where distrito_id is null;
alter table public.empleados alter column distrito_id set not null;

alter table public.distritos enable row level security;
revoke all on public.distritos from anon;
grant select, insert, update, delete on public.distritos to authenticated;
drop policy if exists leer_distritos on public.distritos;
create policy leer_distritos on public.distritos for select to authenticated using (public.mi_empleado_id() is not null);
drop policy if exists gestionar_distritos on public.distritos;
create policy gestionar_distritos on public.distritos for all to authenticated using (public.soy_admin()) with check (public.soy_admin());

-- 3) Notas por día: privadas, cada persona solo ve y toca las suyas
create table if not exists public.notas (
  empleado_id integer not null references public.empleados(id) on delete cascade,
  fecha       date    not null,
  texto       text    not null check (char_length(texto) between 1 and 500),
  actualizado timestamptz not null default now(),
  primary key (empleado_id, fecha)
);
alter table public.notas enable row level security;
revoke all on public.notas from anon;
grant select, insert, update, delete on public.notas to authenticated;
drop policy if exists notas_propias on public.notas;
create policy notas_propias on public.notas for all to authenticated
  using (empleado_id = public.mi_empleado_id()) with check (empleado_id = public.mi_empleado_id());

-- 4) Enlace personal del calendario del móvil
create table if not exists public.calendario_tokens (
  empleado_id integer primary key references public.empleados(id) on delete cascade,
  token       text not null unique check (char_length(token) >= 32),
  creado      timestamptz not null default now()
);
alter table public.calendario_tokens enable row level security;
revoke all on public.calendario_tokens from anon;
grant select, insert, update, delete on public.calendario_tokens to authenticated;
drop policy if exists token_propio on public.calendario_tokens;
create policy token_propio on public.calendario_tokens for all to authenticated
  using (empleado_id = public.mi_empleado_id()) with check (empleado_id = public.mi_empleado_id());

select (select count(*) from public.dias) as dias, (select max(fecha) from public.dias) as hasta, (select nombre from public.distritos limit 1) as distrito;
