-- Simula lo mínimo de Supabase para poder probar el esquema en un Postgres normal.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;

-- Simula pg_net: en vez de llamar a internet, apunta la llamada en una tabla.
create schema extensions;
create schema net;
create table net.llamadas(url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as
  $$ insert into net.llamadas values (url, headers, body); select 1::bigint $$;
