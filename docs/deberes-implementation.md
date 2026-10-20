> Evidencia histórica del 13 de octubre. Las rutas, cobertura y despliegues mencionados corresponden a esa entrega; el estado vigente está en CONTEXT.md.

# Implementación de Deberes

Cambios solicitados en Deberes.docx, realizados sobre la rama Oficial. La base compartida es Lyra, de McEngelsOP's Org. Main se consultó como referencia y no se modificó.

## Funciones implementadas

- Inicio muestra el avance, los créditos completados, el ponderado y la lista alfabética de cursos matriculados. El semestre procede de la configuración inicial cuando está disponible.
- La ficha permite guardar matrícula o desaprobación, añadir profesores para la comunidad, valorar la dificultad de uno a cinco y marcar hasta tres etiquetas por profesor. Se conservan las etiquetas anteriores y sus votos.
- Focus utiliza exclusivamente cursos matriculados de la carrera, excluye los ya completados y los ordena alfabéticamente. Esta selección ya existía; ahora se puede actualizar desde la ficha.
- Recursos permite publicar nombre, enlace y comentario de hasta 25 palabras. Detecta duplicados por URL normalizada en el servidor, incluidos cambios de protocolo, www, barra final, fragmentos y parámetros de seguimiento. Solo el autor puede editar su descripción. Cada estudiante puede dar o retirar un corazón.
- Los iconos se cargan desde el favicon del sitio, de forma diferida, con un icono local de enlace como alternativa. No se agregó un servicio de scraping, una API de pago ni una librería de iconos.
- Dino Run+ y Escuadrón Galáctico se recuperaron del archivo de Oficial. Se conservan Reflejos, Memoria, Reto lógico y Quiz académico. Snake se retiró del HTML y se retiraron 27 archivos de juegos archivados o sustituidos; las copias activas de Dino y Galaxia están ahora en `src/features/arcade/`.

## Conexiones revisadas

| Información | Fuente | Apartados que la usan |
| --- | --- | --- |
| Carrera y semestre | profiles y student_setup | Malla, Inicio, configuración y herramientas académicas |
| Cursos completados y plan | progress | Malla, Inicio, Brújula y selección para el Asesor IA |
| Matrícula | course_status | Ficha, Inicio y Focus |
| Notas | grades | Ficha, ponderados, gráficos, estadísticas e historia |
| Profesores y dificultad | professors, professor_tags y course_difficulty_votes | Ficha y valoraciones que consulta el asesor |
| Horarios importados | calendar_events | Configuración inicial y calendario |
| Salas y mensajes | study_rooms, study_room_members y study_room_messages | Grupos, membresía y moderación |
| Tiempo de estudio | focus_study_sessions | Reloj, recuperación de sesiones e historial Focus |
| Recursos y corazones | tools y tool_likes | Recursos |

Calendario, buzón, grupos y juegos educativos mantienen sus funciones. No se eliminaron perfiles, avances, notas, matrícula, logros, horarios, sesiones ni conversaciones del asesor. Tampoco se eliminaron tablas antiguas por estar vacías o índices por no registrar uso.

## Base de datos y Asesor IA

- Se retiraron los permisos de escritura sobre is_admin, bloqueos, identidad y campos internos del perfil. Los campos normales conservan sus permisos y las funciones administrativas conservan sus comprobaciones de administrador.
- El envío de las salas aplica el filtro existente, registra faltas y suspende durante tres días ante tres faltas en 48 horas o una falta grave. La negativa se devuelve sin abortar el registro de moderación. El envío sin moderación está en un esquema privado y no es ejecutable por estudiantes. El RPC anterior mantiene un envoltorio compatible para clientes antiguos.
- Se fijó la ruta de búsqueda de la función de moderación y se retiró la ejecución anónima de tres funciones privilegiadas.
- Se corrigieron los 40 avisos de evaluación repetida de autenticación en políticas y se añadieron los 10 índices de apoyo señalados por el asesor de rendimiento. La consulta posterior solo mostró avisos informativos de índices sin uso registrado.
- study-advisor quedó desplegado en su versión 10 con las 19 carreras, conservando los proveedores, cuotas y moderación de la versión que estaba realmente activa. Si no se puede verificar la moderación, devuelve un error recuperable en lugar de continuar.
- El registro de nuevas puntuaciones admite Dino, Galaxia y Memoria. Los cinco registros históricos de Astro y Frogger se conservaron: la revisión automática rechazó eliminarlos por el riesgo de pérdida de datos. No se volvió a intentar su eliminación por otro medio.

## Validación y límites

- Compilación de producción completada.
- 63 pruebas existentes aprobadas, incluidas las de las 19 carreras, Focus, grupos y sesiones web.
- Pruebas SQL de integración aprobadas antes y después de aplicar la migración. Comprobaron actualización normal del perfil, rechazo de elevación de privilegios y cambios de bloqueo, duplicados, comentarios de 26 palabras, edición entre usuarios, corazones, etiquetas, dificultad, mensajes limpios y suspensión. Las cuentas y datos de prueba se revirtieron.
- Navegador con respuestas de prueba: Inicio → cambio de matrícula → Focus; dificultad, profesor y etiqueta; publicación y rechazo de duplicados; edición por el autor; corazones; límite de palabras; carga de Dino y Galaxia; ausencia de errores de JavaScript y desbordamiento horizontal. Se inspeccionaron capturas de escritorio y móvil. Estas pruebas no son una sesión de producción con un alumno real.
- Las capturas mostraron el menú de Dino recortado y Recursos sin sus estilos compartidos en móvil; ambos problemas se corrigieron en la ronda de confirmación.
- La protección de contraseñas filtradas sigue desactivada porque la organización usa Free y Supabase la ofrece desde Pro. No se cambió el plan ni se generaron costos.
- El asesor de seguridad aún muestra advertencias por funciones privilegiadas existentes que son llamadas por usuarios autenticados. Esto no significa que se haya completado una auditoría exhaustiva de todas esas funciones.

Los SQL de esta entrega deben conservarse como registro. No se deben volver a ejecutar los scripts históricos de creación de grupos o permisos de perfil sobre la base actual sin revisar las migraciones posteriores.
