\set ON_ERROR_STOP on
create or replace function pg_temp.chk(c boolean, msg text) returns void language plpgsql as
$$ begin if c then raise notice 'OK   %', msg; else raise notice 'FALLO %', msg; end if; end $$;
-- intenta ejecutar sql; devuelve true si da error (permiso denegado / política)
create or replace function pg_temp.falla(s text) returns boolean language plpgsql as
$$ begin execute s; return false; exception when others then return true; end $$;
create or replace function pg_temp.filas(s text) returns integer language plpgsql as
$$ declare n integer; begin execute s; get diagnostics n = row_count; return n; end $$;
grant execute on function pg_temp.chk(boolean,text), pg_temp.falla(text), pg_temp.filas(text) to public;

\echo == Importación
select pg_temp.chk((select count(*) from asignaciones) = 989, 'las 989 asignaciones del Excel están importadas');
select pg_temp.chk((select count(*) from dias) = 365, '365 días con su turno');
select pg_temp.chk((select count(*) from cambios) = 0, 'la importación no ensucia el historial');

\echo == Sin sesión / email desconocido
begin; set local role anon;
select pg_temp.chk(pg_temp.falla('select * from empleados'), 'sin iniciar sesión no se puede leer nada');
rollback;

begin; set local role authenticated; select set_config('request.jwt.claims','{"email":"intruso@x.es"}',true);
select pg_temp.chk((select count(*) from asignaciones) = 0, 'una cuenta que no está en empleados ve 0 asignaciones');
select pg_temp.chk(pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo) values (4,'2026-11-01','AP')$$), 'y tampoco puede escribir');
rollback;

\echo == Agente (Gustavo, id 4)
begin; set local role authenticated; select set_config('request.jwt.claims','{"email":"gustavo@t.es"}',true);
select pg_temp.chk((select count(*) from asignaciones) = 989, 've todo el calendario');
select pg_temp.chk(not pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo,actualizado_por) values (4,'2026-11-01','V2',3)$$), 'puede poner un código en su propio día');
select pg_temp.chk((select actualizado_por from asignaciones where empleado_id=4 and fecha='2026-11-01') = 4, 'no puede falsear quién hizo el cambio');
select pg_temp.chk(pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo) values (3,'2026-11-01','V2')$$), 'NO puede poner un código a otra persona');
select pg_temp.chk(pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo) values (4,'2026-11-02','PICO')$$), 'NO puede ponerse PICO');
select pg_temp.chk(pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo) values (4,'2026-11-02','DESP')$$), 'NO puede ponerse DESP');
select pg_temp.chk(pg_temp.filas($$update asignaciones set codigo='AP' where empleado_id=4 and codigo='PICO'$$) = 0, 'NO puede cambiar un PICO que le pusieron');
select pg_temp.chk(pg_temp.filas($$delete from asignaciones where empleado_id=4 and codigo='PICO'$$) = 0, 'NO puede borrarse un PICO');
select pg_temp.chk(pg_temp.filas($$update asignaciones set codigo='AP' where empleado_id=3$$) = 0, 'NO puede modificar días de otra persona');
select pg_temp.chk(pg_temp.filas($$delete from asignaciones where empleado_id=3$$) = 0, 'NO puede borrar días de otra persona');
select pg_temp.chk(pg_temp.falla($$update asignaciones set empleado_id=3 where empleado_id=4 and fecha='2026-11-01'$$), 'NO puede pasar su día a otra persona');
select pg_temp.chk(pg_temp.filas($$update asignaciones set codigo='AP' where empleado_id=4 and fecha='2026-11-01'$$) = 1, 'puede cambiar un código suyo normal');
select pg_temp.chk(pg_temp.filas($$delete from asignaciones where empleado_id=4 and fecha='2026-11-01'$$) = 1, 'puede quitar un código suyo normal');
select pg_temp.chk(pg_temp.filas($$update empleados set rol='responsable' where nombre='Gustavo'$$) = 0, 'NO puede hacerse responsable');
select pg_temp.chk(pg_temp.falla($$insert into codigos(codigo,descripcion,tipo,orden) values ('X','x','Especial',99)$$), 'NO puede crear códigos');
select pg_temp.chk(pg_temp.filas($$update config set valor='1' where clave='minimo_operativo'$$) = 0, 'NO puede cambiar el mínimo operativo');
select pg_temp.chk((select count(*) from cambios where hecho_por=4) = 3, 'sus 3 cambios quedan en el historial');
rollback;

