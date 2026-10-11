-- =====================================================================
-- Migración 017 · Aviso del PICO la tarde de antes (20:00, hora de Madrid)
-- Antes: desplegar la Edge Function "pico" (Verify JWT desactivado).
-- Ejecutar una vez en Supabase → SQL Editor → Run. Se puede repetir sin problema.
-- No toca ningún dato. Para quitar el aviso: select cron.unschedule('aviso-pico');
-- =====================================================================
create extension if not exists pg_cron;

-- Usa el mismo secreto que los avisos de cambios (lo lee de la función que ya existe, no hay que escribirlo)
do $$
declare
  secreto text := substring(pg_get_functiondef('public.avisar_cambio'::regproc) from '''x-aviso-secret'',\s*''([^'']+)''');
begin
  if secreto is null or secreto = '__SECRETO__' then
    raise exception 'No encuentro el secreto de los avisos (migración 002). Avisa a Claude.';
  end if;
  if exists (select 1 from cron.job where jobname = 'aviso-pico') then
    perform cron.unschedule('aviso-pico');
  end if;
  -- 18:00 y 19:00 UTC: una de las dos son las 20:00 en Madrid (en verano y en invierno). La función solo avisa en esa.
  perform cron.schedule('aviso-pico', '0 18,19 * * *', format(
    $f$ select net.http_post(
          url     := 'https://exhushxtnbyyveflefgw.supabase.co/functions/v1/pico',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-secret', %L),
          body    := '{}'::jsonb) $f$, secreto));
end $$;

select jobname, schedule, active from cron.job where jobname = 'aviso-pico';
