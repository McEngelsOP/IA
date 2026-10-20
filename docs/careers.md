# Carreras ESAN y revisiones curriculares

El registro y las cuentas sin carrera comparten `src/institutions/esan/careerOptions.js`. Están disponibles las 18 carreras ESAN del catálogo, ordenadas alfabéticamente. Mecatrónica PUCP se retiró de las opciones y del asesor; sus registros históricos se conservan.

## Catálogo activo

| Carrera ESAN | Clave | Cursos | Créditos |
|---|---|---:|---:|
| Administración | administracion | 69 | 200 |
| Administración y Finanzas | administracion-finanzas | 73 | 215 |
| Administración y Marketing | administracion-marketing | 72 | 212 |
| Administración y Negocios Internacionales | administracion-negocios-internacionales | 74 | 215 |
| Comunicación Empresarial y Marketing Digital | marketing | 75 | 215 |
| Contabilidad | contabilidad | 68 | 200 |
| Derecho | derecho | 71 | 202 |
| Derecho Corporativo | derecho-corporativo | 87 | 251 |
| Economía | economia | 67 | 200 |
| Economía y Finanzas | economia-finanzas | 72 | 220 |
| Economía y Negocios Internacionales | economia-negocios-internacionales | 72 | 220 |
| Ingeniería Ambiental | ambiental | 66 | 200 |
| Ingeniería de Software | software | 69 | 200 |
| Ingeniería de Tecnologías de Información y Sistemas | sistemas | 78 | 213 |
| Ingeniería en Ciencia de Datos | ciencia-datos | 66 | 200 |
| Ingeniería en Inteligencia Artificial | ia | 69 | 200 |
| Ingeniería Industrial y Comercial | industrial | 77 | 215 |
| Psicología | psicologia | 82 | 225 |

## Fuentes y generación

Los 18 Markdown activos están en `data/catalogs/esan/sources/`, seleccionados por `scripts/curriculumSources.mjs`. No fusionar documentos de planes diferentes. El generador comprueba créditos, referencias y requisitos; las erratas normalizadas no crean requisitos nuevos.

```bash
node scripts/generateCurricula.mjs
node scripts/generateCurricula.mjs --check
```

Las salidas incluyen índices del navegador, catálogo del asesor, SQL y snapshots inmutables. No editar a mano ni renombrar los IDs de cursos existentes. La revisión combina la fuente y los datos curriculares normalizados. Su identificador no equivale a un nombre o año oficial del plan.

Los electivos sin requisitos definidos mantienen una nota de verificación. No se habilitan ni programan automáticamente como cursos sin requisitos. La oferta real de secciones de cada semestre se revisa por separado.

## Asignación persistente

`supabase/careers_catalog.sql` registra versiones y añade institución/revisión al perfil. Asigna la revisión actual únicamente a perfiles que aún no tienen una; no reasigna alumnos al regenerar. Una nueva revisión exige conservar sus snapshots anteriores. La carrera y versión no pueden cambiarse desde el cliente una vez asignadas.

La cuenta histórica externa a ESAN no se elimina ni convierte. La interfaz ofrece exportar su registro académico. La migración impide nuevos registros y asignaciones de esa carrera, conservando el valor histórico en la restricción del perfil.

## Activación

La migración y `study-advisor` están preparadas en `aea`; no se aplican automáticamente en producción. Para activar esta versión en un entorno conectado, ejecutar solo `supabase/careers_catalog.sql` y desplegar la función `study-advisor` de la misma revisión. No volver a ejecutar todos los scripts de configuración históricos.

La interfaz admite el esquema anterior mientras se prepara la activación. Hasta aplicar el SQL, perfiles sin asignación usan el catálogo activo y el servidor anterior conserva sus propias reglas de registro. Un preview que apunte a producción no aísla los servicios remotos.

## Comprobaciones

`npm run check` valida catálogo, snapshots, requisitos, reglas, migración repetible, conservación de registros, candados, Focus y Logros. `npm run test:browser` comprueba las 18 mallas, navegación, semestre, planificación, errores y exportación con servicios simulados.
