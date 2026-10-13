-- =====================================================================
-- Comprobación de los avisos al móvil. No cambia ningún dato.
-- Supabase → SQL Editor → pegar entero → Run. Espera 10 segundos y pulsa Run otra vez.
-- La segunda vez ya sale la respuesta del aviso de prueba. Copia la tabla de resultados y pásasela a Claude.
-- =====================================================================

-- Aviso de prueba a los móviles de Cristóbal (id 1), enviado desde el servidor como un aviso real.
do $$
declare secreto text;
begin
  begin
    secreto := substring(pg_get_functiondef('public.avisar_cambio'::regproc) from '''x-aviso-secret'',\s*''([^'']+)''');
  exception when others then secreto := null;
  end;
  if secreto is null then
    raise exception 'No encuentro el secreto de los avisos. Avisa a Claude.';
  else
    perform net.http_post(
      url     := 'https://exhushxtnbyyveflefgw.supabase.co/functions/v1/avisar',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-secret', secreto),
      body    := '{"prueba": 1}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
end $$;

select * from (
  select 1 as orden, '1. Disparador de avisos' as que,
         case when exists (select 1 from pg_trigger where tgname = 'cambios_avisar') then 'instalado' else 'NO ESTÁ' end as detalle
  union all
  select 2, '2. Móviles con avisos activados',
         coalesce((select string_agg(e.nombre || ': ' || n, ', ' order by e.orden)
                   from (select empleado_id, count(*) n from public.push_subs group by empleado_id) p
                   join public.empleados e on e.id = p.empleado_id), 'NINGUNO')
  union all
  select 3, '3. Último cambio en la app',
         coalesce((select to_char(c.creado_en at time zone 'Europe/Madrid', 'DD/MM HH24:MI') || ' · ' || coalesce(e.nombre, '?') || ' · '
                          || coalesce(c.codigo_antes, '—') || ' → ' || coalesce(c.codigo_despues, '—') || ' · avisado: ' || c.avisado
                   from public.cambios c left join public.empleados e on e.id = c.hecho_por
                   order by c.creado_en desc limit 1), 'ninguno')
  union all
  select 3 + row_number() over (order by created desc), '4. Respuesta del servidor',
         to_char(created at time zone 'Europe/Madrid', 'DD/MM HH24:MI:SS') || ' · ' || coalesce(status_code::text, 'sin respuesta')
         || ' · ' || left(coalesce(content::text, error_msg, ''), 250)
  from (select * from net._http_response order by created desc limit 6) r
) t order by orden;
