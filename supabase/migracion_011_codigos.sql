-- Limpieza de códigos: textos más claros, PAT/MAT/LAC fuera (los cubre P/M/L) y AUTOMOCIÓN oculto
-- (se mantiene en la base solo porque tiene 4 días apuntados; ya no se ofrece ni cuenta en los informes).
update public.codigos set descripcion = ''                               where codigo = 'PNT';
update public.codigos set descripcion = 'Reconocimiento médico'          where codigo = 'MEDI';
update public.codigos set descripcion = 'Juicio'                         where codigo = 'JUICIO';
update public.codigos set descripcion = 'Formación'                      where codigo = 'FORM';
update public.codigos set descripcion = 'Paternidad / Maternidad / Lactancia' where codigo = 'P/M/L';

alter table public.codigos add column if not exists oculto boolean not null default false;
update public.codigos set oculto = true where codigo = 'AUTOMOCIÓN';

delete from public.codigos c where c.codigo in ('PAT', 'MAT', 'LAC')
  and not exists (select 1 from public.asignaciones a where a.codigo = c.codigo);

select codigo, descripcion, oculto from public.codigos order by orden;
