-- JUICIO sin descripción y AUTOMOCIÓN borrado del todo (también sus 4 días del calendario).
update public.codigos set descripcion = '' where codigo = 'JUICIO';
delete from public.asignaciones where codigo = 'AUTOMOCIÓN';
delete from public.codigos where codigo = 'AUTOMOCIÓN';
select codigo, descripcion from public.codigos order by orden;
