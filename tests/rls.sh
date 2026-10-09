#!/usr/bin/env bash
# Prueba el esquema y los permisos en un Postgres local desechable. Uso: bash tests/rls.sh
set -e
cd "$(dirname "$0")/.."; R=$PWD
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); D=/tmp/pg_turnos_test; PORT=54329
rm -rf $D; mkdir -p $D; chown postgres $D
su postgres -c "$PGBIN/initdb -D $D -A trust >/dev/null && $PGBIN/pg_ctl -D $D -o '-p $PORT -k /tmp' -l $D/log -w start >/dev/null"
trap "su postgres -c '$PGBIN/pg_ctl -D $D -m immediate stop' >/dev/null" EXIT
P="psql -X -q -h /tmp -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1"
$P -f tests/stub_supabase.sql
$P -f supabase/schema.sql
$P -f supabase/seed.sql
$P -f tests/after_schema.sql
$P -f tests/rls_scenarios.sql 2>&1 | grep -E "^(==|NOTICE|psql|ERROR)" | sed 's/^NOTICE:  //' | tee /tmp/rls_out.txt
! grep -q FALLO /tmp/rls_out.txt && echo "TODO CORRECTO" || { echo "HAY FALLOS"; exit 1; }
