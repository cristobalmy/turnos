-- Permite apuntar una formación sin fecha ("no recuerdo la fecha"). Ejecutar una vez en el SQL Editor de Supabase.
alter table public.formaciones alter column fecha drop not null;
select 'listo' as resultado;
