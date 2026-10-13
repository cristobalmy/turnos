create table if not exists net._http_response(id bigint, status_code int, content text, error_msg text, created timestamptz default now());
insert into net._http_response(id,status_code,content) values (1,200,'avisados 3 de 5 móviles');
