# Geoduelo en Arcade

Geoduelo está disponible en `pagina.html` → perfil (o **+** en móvil) → **Arcade** → **Educativos**. Se juega entre dos personas en el mismo dispositivo. La integración amplía el carrusel vigente y conserva los demás juegos.

El [contrato de mantenimiento visual](geoduelo-design.md) documenta la frontera entre la galería de Arcade y el atlas del juego, su identidad y su comportamiento adaptable.

## Activación manual en Supabase

1. Abrir el SQL Editor del proyecto Supabase de IA.
2. Ejecutar el contenido completo de [`../supabase/geoduelo.sql`](../supabase/geoduelo.sql). Requiere el Arcade existente (`game_scores`, `profiles` y sus RPC).
3. Las dos consultas finales deben incluir `geoduelo` en `juegos_permitidos` y devolver `geoduelo_habilitado = true`.
4. Con una cuenta que tenga alias, terminar una partida y comprobar el mensaje **Puntaje guardado en la temporada actual**.

El archivo es transaccional y puede ejecutarse nuevamente. Conserva los puntajes existentes, las temporadas, RLS y los permisos actuales. `supabase/arcade.sql` también incorpora Geoduelo para instalaciones nuevas. No se aplicó ningún cambio a la base remota desde esta integración.

Antes de ejecutar el SQL se puede jugar; si el servidor rechaza `geoduelo`, el resultado queda en la sesión y se ofrece **Reintentar guardado**. Después de habilitar el ranking, ese botón permite guardar el resultado pendiente sin repetir el duelo, mientras la pantalla siga abierta.

## Cuenta y resultados

- El Jugador 1 corresponde a la cuenta abierta. Su nombre inicial usa el alias, recortado al límite de 14 caracteres del juego; los nombres se pueden editar.
- Solo se envían `g: 'geoduelo'` y el puntaje del Jugador 1 a `submit_game_score`. No se guarda el puntaje del ganador como si perteneciera a la cuenta, ni el nombre del invitado, preguntas o historial de turnos.
- El Jugador 2 es un invitado local. Su resultado aparece en el resumen del duelo.
- Sin sesión se juega normalmente y el mejor resultado solo dura mientras el juego esté abierto.
- La RPC conserva el máximo personal de la temporada, con el alias del perfil. Las configuraciones originales (modo, dificultad, rondas y tiempo) mantienen su puntuación; no se creó un ranking separado por configuración.
- El guardado verifica la cuenta con `auth.getUser()`. Los mensajes entre el juego y Arcade validan ventana de origen, origen web, versión y una sesión aleatoria; cada resultado de partida se procesa una vez.

## Archivos y funcionamiento

`public/juegos/geoduelo/index.html` conserva el motor del HTML aportado, aislado en un iframe para que sus estilos y eventos no afecten la plataforma. El documento y sus recursos se cargan solo al abrir el juego. Cerrar el juego desmonta el iframe, sus relojes, observadores y audio. No se agregaron dependencias de producción.

El globo usa D3 3.5.17 (`vendor/d3.v3.min.js`), el mapa mundial de Datamaps 0.5.9 (`world.json`) y fuentes WOFF2 locales. No depende de CDN, Google Fonts, claves de IA o llamadas a Supabase para jugar. Un mapa sin cargar muestra **Reintentar**, con tiempos de espera limitados. Las licencias y procedencia se encuentran en `public/juegos/geoduelo/vendor/`.

La portada `cover.svg` se dibuja con las coordenadas del mismo mapa; sigue la referencia aportada (Perú, dos marcadores y naranja/azul), sin incrustar la captura de toda la interfaz como imagen de tarjeta. Las cifras de la portada son ilustrativas.

Correcciones del motor original:

- **Detecta el error** premia exclusivamente la afirmación falsa.
- La pausa por visibilidad incluye los seis segundos del robo.
- El audio reanuda correctamente un contexto suspendido y sigue el silencio de Arcade en ambos sentidos.
- El resumen muestra puntos parciales y penalizaciones.
- Un doble clic en **Siguiente turno** no salta preguntas; un gesto de pellizco cancelado no se convierte en una respuesta accidental.
- En móvil, preguntas y controles ocupan filas propias y el globo conserva su centro. En ventanas muy bajas el contenido del juego se desplaza verticalmente.
- El contenedor de Arcade usa `overflow: clip` para evitar que el foco dentro del iframe desplace la cabecera o recorte el borde izquierdo; las vistas internas conservan su desplazamiento.
- El dibujo se limita a 30 fps y reduce la resolución del canvas en dispositivos táctiles; los recursos tipográficos se sirven comprimidos localmente.

## Validación

`tests/geoduelo.browser.mjs` recorre los 11 tipos de pregunta mediante controles reales, comprueba una sola respuesta válida, completa los duelos, verifica pausa/robo, silencio, caracteres especiales en nombres, filtrado del carrusel, salida y tamaños de escritorio, móvil y horizontal. Los hooks de lectura del estado se inyectan solo en las respuestas de prueba; no existen en el juego publicado.

`tests/geoduelo.integration.mjs` usa PostgreSQL local con PGlite y un servidor de prueba: aplica el SQL dos veces, comprueba recuperación de carga, atribución al Jugador 1 aunque gane el invitado, reintento del guardado, máximo por temporada, deduplicación, validación del puente y permisos SQL. No usa cuentas ni credenciales reales.

Ambos requieren Playwright; el segundo requiere PGlite. Se pueden indicar rutas instaladas con `PLAYWRIGHT_PATH` y `PGLITE_PATH`. La compilación de producción se verifica con `npm run build`.

La validación local no sustituye el paso manual de activar y comprobar el SQL en el proyecto remoto.

## Modalidad online

El selector Offline / Online conserva el modo local y permite activar los once modos y el duelo mixto entre dos cuentas, con selección de modo y dificultad por el anfitrión. Consulta [la guía de activación manual](geoduelo-online.md) para Cloudflare, SQL y Vercel. Los resultados online se guardan por el servidor en su propia tabla y no pasan por `submit_game_score`.