\echo == Quien no hace PICO
begin; update empleados set hace_pico=false where nombre='Cristobal';
select pg_temp.chk(pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo) values (1,'2026-12-01','PICO')$$), 'no se puede poner PICO a quien no lo hace');
select pg_temp.chk(not pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo) values (1,'2026-12-01','V1')$$), 'pero sí otros códigos');
rollback;

\echo == Avisos al móvil
begin; set local role authenticated; select set_config('request.jwt.claims','{"email":"gustavo@t.es"}',true);
select pg_temp.chk(not pg_temp.falla($$insert into push_subs(endpoint,empleado_id,p256dh,auth) values ('https://push/g',4,'k','a')$$), 'puede apuntar su propio móvil');
select pg_temp.chk(pg_temp.falla($$insert into push_subs(endpoint,empleado_id,p256dh,auth) values ('https://push/x',3,'k','a')$$), 'NO puede apuntar un móvil a nombre de otra persona');
insert into asignaciones(empleado_id,fecha,codigo) values (4,'2026-11-03','V1');
insert into asignaciones(empleado_id,fecha,codigo) values (4,'2026-11-04','V1');
reset role;
select pg_temp.chk((select count(*) from net.llamadas) = 2, 'cada cambio hecho en la app lanza la llamada de aviso');
select pg_temp.chk((select body->>'hecho_por' from net.llamadas limit 1) = '4' and (select headers->>'x-aviso-secret' from net.llamadas limit 1) = 'secreto-de-prueba', 'la llamada lleva el autor y el secreto');
select pg_temp.chk((select count(*) from cambios where avisado) = 0, 'los cambios nuevos quedan pendientes de avisar');
rollback;
begin; set local role authenticated; select set_config('request.jwt.claims','{"email":"nacho@t.es"}',true);
select pg_temp.chk((select count(*) from push_subs) = 0, 'nadie ve los móviles de los demás');
rollback;
begin; insert into asignaciones(empleado_id,fecha,codigo) values (4,'2026-11-05','V1');
select pg_temp.chk((select count(*) from net.llamadas) = 0, 'un cambio desde el panel de Supabase no genera aviso');
rollback;

