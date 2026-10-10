-- Quita "Habilitación" del principio del nombre de las habilitaciones. Ejecutar una vez en el SQL Editor de Supabase.
-- Los registros que ya hubiera apuntados se actualizan solos con el nombre nuevo.

-- El material "Extensible" cambia de nombre para dejar libre "Extensible" a la habilitación
update public.cursos set nombre = 'Extensible (material)' where nombre = 'Extensible' and tipo = 'Material';
update public.cursos set nombre = 'Extensible'     where nombre = 'Habilitación extensible';
update public.cursos set nombre = 'IE - Taser 7'   where nombre = 'Habilitación IE - Taser 7';
update public.cursos set nombre = 'IE - Taser 10'  where nombre = 'Habilitación IE - Taser 10';

select nombre, tipo from public.cursos order by tipo, nombre;
