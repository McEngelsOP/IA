# Superficies de escritorio

Esta extensión de `pagina.html` aplica únicamente a anchos de viewport superiores a **860 px** (`min-width: 861px`). Conserva el shell existente, la navegación, los temas y las rutas móviles. La autoridad general sigue siendo [CONTEXT.md](../CONTEXT.md) y el código vigente; este documento describe las secciones implementadas, sin establecer una identidad visual nueva.

## Referencias y alcance

Los HTML entregados son referencias de su sección correspondiente; no sustituyen el resto de la aplicación.

| HTML de referencia | Secciones implementadas | Código principal |
| --- | --- | --- |
| `Buzón.html` | Buzón: Aplicativo, Docente y Universidad | `OfficialMailbox.jsx`, `mailboxTypes.js` |
| `Brújula-AsistenteIA.html` | Brújula IA y Asesor IA | `OfficialRoadmap.jsx`, `StudyAdvisor.jsx`, `OfficialBot.jsx` |
| `focus-herramientas_recursos.html` | Mod Focus y Recursos | `pagina.html`, `OfficialTools.jsx` |

Las referencias originales están en `../upload/` respecto al repositorio. Los componentes React viven en `src/components/`, los tipos del buzón en `src/data/mailboxTypes.js` y los estilos de estas superficies en `src/styles/OfficialSurfaces.css`. `OfficialIcon.jsx` concentra los SVG compartidos. `SemesterRoadmap.jsx` mantiene su vista existente y ahora exporta `projectSemesters` para reutilizar el mismo cálculo en escritorio.

## Contrato visual

Mantener los tokens y la tipografía de sistema de `pagina.html`: fondos neutros, paneles con transparencia, bordes suaves, botones y selectores redondeados, contraste invertido en selecciones y equivalencia clara/oscura. Las composiciones internas siguen cada referencia: formulario y ayuda lateral en Buzón, consulta y contexto en Asesor, pasos de diagnóstico/comparación/planificación en Brújula, configuración y reloj en Focus, lista de enlaces en Recursos. El ancho disponible del contenido puede reducir sus columnas mediante container queries sin activar una ruta móvil.

Los motivos globales de cuadrícula/franjas ya existentes y el movimiento `--spring` copiado de las referencias se conservaron como parte del diseño fijado. Respetar los overrides de movimiento reducido. No se incorporaron imágenes raster nuevas: los iconos, el bot y los compañeros se dibujan mediante SVG o código de píxeles derivado de las referencias.

## Comportamiento y datos

- **Buzón:** permite elegir destinatario, tipo, detalles, gravedad cuando corresponde, plantilla y texto de hasta 800 caracteres. Los cursos del selector provienen de la carrera cargada. El borrador es estado efímero del componente; salir de la sección o remontarlo lo descarta. La recepción no está habilitada: enviar permanece desactivado y no hay escritura, archivo, historial ni confirmación de envío.
- **Recursos:** lee `tools` mediante `select('id,name,url')`, ordenado por `created_at` descendente; descarta URLs que no sean HTTP/HTTPS. Busca por nombre o URL, permite ordenar por nombre y abre enlaces externos. Expone carga, error con reintento, vacío y búsqueda sin resultados. El formulario de publicación está desactivado; no inserta recursos ni presenta votos o popularidad inventados.
- **Asesor IA:** conserva la RPC `get_course_difficulty_stats` y la Edge Function `study-advisor`. Envía la pregunta, hasta seis mensajes previos, la carrera y los cursos del plan con sus créditos y estadísticas disponibles. La dificultad ponderada usa solo cursos con votos y sus créditos; ausencia de datos no equivale a dificultad cero. La vista incorpora sugerencias editables, contexto del plan, conversación, nuevo chat, copia y errores reales del servicio. Los mensajes solo viven en memoria.
- **Brújula IA:** usa `projectSemesters` con cursos reales, aprobados, prerrequisitos y mínimos de créditos `rc`. Compara cargas de 16/20/24 créditos y la carga habitual válida. El algoritmo proyecta hasta 30 ciclos; la vista muestra los primeros 12 y señala cursos sin ubicar. Supone oferta en cada ciclo y aprobación de lo proyectado; no representa matrícula ni garantiza fecha de egreso. Tras revisar el resumen, suma únicamente el primer ciclo a `progress.plan` mediante el `progress.upsert` existente, verifica la sesión y conserva los cursos del plan actual y `done`. Si falla, mantiene el plan anterior.
- **Mod Focus:** cambia la presentación de escritorio y conserva el modelo existente de sesiones, cursos matriculados, temporizador, pausa, continuación, finalización y resumen diario. Mantiene los identificadores persistidos de reloj `digital`, `ring`, `arc`, `dots` y de compañero `cat`, `rabbit` (Conejo), `owl`. La selección alimenta los argumentos existentes `chosen_style`/`chosen_pet` de `start_focus_session`; la sesión devuelta restaura `clock_style`/`companion`. Las preferencias iniciales conservan `clockStyle`/`companion`. El visitante puede usar el temporizador local sin guardar historial.

Esta extensión no añade tablas, RPC ni despliega Edge Functions. La disponibilidad del backend sigue dependiendo de la configuración y los despliegues existentes.

## Validación

`npm run build` pasó. `node --test tests/focusModel.test.mjs tests/setupModel.test.mjs` pasó sus **12 pruebas**. La revisión de escritorio reunió **29 capturas Playwright**: 1440 × 1000 en claro/oscuro y 1280 × 800 en oscuro, con Supabase simulado. Incluyó variantes de reloj, pausa, destinatarios del buzón, conversación/contexto, recursos vacíos y pasos de Brújula con guardado.

Las capturas y `verification.json` en `.impeccable/review/` son evidencia local de QA, no recursos de la interfaz. El registro no contiene errores, registra dos escrituras simuladas y comprueba contexto del asesor y conservación del plan. La revisión final permitió entregar sin correcciones materiales pendientes. Estas comprobaciones no acreditan acceso ni operaciones contra un backend en producción.
