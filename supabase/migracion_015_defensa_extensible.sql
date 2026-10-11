-- Habilitación "Extensible" -> "Defensa extensible"; material "Extensible (material)" -> "Extensible".
-- Los registros que ya hubiera apuntados se actualizan solos con el nombre nuevo. Se puede repetir sin problema.
update public.cursos set nombre = 'Defensa extensible' where nombre = 'Extensible' and tipo = 'Habilitación';
update public.cursos set nombre = 'Extensible' where nombre = 'Extensible (material)' and tipo = 'Material';

select nombre, tipo from public.cursos order by tipo, nombre;
