# Activación de Grupos de estudio en Oficial

La pantalla utiliza la sesión de `login.html` y el mismo cliente Supabase de `pagina.html`. No crea salas, participantes ni mensajes de muestra. Una sala pública aparece cuando un estudiante la crea para un curso; una privada solo aparece a sus miembros.

## Ejecutar en el SQL Editor

En el proyecto Supabase que corresponde a `VITE_SUPABASE_URL`:

1. Ejecutar **`sync_features.sql`**, si aún está pendiente la actualización de Calendario/Horarios. Es transaccional e idempotente y conserva los eventos anteriores.
2. Ejecutar **`study_groups.sql`** completo. Requiere la tabla existente `profiles` y los roles estándar de Supabase. Puede ejecutarse nuevamente: no inserta registros de muestra ni borra salas existentes. Usa `study_room_messages` para conservar la tabla anterior `study_messages` y sus permisos.
3. Comprobar que las tres tablas `study_rooms`, `study_room_members` y `study_room_messages` tienen RLS activa y los permisos indicados abajo. La migración solicita recargar el esquema de PostgREST.
4. Con dos cuentas de prueba, crear una sala privada, compartir su código y comprobar que la segunda cuenta solo entra con ese código. Enviar un mensaje desde cada cuenta, recargar y comprobar que ambos siguen guardados. Salir de la sala debe retirar el acceso a su conversación.
5. Publicar el frontend después de aplicar las migraciones. Sin las funciones, la pantalla informa que falta configuración en el servidor y ofrece reintentar; no muestra datos inventados.

`SUPABASE_DB_URL` está configurada en el entorno, pero el proxy rechaza PostgreSQL con HTTP 403. Por decisión del usuario, las migraciones se entregan para el SQL Editor. **No se aplicaron a la base activa desde este entorno.** La variable administrativa nunca se usa en el navegador ni debe guardarse en Git.

## Permisos y datos

- El usuario autenticado descubre las salas públicas por curso. Las privadas requieren membresía, incluso si se conoce el UUID de la sala.
- Participantes y mensajes solo son legibles por miembros. No se publican correos, códigos de alumno ni UUID de cuenta en estas tablas; el navegador lee un nombre elegido al entrar. Ese nombre no acredita identidad y puede coincidir con el de otro miembro.
- Solo el creador consulta o renueva el código de invitación. Renovarlo impide nuevas entradas con el código anterior y conserva el acceso de los miembros actuales.
- El cliente no puede insertar, modificar o borrar directamente estas tablas. Los RPC verifican `auth.uid()`, membresía y propiedad. El servidor toma el nombre del autor de su membresía; el navegador no puede indicar otro autor.
- Se permiten cinco salas propias, 50 membresías por cuenta, 100 miembros por sala y diez mensajes por minuto por cuenta, sumando todas sus salas. Los límites se verifican con bloqueos en PostgreSQL. Los mensajes admiten 1200 caracteres.
- Creación y envío tienen UUID de petición para reintentos sin duplicados. Una respuesta fallida conserva el formulario o el mensaje en el navegador.
- Salir de una sala conserva los mensajes ya enviados. Cerrar una sala, tras confirmación del creador, elimina esa sala, sus membresías y sus mensajes. No hay borrado periódico ni estado de presencia en línea.
- La conversación consulta novedades cada diez segundos cuando la página es visible y carga el historial en páginas de 50 por fecha y UUID. Si falla la conexión, conserva los mensajes cargados y permite actualizar.

Consulta sin datos personales para revisar políticas y permisos efectivos:

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('study_rooms', 'study_room_members', 'study_room_messages');

select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('study_rooms', 'study_room_members', 'study_room_messages');

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('study_rooms', 'study_room_members', 'study_room_messages')
  and grantee in ('anon', 'authenticated');
```

Se esperan tres políticas SELECT para `authenticated`: sala pública o membresía, participantes por membresía y mensajes por membresía. No hay permisos de escritura directa ni lectura de `invite_code`, `owner_id`, `student_id` o `author_id`. Si ya existían tablas homónimas con otras políticas, revisar esas diferencias antes de publicar; la migración no elimina políticas ajenas ni datos desconocidos.

## Validación reproducible

```sh
npm run build
node --test tests/calendarModel.test.mjs tests/studyGroups.test.mjs
npm install --prefix /tmp/ia-sql-tests --no-save @electric-sql/pglite
PGLITE_MODULE=/tmp/ia-sql-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/studyGroups.sql.test.mjs
```

La prueba SQL crea una base local efímera con perfiles ficticios, ejecuta dos veces la migración y verifica aislamiento, privacidad de columnas, autor del servidor, códigos, límites, reintentos, paginación y cierre; también reproduce la tabla anterior de chat por curso y comprueba que sus registros, columnas y permisos se conservan. No usa `SUPABASE_DB_URL` ni toca producción. Las pruebas de navegador también se ejecutaron con respuestas Supabase simuladas: flujos de sala, fallos, recarga, teclado, móvil y temas claro/oscuro. La aplicación con cuentas reales debe comprobarse después de ejecutar el SQL.

## Corrección de `42703: column "room_id" does not exist`

El diagnóstico de la base activa mostró una tabla anterior `study_messages` con las columnas `id`, `course_id`, `author_id`, `alias`, `carrera`, `ciclo`, `body` y `created_at`. Esa tabla corresponde a un chat por curso y no tiene `room_id`. La primera versión de `study_groups.sql` reutilizaba el nombre con `CREATE TABLE IF NOT EXISTS`; PostgreSQL conservaba la tabla anterior y luego fallaba al crear el índice que necesitaba `room_id`.

La versión corregida crea **`study_room_messages`**, mantiene los mismos RPC usados por el frontend y conserva la estructura, los registros, los índices y los permisos de `study_messages`. No mueve mensajes entre conversaciones ni modifica los event triggers del proyecto. Ejecutar el archivo actualizado **completo en una consulta nueva** del SQL Editor. No reutilizar el texto guardado de la primera versión.

El diagnóstico también mostró `calendar_tasks` y las columnas nuevas de `calendar_events`: la estructura de Calendario ya estaba actualizada. `sync_features.sql` sigue siendo idempotente; su revisión de permisos se encuentra en `calendar_audit.sql`.

`migration_diagnostics.sql` devuelve las columnas, los event triggers y los nombres de funciones públicas que mencionan `room_id` en un único resultado, sin leer registros personales. Incluye ambas tablas de mensajes para comprobar esta separación.
