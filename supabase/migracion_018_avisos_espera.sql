-- =====================================================================
-- Migración 018 · Los avisos dejaban de enviarse por falta de tiempo
-- La base de datos solo esperaba 5 segundos a la función "avisar", que espera 4 para juntar
-- los cambios seguidos: se cortaba antes de mandar los avisos ("Timeout of 5000 ms reached").
-- Ahora espera hasta 30 segundos. Ejecutar una vez en Supabase → SQL Editor → Run. Se puede repetir.
-- No toca ningún dato. Para volver atrás: ejecutar otra vez la migración 002 (con el secreto).
-- =====================================================================
do $$
declare
  secreto text := substring(pg_get_functiondef('public.avisar_cambio'::regproc) from '''x-aviso-secret'',\s*''([^'']+)''');
begin
  if secreto is null or secreto = '__SECRETO__' then
    raise exception 'No encuentro el secreto de los avisos (migración 002). Avisa a Claude.';
  end if;
  execute format($f$
    create or replace function public.avisar_cambio() returns trigger
    language plpgsql security definer set search_path = public, extensions as $b$
    begin
      if new.hecho_por is null then return null; end if;      -- cambios hechos desde el panel de Supabase: sin aviso
      perform net.http_post(
        url     := 'https://exhushxtnbyyveflefgw.supabase.co/functions/v1/avisar',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-secret', %L),
        body    := jsonb_build_object('hecho_por', new.hecho_por),
        timeout_milliseconds := 30000
      );
      return null;
    end $b$ $f$, secreto);

  -- El aviso del PICO (migración 017), si está programado, también con más margen
  if exists (select 1 from pg_namespace where nspname = 'cron') and exists (select 1 from cron.job where jobname = 'aviso-pico') then
    perform cron.unschedule('aviso-pico');
    perform cron.schedule('aviso-pico', '0 18,19 * * *', format(
      $p$ select net.http_post(
            url     := 'https://exhushxtnbyyveflefgw.supabase.co/functions/v1/pico',
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-secret', %L),
            body    := '{}'::jsonb,
            timeout_milliseconds := 30000) $p$, secreto));
  end if;
end $$;

select 'listo: los avisos esperan hasta 30 segundos' as resultado;