\echo == Cursos y habilitaciones (lista cerrada)
select pg_temp.chk((select string_agg(nombre, ' | ' order by nombre) from cursos where tipo='Habilitación') = 'Extensible | IE - Taser 10 | IE - Taser 7', 'las habilitaciones ya no llevan "Habilitación" delante');
select pg_temp.chk((select count(*) from cursos where nombre = 'Extensible (material)' and tipo = 'Material') = 1, 'el material extensible se distingue de la habilitación');
select pg_temp.chk((select count(*) from cursos) = 14 and (select count(*) from cursos where tipo='Habilitación') = 3 and (select count(*) from cursos where tipo='Material') = 3, 'la lista tiene 3 habilitaciones, 8 formaciones y 3 materiales');
begin; set local role authenticated; select set_config('request.jwt.claims','{"email":"gustavo@t.es"}',true);
select pg_temp.chk(not pg_temp.falla($$insert into formaciones(empleado_id,nombre,fecha) values (4,'Intervención vehículos','2026-03-02')$$), 'puede apuntar un curso de la lista (con tildes)');
select pg_temp.chk((select nombre from formaciones where empleado_id=4) = 'Intervención vehículos', 'las tildes se guardan tal cual');
select pg_temp.chk(not pg_temp.falla($$insert into formaciones(empleado_id,nombre,fecha) values (4,'TAU 2',null)$$), 'se puede apuntar sin fecha (no recuerdo la fecha)');
select pg_temp.chk(not pg_temp.falla($$insert into formaciones(empleado_id,nombre,fecha) values (4,'Chaleco interior','2026-05-05')$$), 'puede apuntar material de dotación');
select pg_temp.chk((select fecha is null from formaciones where nombre='Chaleco interior'), 'el material se guarda siempre sin fecha');
select pg_temp.chk(pg_temp.falla($$insert into formaciones(empleado_id,nombre,fecha) values (4,'Curso inventado','2026-03-02')$$), 'NO puede apuntar un curso que no está en la lista');
select pg_temp.chk(pg_temp.falla($$insert into formaciones(empleado_id,nombre,fecha) values (3,'TAIP','2026-03-02')$$), 'NO puede apuntar uno a otra persona');
select pg_temp.chk(pg_temp.filas($$update formaciones set fecha='2026-03-03' where empleado_id=4$$) = 3, 'puede corregir la fecha de la suya');
select pg_temp.chk(pg_temp.falla($$update formaciones set empleado_id=3 where empleado_id=4$$), 'NO puede pasarla a otra persona');
select pg_temp.chk(pg_temp.falla($$insert into cursos(nombre,tipo,orden) values ('Nuevo','Formación',99)$$), 'un agente NO puede cambiar la lista de cursos');
rollback;
begin; insert into formaciones(empleado_id,nombre,fecha) values (4,'TAIP','2026-01-10');
set local role authenticated; select set_config('request.jwt.claims','{"email":"alfonso@t.es"}',true);
select pg_temp.chk((select count(*) from formaciones) = 0 and (select count(*) from cursos) = 0, 'una cuenta no autorizada no ve nada');
select set_config('request.jwt.claims','{"email":"gustavo@t.es"}',true);
select pg_temp.chk(pg_temp.filas($$delete from formaciones where empleado_id=4$$) = 1, 'puede borrar la suya');
rollback;
begin; insert into formaciones(empleado_id,nombre,fecha) values (4,'TAIP','2026-01-10');
set local role authenticated; select set_config('request.jwt.claims','{"email":"nacho@t.es"}',true);
select pg_temp.chk((select count(*) from formaciones) = 1, 'todo el equipo ve las de los demás');
select pg_temp.chk(pg_temp.filas($$update formaciones set nombre='TAU 1' where empleado_id=4$$) = 1, 'un responsable puede editar las de otros');
select pg_temp.chk(not pg_temp.falla($$insert into cursos(nombre,tipo,orden) values ('Nuevo','Formación',99)$$), 'un responsable puede ampliar la lista');
rollback;

