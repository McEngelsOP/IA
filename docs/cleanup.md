# Limpieza de la reestructuración ESAN

Trabajo en `aea`, 19 de octubre de 2026. Se incorpora la limpieza revisada de `main`. El historial de Git conserva el material retirado.

| Elemento | Decisión |
| --- | --- |
| `Revisar para limpiar/` y configuración antigua de plugins/submódulos | Incorporar su retirada ya revisada en `main`. |
| Carpetas antiguas `src/components`, `lib`, `styles`, `data`, `assets` | Reubicar por responsabilidad y actualizar consumidores, sin copias. |
| `Mallas curriculares/` | Mover las 18 fuentes activas a `data/catalogs/esan/sources/`. |
| Catálogo PUCP | Retirar de oferta, grafos y asesor; conservar registros y exportación de la cuenta histórica. |
| `supabase/carrera_pucp.sql` | Conservar solo en `supabase/history/` para referencia/restauración. |
| Modal `SemesterRoadmap` y CSS | Eliminar la superficie sin consumidores; usar una planificación única. |
| Maqueta `ios-android.html` | Sustituir por una redirección al portal responsive. |
| Importador del onboarding y ejemplo CSV | Retirar la entrada duplicada; validar borradores anteriores; importar Excel en Mi semestre. |
| Video raíz `270983.mp4` | Retirar: acceso utiliza los recursos de paisaje de `public/`. |
| `docs/superpowers/` | Retirar plan y especificación de una implementación descartada. |
| Lockfile aislado del Worker | Consolidar en el lockfile del workspace raíz; dependencias de pruebas declaradas explícitamente. |
| JSON auxiliar de generación de imagen de landing | Retirar metadatos sin uso; conservar el WebP. |

Se mantienen licencias de terceros, pruebas útiles, recursos activos, Worker y SQL de restauración. Una revisión curricular publicada no es descartable: puede estar asignada a un estudiante.
