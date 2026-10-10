-- Lista cerrada de cursos/habilitaciones. Ejecutar una vez en el SQL Editor de Supabase
-- (sirve tanto si ya ejecutaste la migración 003 como si no).

-- 1) La lista de cursos. "tipo" decide si es habilitación o formación.
create table if not exists public.cursos (
  nombre  text primary key,
  tipo    text not null check (tipo in ('Formación','Habilitación')),
  orden   integer not null
);
insert into public.cursos(nombre, tipo, orden) values
  ('Habilitación IE - Taser 7',  'Habilitación', 1),
  ('Habilitación IE - Taser 10', 'Habilitación', 2),
  ('Habilitación extensible',    'Habilitación', 3),
  ('Binomio IE',                 'Formación',    4),
  ('TAIP',                       'Formación',    5),
  ('Falsedad documental',        'Formación',    6),
  ('Automoción',                 'Formación',    7),
  ('TAU 1',                      'Formación',    8),
  ('TAU 2',                      'Formación',    9),
  ('Intervención vehículos',     'Formación',   10),
  ('Práctica jurídica',          'Formación',   11)
on conflict (nombre) do nothing;

-- 2) Los registros de cada persona (si ya existía de la 003, se aprovecha)
create table if not exists public.formaciones (
  id           bigint generated always as identity primary key,
  empleado_id  integer not null references public.empleados(id) on delete cascade,
  nombre       text    not null,
  fecha        date    not null,                       -- día en que se hizo
  creado_en    timestamptz not null default now()
);
create index if not exists formaciones_empleado on public.formaciones (empleado_id, fecha desc);
alter table public.formaciones drop column if exists tipo;   -- ahora el tipo sale de la lista de cursos
alter table public.formaciones drop constraint if exists formaciones_nombre_check;

-- El nombre tiene que ser uno de la lista (los registros antiguos que no encajen se conservan, pero los nuevos no)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'formaciones_curso_fk') then
    alter table public.formaciones add constraint formaciones_curso_fk
      foreign key (nombre) references public.cursos(nombre) on update cascade on delete restrict not valid;
  end if;
end $$;

-- 3) Permisos
alter table public.cursos enable row level security;
revoke all on public.cursos from anon;
grant select, insert, update, delete on public.cursos to authenticated;
drop policy if exists cursos_ver on public.cursos;
create policy cursos_ver on public.cursos for select to authenticated using (public.mi_empleado_id() is not null);
drop policy if exists cursos_gestionar on public.cursos;
create policy cursos_gestionar on public.cursos for all to authenticated
  using (public.soy_responsable()) with check (public.soy_responsable());

alter table public.formaciones enable row level security;
revoke all on public.formaciones from anon;
grant select, insert, update, delete on public.formaciones to authenticated;
drop policy if exists formaciones_ver on public.formaciones;
create policy formaciones_ver on public.formaciones for select to authenticated
  using (public.mi_empleado_id() is not null);
drop policy if exists formaciones_escribir on public.formaciones;
create policy formaciones_escribir on public.formaciones for all to authenticated
  using      (public.soy_responsable() or empleado_id = public.mi_empleado_id())
  with check (public.soy_responsable() or empleado_id = public.mi_empleado_id());

-- Si sale alguna fila aquí, son registros antiguos con un nombre que no está en la lista
select f.id, f.empleado_id, f.nombre from public.formaciones f
  where f.nombre not in (select nombre from public.cursos);
