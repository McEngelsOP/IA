# Revisar para limpiar

Material conservado para revisión; no participa en la compilación actual de la rama `Oficial`.

| Carpeta | Contenido | Motivo |
|---|---|---|
| `src/` | 44 archivos exclusivos de la aplicación React anterior | `src/main.jsx` no está enlazado desde las entradas actuales de Vite. Incluye la malla, acceso, paneles, calendario y arcade anteriores. |
| `public/juegos/` | 20 archivos de juegos externos, con fuentes, versiones compiladas, documentación y licencias | Solo los referencia el `Arcade.jsx` anterior. El arcade de `pagina.html` tiene su implementación propia. Al salir de `public/`, dejan de publicarse automáticamente. |
| `Mallas curriculares/` | 2 planes alternativos de Industrial y Sistemas | No están seleccionados en `scripts/curriculumSources.mjs`. Se guardan para comparar planes antes de decidir su uso o eliminación. |

`inventario.json` registra cada ruta original, destino, motivo y SHA del archivo. Los movimientos conservan exactamente su contenido y estructura relativa; no representan una recomendación de borrar todo lo archivado.

## Sistema activo

Se mantienen `pagina.html`, `login.html` e `ios-android.html`, los componentes y estilos que importan, las 18 fuentes Markdown seleccionadas, los catálogos JavaScript, las pruebas, el generador, los recursos del acceso, la PWA y los scripts de base de datos. La página móvil conserva su contenido exacto.

Los Markdown son las fuentes de mantenimiento del catálogo. El navegador utiliza `src/data/carreras.js`, sus tres catálogos existentes y `src/data/curriculaEsan.js`; no carga el HTML eliminado ni procesa Markdown directamente.

## Eliminaciones verificadas

- `Malla curricular · Ingeniería en IA · ESAN.html`: prototipo independiente de una sola carrera, sin referencias en la aplicación ni en la compilación. La malla actual utiliza `OfficialCurriculum.jsx` y el catálogo compartido.
- `Malla curricular · Ingeniería en IA · ESAN_files/css2`: hoja de fuentes utilizada únicamente por ese prototipo.
- `Mallas curriculares/Malla_Ingenieria_en_Inteligencia_Artificial (1).md`: copia byte a byte del archivo canónico sin sufijo, que se conserva.

Los tres archivos siguen disponibles en el historial de Git anterior a la limpieza.

## Recuperar una parte archivada

Restaurar las rutas originales indicadas en el inventario antes de integrarla de nuevo. La aplicación React anterior comparte dependencias que siguen en `src/`; esta carpeta no es una aplicación autónoma ni una nueva entrada de Vite. Revisar sus importaciones y configurar una entrada explícita si se decide recuperarla. Las instrucciones antiguas de `CONTEXT.md` y `docs/superpowers/` sobre `App.jsx` describen esa versión histórica.
