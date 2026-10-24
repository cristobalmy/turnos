create schema if not exists cron;
create table if not exists cron.job(jobid bigserial, jobname text primary key, schedule text, command text, active boolean default true);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command; select 1::bigint $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n; select true $$;
create or replace function cron.alter_job(job_id bigint, schedule text default null) returns void language sql as $$ update cron.job set schedule = coalesce(alter_job.schedule, cron.job.schedule) where jobid = job_id $$;
