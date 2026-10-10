# Turno D – turnos y vacaciones

App web instalable (PWA) para el equipo. Supabase (base de datos + acceso) + Vercel (alojamiento). Gratis.

## Puesta en marcha (una sola vez)

1. **Supabase → SQL Editor → New query**: pega `supabase/schema.sql` y pulsa *Run*. Después, nueva consulta con `supabase/seed.sql` y *Run* (carga el calendario 2026 del Excel).
2. **Supabase → Authentication → Users → Add user → Create new user**: crea las 12 cuentas (correo + contraseña, marcando *Auto Confirm User*).
3. Copia `supabase/emails.sql`, sustituye los `@ejemplo.com` por los correos reales de cada persona y ejecútalo en el SQL Editor. Solo los correos que estén en `empleados` pueden ver o editar algo.
4. **Authentication → Sign In / Providers**: desactiva *Allow new users to sign up* (nadie más puede crearse cuenta).
5. Comprueba que `asignaciones` y `cambios` están activas en Realtime (el esquema ya lo intenta).
6. **Vercel → Add New → Project** → importa `cristobalmy/turnos` → *Deploy*. (`vercel.json` ya indica la carpeta `public`.)
7. En el móvil, abre la web y *Añadir a pantalla de inicio* (en iPhone, desde Safari).

## Permisos
- Responsables (Cristobal, Nacho, Cristina, Sobrino): editan a todos y son los únicos que ponen PICO y DESP.
- Resto: solo sus propios días. Lo garantiza la base de datos (RLS), no solo la pantalla.

## Pruebas
`bash tests/rls.sh` levanta un Postgres local desechable y comprueba esquema, importación y permisos.

## Avisos al móvil (opcional)
1. Supabase → Edge Functions → *Deploy a new function* → *Via Editor*, nombre `avisar`, pegar `supabase/functions/avisar/index.ts`. Desactivar *Verify JWT*.
2. Edge Functions → Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:tu@correo`) y `AVISO_SECRET`.
3. SQL Editor: ejecutar `supabase/migracion_002_avisos.sql` con `__SECRETO__` sustituido por el valor de `AVISO_SECRET`.
4. En cada móvil: Cuenta → *Activar avisos* (en iPhone, con la app instalada en la pantalla de inicio).
La clave pública VAPID va en `public/config.js`; la privada y el secreto nunca se suben al repositorio.
