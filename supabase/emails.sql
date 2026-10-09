-- Asocia cada persona con el correo de su cuenta. Solo estos correos pueden entrar en la app.
update public.empleados set email = 'cristobal.my@gmail.com'            where nombre = 'Cristobal';
update public.empleados set email = 'cristinaredondoreverte@gmail.com'  where nombre = 'Cristina';
update public.empleados set email = 'nachogarciasilva@gmail.com'        where nombre = 'Nacho';
update public.empleados set email = 'gustavoguijarro.ggf@gmail.com'     where nombre = 'Gustavo';
update public.empleados set email = 'alfonsofuentesortega@gmail.com'    where nombre = 'Alfonso';
update public.empleados set email = 'ruben.sanchez.jmz@gmail.com'       where nombre = 'Ruben';
update public.empleados set email = 'rafanarcis@gmail.com'              where nombre = 'Rafa';
update public.empleados set email = 'alexmateos23@gmail.com'            where nombre = 'Alejandro';
update public.empleados set email = 'alvarito1907@gmail.com'            where nombre = 'Sobrino';
update public.empleados set email = 'alexsastre1185@gmail.com'          where nombre = 'Fortu';
update public.empleados set email = 'gerardovila1@gmail.com'            where nombre = 'Gerardo';
update public.empleados set email = 'rodriguez.casado.alvaro@gmail.com' where nombre = 'Alvaro';
update public.empleados set hace_pico = false where nombre = 'Cristobal';
select nombre, rol, email from public.empleados order by orden;
