-- =====================================================================
-- Migración 020 · El aviso del PICO pasa de las 20:00 a las 10:00 (hora de Madrid) del día de antes.
-- Solo cambia la hora de la tarea programada. No toca datos.
-- 8:00 y 9:00 UTC: una de las dos son las 10:00 en Madrid (en verano y en invierno). La función solo avisa en esa.
-- Para volver a las 20:00: cambiar '0 8,9 * * *' por '0 18,19 * * *' y en la función pico poner 20 en vez de 10.
-- =====================================================================
select cron.alter_job((select jobid from cron.job where jobname = 'aviso-pico'), schedule := '0 8,9 * * *');
select jobname, schedule, active from cron.job where jobname = 'aviso-pico';
