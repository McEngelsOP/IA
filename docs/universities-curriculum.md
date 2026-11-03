# Universidades, mallas e IA integrada

La interfaz y las migraciones están preparadas en `Oficial`. Esto no afirma que el SQL o las funciones estén activados en el proyecto remoto. El SQL de Supabase lo ejecuta el usuario; publicar GitHub no cambia la base de datos ni los secretos.

## Registro y restricciones

ESAN conserva sus 18 carreras, cursos e identificadores. El registro exige ocho dígitos con prefijo desde 20 hasta el año actual de Lima (26 en 2026) y correo `@ue.edu.pe`. La confirmación de correo y las reglas de afiliación protegidas de `ai_access_policy.sql` siguen siendo necesarias: escribir ESAN no habilita por sí solo la IA compartida.

Otra universidad utiliza correo, universidad y carrera, sin mostrar las carreras ESAN. La búsqueda devuelve únicamente universidades aprobadas. Un nombre nuevo crea una propuesta privada; el alumno puede usar su borrador. Las cuentas externas acceden por correo y contraseña. Seleccionar ESAN con otro nombre no evita sus validaciones.

Las salas se limitan en SQL a la institución del perfil. Su creador puede eliminar mensajes, vaciar la conversación y expulsar participantes; la expulsión impide volver con la misma invitación. Las acciones requieren confirmación. El apodo global admite un cambio cada siete días y se propaga a salas. El Buzón externo admite únicamente Aplicativo, también en el endpoint del servidor.

La validación de mallas usa los proveedores integrados para cualquier universidad. El asistente, las tareas y el horario siguen la política central de IA: una cuenta externa necesita su propia clave y recibe el aviso antes de escribir. Las claves integradas no sirven como respaldo del asistente externo. La escala inicial externa 0–20 es provisional; el administrador debe confirmar/configurar su regla institucional, sin atribuirle carácter oficial.

## Importación y decisiones

PDF con texto (hasta 60 páginas), XLSX (hasta 20 hojas), Markdown y texto se procesan en el dispositivo, con límite de 8 MB y 180 000 caracteres. PDF y Excel se cargan al solicitarlos. La extracción de tablas es conservadora: las filas dudosas se revisan o completan antes de guardar. Los PDF escaneados requieren OCR previo; no se contrató un servicio OCR. El texto, la fuente declarada, las filas y un Markdown canónico se guardan por propietario. No se descarga automáticamente el enlace institucional.

Una cola con leases, hash e idempotencia coordina solicitudes y reintentos. Dos proveedores independientes analizan la correspondencia entre fuente y filas. El tercero interviene si no hay conclusión. No se necesitan tres claves del alumno ni crear otro servicio de IA; se reutilizan Gemini, Groq y OpenRouter configurados en el servidor.

| Resultado | Comportamiento |
| --- | --- |
| Dos análisis coherentes, confianza ≥0,85 y ningún hallazgo | Aprobar y compartir con la universidad |
| Análisis coincidentes de documento ajeno, confianza ≥0,90 | Rechazar el documento |
| Pocos errores o advertencias | Pedir correcciones; conservar el borrador privado |
| Desacuerdo, cinco o más errores, proveedor fallido, falta de fuente o análisis incompleto | Derivar a moderación académica |

La IA no certifica autenticidad, vigencia ni aprobación oficial de una universidad. Sus respuestas son evidencia: no ejecutan SQL ni deciden permisos. El servidor valida JSON, límites y estructura; mantiene cuotas de tres envíos por alumno/24 h, cinco minutos entre envíos, cien envíos de plataforma/24 h, y límites por proveedor, además de las cuotas compartidas existentes.

Al aprobar se crea el catálogo inicial versionado con IDs estables. El alumno puede adoptar una malla aprobada de su institución, sin leer el texto privado de otro alumno. Las correcciones posteriores conservan códigos y orden si ya hay progreso. Las actualizaciones de versiones usan las equivalencias y confirmaciones existentes.

## Activación manual de Supabase

Primero comprobar las migraciones ya instaladas y conservar un respaldo. No ejecutar los scripts históricos de registro ESAN después de estas migraciones, porque reemplazan `handle_new_user` con reglas anteriores.

1. Tener instalados el esquema actual, `careers_catalog.sql`, `initial_setup.sql`, `study_groups.sql`, `system_complete.sql`, `system_catalog_seed.sql`, `personal_ai_keys.sql` y `ai_access_policy.sql`, siguiendo sus dependencias existentes. No reinstalar indiscriminadamente una base en producción.
2. Ejecutar una vez, en orden, `migrations/202611020001_home_layout_sync.sql`, `202611020002_universities.sql`, `202611020003_curriculum_analysis.sql` y `202611020004_rooms_alias.sql`. Son migraciones nuevas, no scripts para repetir. Las pruebas ejecutan sus políticas y triggers en PostgreSQL local.
3. Desplegar `auth-by-code` y las funciones de IA de la rama cuando esté instalado el SQL. El asesor nuevo lee los campos de universidad y la malla privada con el JWT del propietario. Mantener `ADVISOR_VERSIONED_CURRICULA=true` solo tras activar las versiones.
4. Desplegar la función nueva: `supabase functions deploy curriculum-analysis --no-verify-jwt`. La función verifica por sí misma JWT/propietario o el secreto del worker. No usar este indicador para otras funciones sin seguir su guía.
5. Configurar secretos de servidor: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, opcionalmente sus variables `_MODEL`, y `CURRICULUM_WORKER_SECRET` aleatorio de al menos 32 caracteres. Supabase proporciona URL, anon y service role a la función. Ningún secreto lleva prefijo `VITE_`.
6. Para procesar la cola aunque el alumno cierre la app, habilitar pg_cron/pg_net y crear en Vault `lyra_supabase_url` y `lyra_curriculum_worker_secret`; este último debe coincidir con el secreto de la función. Ejecutar `202611020005_curriculum_worker.sql` una vez. Procesa un envío por minuto y recupera leases vencidos. Si no se activa, el botón de análisis puede procesar el envío, pero la cola no tiene recuperación autónoma garantizada.
7. Desde Administración, un administrador existente asigna permiso `academic` para cada institución. Mi perfil → Abrir moderación de mallas muestra los casos inconclusos; RLS y la RPC vuelven a verificar el alcance institucional. No se creó una segunda tabla de roles.

Consultas de comprobación, desde una sesión administrativa autorizada:

```sql
select id, name, status from public.universities order by name;
select validation_state, count(*) from public.custom_curricula group by validation_state;
select status, count(*), max(attempts) from public.curriculum_analysis_jobs group by status;
select provider, last_status, day_count, retry_until from public.curriculum_provider_limits;
select jobname, schedule, active from cron.job where jobname = 'lyra-curriculum-analysis';
```

Antes de abrir el registro externo en producción: probar dos universidades distintas, revisión por un moderador de cada alcance, un documento rechazado, una aprobación automática y un fallo de proveedor. Las pruebas locales no consumen claves reales ni comprueban las credenciales de producción.
