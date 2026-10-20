# Activación del backend ESAN

Comprobada el 20 de octubre de 2026 sobre Lyra (`esuyrftsopevmbhvhwov`), desde la implementación de `aea` en `e6b24be0357761177e05c54f76c87288c0419033`. Este registro describe una activación explícita del servicio compartido; no implica una publicación del frontend ni del Worker.

| Componente | Estado observado |
| --- | --- |
| Migración | `20261020011415_esan_curriculum_versions_activation`, aplicada. |
| Catálogo | 18 revisiones ESAN; ninguna asignación inconsistente. |
| Perfiles existentes | 16 conservados: 13 ESAN reciben revisión, uno histórico externo permanece sin reasignar y dos sin carrera siguen sin asignación. |
| Datos previos | Las 26 tablas existentes conservan recuentos y huellas de contenido; la comparación excluye únicamente las dos columnas nuevas del perfil. |
| Asesor | `study-advisor` v14, ACTIVE; los seis archivos recuperados coinciden exactamente con la fuente de `aea`. |
| Autenticación | `verify_jwt=true`; POST sin credenciales devuelve 401. |
| Arranque y CORS | OPTIONS devuelve 200, cuerpo `ok` y encabezado CORS. |
| Catálogo y permisos | RLS activo; authenticated puede leer y no insertar; anon no puede leer. |
| Protecciones | Se conservan los triggers existentes del perfil y se añade `protect_curriculum_assignment`. |

La migración aplicada toma el SQL generado de `supabase/careers_catalog.sql`, conservando la restricción `carrera` existente porque ya admitía exactamente las 18 carreras ESAN y el valor histórico. Se omitieron su reemplazo y los `DROP` de política/trigger: ambos objetos eran nuevos. El resto del SQL, incluida la asignación inicial y las funciones de registro, Focus y Logros, se aplicó. El script generado sigue disponible para instalaciones sobre esquemas anteriores.

Antes de activar se compararon las funciones remotas con las propuestas y se guardó una referencia de sus definiciones. Después se comprobaron las asignaciones, permisos, RLS, triggers, historial de migraciones, archivos desplegados y conservación de datos mediante consultas de solo lectura.

Las pruebas locales relacionadas aprobaron 32 casos de catálogo, PostgreSQL y asesor/proveedores. Cubren las 18 carreras, repetición de migración, conservación histórica, candados, permisos, requisitos desconocidos y revisiones incompatibles. La comprobación HTTP remota verificó arranque y rechazo sin sesión; no se usó una cuenta de estudiante ni se consumió cuota de un proveedor para esta activación.

El diagnóstico de seguridad mantiene los mismos avisos previos, sin nuevos hallazgos: 30 RPC SECURITY DEFINER ejecutables por usuarios autenticados y protección de contraseñas filtradas deshabilitada. Su revisión es independiente de esta migración: [RPC con privilegios](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) y [protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
