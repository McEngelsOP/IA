# Reconciliación de Oficial — 2 de noviembre de 2026

Se comparó `origin/Oficial` en `38e70d0` con el borrador disponible y los materiales recuperables del trabajo anterior. `main` estaba en `d9c7ef9`; se incorporó mediante el merge `850f057`, manteniendo las implementaciones académicas de Oficial en los conflictos. No se modifica ni se publica main.

Los commits históricos del otro entorno (`af11b7f`, `1446783`, `ba42b15`, `2a3ad60`, `c44e182`, `1cefb92`) no estaban en los objetos Git ni en las referencias remotas disponibles. La recuperación integra funcionalidades y transcripciones revisadas; no es un cherry-pick ni una recuperación byte a byte de esos commits.

| Commits recientes de Oficial | Resultado de la comparación |
| --- | --- |
| `38e70d0`, `a84e689` | Se conserva la ejecución manual del SQL y la distinción entre código y servicios activados |
| `9fba843` | Se conserva afiliación ESAN verificada en servidor, cuotas unificadas y separación de claves propias |
| `d488c6f` | Se conservan sincronización, escalas, versiones, prevención del calendario y administración. Inicio añade tamaños/visibilidad a la sincronización. La opción 5 offline queda desactivada |
| `d9c7ef9` de main | Se conservan los arreglos de foco del acceso junto con la transparencia y las opciones de universidad |
| `b16b99b` y limpieza equivalente | Se mantienen separación de datos personales, JWT y documentación sin credenciales |

## Trabajo integrado

- Marca Lyra en acceso y Arcade; ESAN permanece como universidad y catálogo, según la decisión del usuario. Sin cambios en los IDs de las 18 carreras.
- Acceso transparente en escritorio y móvil; tema previo al render, preferencia persistida y contraste claro. La decoración del portal permanece oculta hasta cargar su controlador para evitar el matraz gigante durante la carga.
- Arcade desaparece del menú móvil y las entradas directas de GeoDuelo redirigen al portal. La selección de juegos React ahora carga cada juego bajo demanda. Se conserva el motor y las mejoras actuales de GeoDuelo y su Worker.
- Inicio con banner fijo, bloques pequeños/medianos/completos, arrastre, teclado, pulsación larga, animación de reacomodo, eliminación, deshacer y recuperación desde Perfil. Los bloques pequeños comparten fila y ocupan el ancho disponible. Preferencias por cuenta y nube.
- Registro externo, mallas privadas/compartidas, Markdown, validación automática por IA, cola recuperable y moderación académica por universidad. Salas aisladas, moderación del creador y apodo semanal. Restricción del Buzón y aviso previo del asistente externo.
- Se corrigieron al integrar el acceso por correo truncado, los apodos vacíos tras repetir sala, el perfil durante la recarga y el manejador del botón de recuperación que podía cerrar sesión.

## Validación y límites

La base previa a los cambios pasó 142 pruebas, cuatro del Worker y build. La integración pasa 148 pruebas, cuatro del Worker y build de producción; además, las nueve suites de navegador cubren ESAN, universidad externa, sesión, temas, personalización y navegación. La revisión independiente confirma las acciones de moderación a 1440 y 390 px, sin errores JS ni desbordamiento. Los servicios y proveedores de estas pruebas están simulados.

El SQL remoto y el despliegue de funciones requieren activación manual: ver [universidades y mallas](universities-curriculum.md). No se ejecutaron migraciones ni llamadas reales a proveedores. No se crearon cuentas externas ni se publicó una versión de producción en Vercel desde esta revisión. Un push a Oficial puede activar las automatizaciones ya configuradas en GitHub/Vercel.

La opción 5 queda pendiente: `VITE_ENABLE_OFFLINE=false`. No registra Service Worker, no guarda copias académicas offline ni muestra instalación/consulta. Se conservan los archivos para una eventual decisión de activación. Las notificaciones siguen requiriendo permiso y la app abierta; no hay push con la app cerrada.

Pendientes de operación: OCR de PDF escaneados, confirmar escalas de universidades nuevas, asignar moderadores y comprobar credenciales/despliegues reales. El PDF de exportación sigue siendo un recurso grande cargado bajo demanda; no se afirma una puntuación Lighthouse ni una mejora de red real sin medirla.

## Medición del bundle

Comparación de builds de producción contra `38e70d0`. KB decimales, gzip por archivo; el script suma solo importaciones estáticas de cada entrada. No es una medición de latencia, Core Web Vitals ni Lighthouse. Se puede repetir con `node scripts/compareBundles.mjs <dist-anterior> <dist-nuevo>`.

| Recurso | Antes gzip | Después gzip |
| --- | ---: | ---: |
| JS inicial del acceso | 65,0 KB | 65,9 KB |
| JS inicial del portal | 144,1 KB | 149,7 KB |
| CSS del portal | 30,3 KB | 31,4 KB |
| Entrada React de juegos | 19,5 KB | 1,5 KB |
| Exportación PDF bajo demanda | 330,0 KB | 330,0 KB |

La entrada de juegos se reduce un 92,1% al separar Dino, Galaxia y GeoDuelo. Los módulos se descargan al elegir el juego. El portal aumenta 5,6 KB gzip por las nuevas funciones; no se presenta como una reducción global. El importador PDF (136,0 KB gzip más su worker) se solicita al seleccionar un PDF y no se añade al Inicio móvil. Queda pendiente reducir más el catálogo inicial y la exportación PDF, y medir rendimiento en un teléfono/red reales después del despliegue.
