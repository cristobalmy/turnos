-- Formaciones y habilitaciones de cada persona. Ejecutar una vez en el SQL Editor de Supabase.
create table if not exists public.formaciones (
  id           bigint generated always as identity primary key,
  empleado_id  integer not null references public.empleados(id) on delete cascade,
  tipo         text    not null default 'Formación' check (tipo in ('Formación','Habilitación')),
  nombre       text    not null check (length(btrim(nombre)) > 0),
  fecha        date    not null,                       -- día en que se hizo
  creado_en    timestamptz not null default now()
);
create index if not exists formaciones_empleado on public.formaciones (empleado_id, fecha desc);

alter table public.formaciones enable row level security;
revoke all on public.formaciones from anon;
grant select, insert, update, delete on public.formaciones to authenticated;

-- Todo el equipo puede verlas
drop policy if exists formaciones_ver on public.formaciones;
create policy formaciones_ver on public.formaciones for select to authenticated
  using (public.mi_empleado_id() is not null);

-- Cada uno gestiona las suyas; los responsables, las de todos
drop policy if exists formaciones_escribir on public.formaciones;
create policy formaciones_escribir on public.formaciones for all to authenticated
  using      (public.soy_responsable() or empleado_id = public.mi_empleado_id())
  with check (public.soy_responsable() or empleado_id = public.mi_empleado_id());

select 'listo' as resultado;
