-- Pone tildes (o el nombre completo que prefieras) a los nombres que se ven en la app.
-- Se identifica a cada persona por su número, así que no depende de cómo estuviera escrito antes.
-- Cambia lo que quieras entre comillas y ejecuta todo.
update public.empleados set nombre = 'Cristóbal' where id = 1;
update public.empleados set nombre = 'Cristina'  where id = 2;
update public.empleados set nombre = 'Nacho'     where id = 3;
update public.empleados set nombre = 'Gustavo'   where id = 4;
update public.empleados set nombre = 'Alfonso'   where id = 5;
update public.empleados set nombre = 'Rubén'     where id = 6;
update public.empleados set nombre = 'Rafa'      where id = 7;
update public.empleados set nombre = 'Alejandro' where id = 8;
update public.empleados set nombre = 'Sobrino'   where id = 9;
update public.empleados set nombre = 'Fortu'     where id = 10;
update public.empleados set nombre = 'Gerardo'   where id = 11;
update public.empleados set nombre = 'Álvaro'    where id = 12;
select id, nombre, rol from public.empleados order by orden;
