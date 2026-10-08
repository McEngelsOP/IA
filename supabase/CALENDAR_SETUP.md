# Calendario/Horarios de Oficial

`pagina.html` guarda exclusivamente registros reales del usuario con sesión iniciada. No crea muestras ni usa almacenamiento local como sustituto de Supabase.

## Actualizar un proyecto existente

1. Ejecutar **`sync_features.sql`** con una conexión administrativa o en Supabase → SQL Editor. Es transaccional e idempotente. Conserva eventos anteriores (`date` o rangos `start_date`/`end_date`) y el plan existente.
2. Verificar que `calendar_events` incluye `event_type`, `start_time`, `end_time`, `location`, `course_id`, `repeat_rule`, `repeat_until`, `updated_at`, y que existe `calendar_tasks` con RLS activada.
3. Comprobar desde dos cuentas distintas: crear un evento y una tarea, recargar, editar y eliminar; la segunda cuenta no debe verlos. Los horarios usan la hora de Lima (UTC−5). Una edición o eliminación semanal afecta a toda la serie.
4. Publicar el frontend después de aplicar la migración. Sin esa migración, la pantalla informa que no pudo cargar el calendario y permite reintentar.

La migración no borra registros, ni altera notas, perfiles, profesores, reseñas o puntajes. Las restricciones nuevas se crean `NOT VALID` en eventos para preservar filas históricas; se aplican a toda escritura nueva. Si existe una política adicional desconocida en estas tablas, revisar sus permisos antes de publicar: las políticas permisivas se combinan con OR.

## Limpieza de SQL

Se consolidaron diez archivos sustituidos por versiones posteriores:

| Archivo vigente | Versiones integradas y retiradas |
| --- | --- |
| `arcade.sql` | `astro.sql`, `frogger.sql`, `memoria.sql`, `fix_submit_score.sql`, `temporadas.sql` |
| `logros.sql` | `logros2.sql`, `logros3.sql` |
| `professor_tags.sql` | `professor_tags_multi.sql` |
| `anti_spam_limits.sql` | `tools_limit_20.sql` |
| `tool_social.sql` | `tool_comments_limit_fix.sql` |

Son scripts de instalación consolidados, no una orden de volver a ejecutar todos los scripts en una base existente. Sus tablas contienen datos reales y se conservan. Los scripts históricos de carreras y estados mantienen su orden de instalación porque incluyen transformaciones distintas.

`setup.sql` ya no crea el antiguo RPC `email_for_student_code`. `revoke_email_lookup.sql` retira ese RPC sin CASCADE después de comprobar que login y recuperación usan la Edge Function `auth-by-code`. Si hay dependencias desconocidas, PostgreSQL rechaza la eliminación. No borra perfiles ni correos.

`calendar_audit.sql` permite revisar la estructura, políticas y permisos reales antes y después de la migración. No devuelve información personal ni elimina datos. La limpieza de datos en producción requiere esa revisión; no se deben eliminar tablas por su antigüedad.

## Instalación nueva

Aplicar en este orden: `setup.sql`, `progress.sql`, `student_code_format.sql`, `student_code_year_cap.sql`, `carrera.sql`, `carrera_pucp.sql`, `features.sql`, `sync_features.sql`, `anti_spam_limits.sql`, `tool_social.sql`, `professor_tags.sql`, `professor_name_uppercase.sql`, `professor_delete_rule.sql`, `course_detail.sql`, `course_difficulty.sql`, `times_taken_max_3.sql`, `change_alias.sql`, `stats_cursos.sql`, `arcade.sql`, `logros.sql`, `admin_panel.sql`, `harden_functions.sql`. Desplegar las Edge Functions según sus instrucciones. Ejecutar `revoke_email_lookup.sql` después de verificar la autenticación.

Los scripts de instalación, salvo los que lo indican expresamente, no son idempotentes. No volver a ejecutarlos sobre tablas existentes.

## Estado de esta entrega

La migración se verificó en PostgreSQL local con datos ficticios de prueba y el frontend con fixtures de navegador. **No se aplicó a la base activa** porque, aunque `SUPABASE_DB_URL` está configurada, el proxy del entorno rechaza PostgreSQL con HTTP 403. El usuario eligió aplicar las migraciones en el SQL Editor; ejecutar primero `sync_features.sql` y después `study_groups.sql` (ver `STUDY_GROUPS_SETUP.md`). No se eliminaron registros, tablas ni funciones en producción. `harden_functions.sql` omite el permiso de `rls_auto_enable()` cuando ese helper de plantilla no existe.
