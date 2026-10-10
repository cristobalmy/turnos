-- Material de dotación (extensible, chaleco interior, chaleco exterior), sin fecha. Ejecutar una vez en el SQL Editor de Supabase.
alter table public.cursos drop constraint if exists cursos_tipo_check;
alter table public.cursos add constraint cursos_tipo_check check (tipo in ('Formación','Habilitación','Material'));

insert into public.cursos(nombre, tipo, orden) values
  ('Extensible',       'Material', 12),
  ('Chaleco interior', 'Material', 13),
  ('Chaleco exterior', 'Material', 14)
on conflict (nombre) do nothing;

-- El material nunca lleva fecha: si llega con ella, se quita
create or replace function public.formaciones_sin_fecha_material() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.cursos c where c.nombre = new.nombre and c.tipo = 'Material') then
    new.fecha := null;
  end if;
  return new;
end $$;
drop trigger if exists formaciones_material on public.formaciones;
create trigger formaciones_material before insert or update on public.formaciones
  for each row execute function public.formaciones_sin_fecha_material();

select 'listo' as resultado;
