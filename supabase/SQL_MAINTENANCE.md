# SQL de mantenimiento de Lyra

Revisión de la base activa del 13 de octubre de 2026 UTC. Las 40 consultas históricas del SQL Editor se conservan organizadas en 14 carpetas.

## Consultas consolidadas para una base ya instalada

| Módulo | Archivo | Contenido |
| --- | --- | --- |
| Recursos | `maintenance/recursos.sql` | 12 rutinas: publicación, URL canónica, descripción, corazones, listado y comentarios; mantiene las entradas públicas y la implementación privada. |
| Logros | `maintenance/logros.sql` | Una definición vigente de `reclamar_logros()`, con las 25 insignias y el catálogo ESAN generado; sustituye las tres versiones guardadas para mantenimiento de esa función. |
| Arcade | `maintenance/arcade.sql` | Temporada actual, envío y consulta del mejor puntaje; solo Dino, Galaxia y Memoria reciben puntajes nuevos. |

Estas instantáneas son transaccionales y repetibles en Lyra. Comprueban que las tablas requeridas existen y conservan las definiciones y permisos obtenidos de la base. No crean tablas, no reconstruyen índices o políticas RLS y no insertan ni borran registros. No son un instalador para un proyecto vacío ni deben sustituir futuras migraciones: revisar su vigencia antes de volver a ejecutarlas.

Los archivos de instalación `arcade.sql`, `logros.sql`, `professor_tags.sql`, `anti_spam_limits.sql` y `tool_social.sql` ya integran sus versiones sucesivas. Las consultas históricas del SQL Editor se mantienen como referencia; ejecutarlas de nuevo puede restablecer reglas antiguas.

## Limpieza de funciones

`retire_unused_functions.sql` retira exclusivamente:

- `public.lock_alias()`: no tiene trigger ni dependencia activa; el alias ya es editable y se sincroniza con comentarios y puntajes.
- `public.email_for_student_code(text)`: el código de la aplicación y la Edge Function desplegada `auth-by-code` no lo llaman; el rol de alumnos y el anónimo ya no pueden ejecutarlo.

El retiro comprueba la definición revisada, las dependencias catalogadas, los triggers, referencias en cuerpos de rutinas y los permisos de ejecución. Cualquier cambio desconocido aborta la transacción. Usa `RESTRICT`, nunca `CASCADE`.

La recuperación administrativa está en `history/unused_functions_restore.sql`: contiene las definiciones y permisos anteriores, sin reinstalar el trigger del alias ni publicar el correo a alumnos. No se modifica la Edge Function de autenticación.

Se conservan `my_tool_comment_count()` y `my_course_comment_count()` porque intervienen en políticas RLS. También se conservan las sobrecargas del chat y las rutinas de `app_private`: las primeras mantienen compatibilidad y las segundas separan las entradas públicas de las operaciones privilegiadas.

## Verificación

Antes del retiro: sin dependencias ni triggers para las dos funciones y sin referencias en la aplicación actual o `auth-by-code`. La limpieza se ensaya en una transacción con `ROLLBACK` antes de aplicarse. Las instantáneas consolidadas se ensayan también con `ROLLBACK` y se compara la definición y ACL de todas las demás rutinas, las políticas RLS y los triggers.

Después del retiro: ambas firmas deben devolver `NULL` con `to_regprocedure`; `handle_new_user`, `lock_carrera`, `sync_profile_alias`, `publish_resource`, `reclamar_logros` y las funciones de Arcade deben seguir presentes. Las pruebas de sesión ausente deben rechazar las RPC que requieren un usuario. No se usan registros ficticios persistentes para verificar esta entrega.

Esta revisión no retira tablas, datos ni otras funciones y no afirma resolver todos los avisos históricos del Security Advisor.


La reestructuración ESAN de `aea` usa `careers_catalog.sql` para catálogo y asignaciones de revisión. El generador sincroniza también la definición de Logros de mantenimiento. No ejecutar `history/carrera_pucp.sql`: es una referencia de restauración retirada de la oferta activa.