\echo == Días pasados
begin;
insert into asignaciones(empleado_id,fecha,codigo) values (4,(now() at time zone 'Europe/Madrid')::date - 3,'V1');
insert into asignaciones(empleado_id,fecha,codigo) values (3,(now() at time zone 'Europe/Madrid')::date - 3,'V1');
set local role authenticated; select set_config('request.jwt.claims','{"email":"gustavo@t.es"}',true);
select pg_temp.chk(pg_temp.falla(format($f$insert into asignaciones(empleado_id,fecha,codigo) values (4,%L,'AP')$f$, (now() at time zone 'Europe/Madrid')::date - 1)), 'un agente NO puede apuntar un día pasado');
select pg_temp.chk(pg_temp.falla(format($f$update asignaciones set codigo='AP' where empleado_id=4 and fecha=%L$f$, (now() at time zone 'Europe/Madrid')::date - 3)), 'un agente NO puede cambiar un día pasado');
select pg_temp.chk(pg_temp.falla(format($f$delete from asignaciones where empleado_id=4 and fecha=%L$f$, (now() at time zone 'Europe/Madrid')::date - 3)), 'un agente NO puede borrar un día pasado');
select pg_temp.chk(pg_temp.falla(format($f$update asignaciones set fecha=%L where empleado_id=4 and fecha=%L$f$, (now() at time zone 'Europe/Madrid')::date - 5, (now() at time zone 'Europe/Madrid')::date - 3)), 'ni mover un día pasado a otra fecha pasada');
select pg_temp.chk(not pg_temp.falla(format($f$insert into asignaciones(empleado_id,fecha,codigo) values (4,%L,'AP')$f$, (now() at time zone 'Europe/Madrid')::date)), 'sí puede apuntar HOY');
select pg_temp.chk(not pg_temp.falla(format($f$insert into asignaciones(empleado_id,fecha,codigo) values (4,%L,'AP')$f$, (now() at time zone 'Europe/Madrid')::date + 7)), 'y días futuros');
select pg_temp.chk(pg_temp.falla(format($f$update asignaciones set fecha=%L where empleado_id=4 and codigo='AP' and fecha=%L$f$, (now() at time zone 'Europe/Madrid')::date - 2, (now() at time zone 'Europe/Madrid')::date + 7)), 'NO puede llevar un día futuro al pasado');
rollback;
begin;
insert into asignaciones(empleado_id,fecha,codigo) values (4,(now() at time zone 'Europe/Madrid')::date - 3,'V1');
set local role authenticated; select set_config('request.jwt.claims','{"email":"nacho@t.es"}',true);
select pg_temp.chk(pg_temp.falla(format($f$update asignaciones set codigo='AP' where empleado_id=4 and fecha=%L$f$, (now() at time zone 'Europe/Madrid')::date - 3)), 'un responsable (no administrador) tampoco puede cambiar días pasados');
select pg_temp.chk(pg_temp.falla($$update empleados set admin = true where nombre='Nacho'$$), 'un responsable NO puede nombrarse administrador');
select pg_temp.chk(not pg_temp.falla(format($f$insert into asignaciones(empleado_id,fecha,codigo) values (4,%L,'PICO')$f$, (now() at time zone 'Europe/Madrid')::date + 2)), 'pero sí gestiona días futuros');
rollback;
begin;
insert into asignaciones(empleado_id,fecha,codigo) values (4,(now() at time zone 'Europe/Madrid')::date - 3,'V1');
set local role authenticated; select set_config('request.jwt.claims','{"email":"cristobal@t.es"}',true);
select pg_temp.chk(not pg_temp.falla(format($f$update asignaciones set codigo='AP' where empleado_id=4 and fecha=%L$f$, (now() at time zone 'Europe/Madrid')::date - 3)), 'el administrador SÍ puede cambiar días pasados');
select pg_temp.chk(not pg_temp.falla(format($f$delete from asignaciones where empleado_id=4 and fecha=%L$f$, (now() at time zone 'Europe/Madrid')::date - 3)), 'y borrarlos');
rollback;

\echo == Responsable (Nacho, id 3)
begin; set local role authenticated; select set_config('request.jwt.claims','{"email":"NACHO@t.es"}',true);
select pg_temp.chk(not pg_temp.falla($$insert into asignaciones(empleado_id,fecha,codigo) values (4,'2026-11-02','PICO')$$), 'puede poner PICO a otra persona (el email no distingue mayúsculas)');
select pg_temp.chk(pg_temp.filas($$update asignaciones set codigo='AP' where empleado_id=4 and fecha='2026-11-02'$$) = 1, 'puede cambiar días de otra persona');
select pg_temp.chk(pg_temp.filas($$delete from asignaciones where empleado_id=4 and fecha='2026-11-02'$$) = 1, 'puede borrar días de otra persona');
select pg_temp.chk(pg_temp.filas($$update empleados set orden=orden where nombre='Gustavo'$$) = 1, 'puede gestionar empleados');
select pg_temp.chk(pg_temp.filas($$update config set valor='6' where clave='minimo_operativo'$$) = 1, 'puede cambiar el mínimo operativo');
rollback;
