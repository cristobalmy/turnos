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
$P -f supabase/migracion_001_pico.sql >/dev/null
sed -e '/create extension/d' -e "s/__SECRETO__/secreto-de-prueba/" supabase/migracion_002_avisos.sql | $P >/dev/null
$P -f supabase/migracion_003_formaciones.sql >/dev/null
$P -f supabase/migracion_004_cursos.sql >/dev/null
$P -f supabase/migracion_004_cursos.sql >/dev/null   # repetirla no debe dar error
$P -f supabase/migracion_005_fecha_opcional.sql >/dev/null
$P -f supabase/migracion_006_material.sql >/dev/null
$P -f supabase/migracion_007_dias_pasados.sql >/dev/null
$P -f supabase/migracion_008_nombres_habilitaciones.sql >/dev/null
$P -f supabase/migracion_010_primer_acceso.sql >/dev/null
$P -f supabase/migracion_010_primer_acceso.sql >/dev/null   # repetirla no debe dar error
$P -f tests/after_schema.sql
$P -f tests/rls_scenarios.sql 2>&1 | grep -E "^(==|NOTICE|psql|ERROR)" | sed 's/^NOTICE:  //' | tee /tmp/rls_out.txt
! grep -q FALLO /tmp/rls_out.txt && echo "TODO CORRECTO" || { echo "HAY FALLOS"; exit 1; }
