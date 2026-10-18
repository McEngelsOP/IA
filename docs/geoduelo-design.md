# Geoduelo: mantenimiento visual

## Overview

Contrato limitado a la integración de Geoduelo en **Arcade → Educativos**. La galería de `pagina.html` conserva su carrusel de portadas, cristal oscuro, filtros y muelle de juego. Dentro del iframe, Geoduelo mantiene el carácter **atlas impreso + marcador de duelo** del juego aportado: papel frío, tinta y dos identidades de jugador.

Las fuentes de verdad son `pagina.html`, `src/components/Geoduelo.jsx`, `src/components/GeodueloOnline.jsx`, `src/components/GeodueloGlobe.jsx`, `src/components/useGeodueloFullscreen.js`, `src/components/geoduelo-online.css`, `src/components/OfficialArcadeGame.jsx` y `public/juegos/geoduelo/`. Este documento describe su implementación y no establece un sistema global. `Pagina promocional/PRODUCT.md` y `Pagina promocional/DESIGN.md` pertenecen a la landing promocional y no rigen Arcade.

Offline y Online comparten una interfaz de atlas: jugador y pregunta, globo y acción, resultado y conexión. Online adapta el marcador, el escenario y el pie a rondas simultáneas, conservando el canvas y la identidad local; esta adaptación de presentación no redefine el protocolo ni las reglas del servidor.

## Colors

Los valores del juego local viven en las variables de `public/juegos/geoduelo/index.html`; conservar también sus equivalentes de tema oscuro. Online reutiliza el papel frío y la tinta en su hoja de estilos acotada; actualmente ofrece tema claro, con barra de modo oscura. Sus puntajes y marcas usan naranja `#A84008` y azul `#175B9F`, variantes más oscuras de las identidades para mantener contraste sobre papel.

| Función | Tema claro | Tema oscuro |
| --- | --- | --- |
| Papel / panel / panel secundario | `#E9EEF2` / `#FBFCFD` / `#DEE7EE` | `#07121C` / `#0D1B28` / `#15293A` |
| Tinta / texto secundario | `#0C1A26` / `#3E5265` | `#E8F0F7` / `#A6B8C8` |
| Jugador 1 | `#C24E0A` | `#FF8A3D` |
| Jugador 2 | `#1D6EC2` | `#5CB1FF` |
| Error o riesgo / acierto | `#B4301F` / `#15754A` | `#FF6B57` / `#4FD08F` |

**Regla de identidad.** Naranja y círculo identifican al Jugador 1; azul y rombo, al Jugador 2. Conservar texto y forma junto al color. La tarjeta inactiva mantiene opacidad completa y usa el panel secundario; el borde y la puntuación destacan el turno activo.

## Typography

Archivo expandida sirve a titulares y puntuaciones (peso 800, expansión 118%); Hanken Grotesk al texto (base 15px/1.45); DM Mono a datos, atajos y etiquetas funcionales. Las tres familias se sirven localmente desde `fonts.css`.

La pregunta usa una escala adaptable de 1.35–2.15rem en escritorio y 1.1rem en móvil estrecho. Las puntuaciones pasan de 2.1rem a 1.5rem; conservar números tabulares y nombres que puedan truncarse sin romper el marcador. Los campos de nombre usan 16px para evitar ampliación automática en móvil.

En Online, la pregunta central usa Archivo 800 de 20–30px y pasa a 21px hasta 760px; en horizontal bajo, 18px. Las puntuaciones usan 25–34px y 26px en móvil. Metadatos de ronda y reloj usan DM Mono 12px, con números tabulares; los nombres se truncan sin ocultar la puntuación.

## Layout

**Regla de frontera.** La portada, los filtros y el botón **Jugar** usan el lenguaje vigente de Arcade. Los estilos del atlas se mantienen dentro del iframe local y en la superficie Online acotada; las adaptaciones del contenedor están limitadas a Geoduelo. La barra Offline/Online pertenece al contenedor y conserva la selección visible mediante `aria-pressed`; indica si se juega en una o dos máquinas. Offline continúa cargando el juego local completo en su iframe.

El juego distribuye marcador, escenario y muelle en tres filas, con ancho máximo de 1440px y espacio para el área segura inferior. Desde 1000px, las tarjetas de turno y respuesta se sitúan al lado derecho del globo. Hasta 999px, globo y controles ocupan filas propias, sin superposición; hasta 760px, los dos jugadores van juntos y la pregunta debajo. Hasta 520px se compactan marcador y controles. En vistas de hasta 999px de ancho y 480px de alto, el documento admite desplazamiento vertical.

Mantener la misma jerarquía al cambiar tamaños: quién juega, qué responder, dónde actuar. Los avisos de puntaje del anfitrión quedan fuera del iframe y pueden envolver o desplazarse sin aplastar el juego.

Online dispone el lobby en dos columnas: portada existente y acciones, con búsqueda pública como acción principal y sala privada separada por una línea. La partida usa el ancho disponible hasta 1440px y organiza marcador, escenario y pie en una columna flexible. En escritorio, los jugadores flanquean la pregunta central; todas las preguntas conservan el globo como instrumento o referencia, junto a un panel de respuesta de 260–340px con opciones en una columna. La partida tiene un mínimo de 500px de alto y el escenario aprovecha la altura restante; el panel de respuesta admite desplazamiento interno. La configuración mantiene etiquetas visibles, campos en proporción 2:1 y lectura acotada.

Hasta 999px, globo y respuesta ocupan filas separadas; el mapa mide `clamp(200px, 32cqh, 360px)` y las opciones pasan a dos columnas. La partida crece con el contenido y desplaza la superficie Online para mantener accesibles respuestas y pie. Hasta 760px, ambos jugadores van juntos con la pregunta debajo; lobby y configuración se apilan y la portada se reduce a 100px. En vistas de hasta 999px de ancho y 500px de alto, el mapa mide 240px, la pregunta vuelve entre los jugadores y la portada del lobby se oculta. Conservar la prioridad del globo y sus controles sin superponerles el formulario.

La barra Offline/Online permanece encima de ambas superficies e incluye **Pantalla completa** a la derecha. Hasta 760px se ocultan la explicación del modo y el texto del botón de pantalla completa, conservando su icono y nombre accesible en un control de 44px. La vista ampliada ocupa `100dvh`, elimina el borde y el radio del contenedor y respeta las cuatro áreas seguras. El pie Online conserva conexión, confirmación y salida; en móvil puede envolver sus controles y colocar la confirmación junto a la salida debajo del estado.

## Elevation & Depth

El globo ortográfico de canvas es la pieza espacial: geometría real, luz direccional, limbo y atmósfera. Los paneles siguen siendo editoriales, con bordes finos y sombras suaves de apoyo. El sombreado del globo y el cristal de la galería tienen funciones distintas; no extender sus efectos a cada control.

## Shapes

El juego reutiliza radios de 10, 14, 20 y 26px para controles, tarjetas y hojas. Bordes de 1px separan superficies. Círculo y rombo son formas informativas persistentes de los jugadores.

## Components

- **Portada:** `cover.svg` es una ilustración autónoma de 280 × 292, con el mismo mapa ortográfico, Perú y ambos marcadores. Los puntajes 120/95 son ilustrativos. Conservar su lectura al reducirla a la miniatura del muelle.
- **Marcador:** ambos nombres y puntajes permanecen legibles; el jugador que espera sigue visible. Evitar atenuar la tarjeta completa.
- **Turno:** una decisión principal por fase; las acciones aparecen cuando corresponden. El riesgo se elige antes de mostrar la pregunta.
- **Controles:** botones principales de al menos 44px de altura, zoom de 40 × 40px, iconos SVG de 18px y nombres accesibles. Mantener foco visible de 2px y operación por teclado.
- **Estados:** carga, error con **Reintentar**, pausa, robo, resultado y resumen final conservan las mismas superficies y jerarquía. El guardado y su reintento pertenecen al anfitrión, según [la guía operativa](geoduelo.md).
- **Lobby Online:** reutilizar `cover.svg` y la jerarquía Archivo / Hanken Grotesk / DM Mono. **Buscar rival** es la acción principal; **Crear sala privada** y el formulario de código tienen menor énfasis. El código usa ocho caracteres y tipografía monoespaciada; conservar etiqueta visible, copia con confirmación y alternativa manual ante error.
- **Configuración Online:** once modos y Duelo mixto, agrupados en Ubicar, Elegir, Calcular y Todos; dificultad Fácil, Media o Difícil. El anfitrión se elige al azar en búsqueda pública y es quien crea la sala privada. Ambos ven los selectores; solo el anfitrión puede editarlos. Cada cambio reinicia las confirmaciones y **Estoy listo** confirma la revisión vigente. Conservar el texto que explica quién elige y por qué hay que confirmar de nuevo.
- **Duelo Online:** diez rondas simultáneas de 25 segundos. Modo y número de ronda comparten la misma línea de metadatos, con el reloj al otro extremo y una barra de tiempo bajo la pregunta. El marcador conserva círculo naranja y rombo azul, nombre y puntaje, además de «Tú» o «Rival» y «Pensando…» / «Respondió»; la tarjeta respondida usa el panel secundario sin perder opacidad. La selección usa tinta; el acierto en opciones usa verde y el texto «Correcta». La franja bajo el escenario muestra envío, espera o solución y cuenta atrás, con `role="status"`.
- **Respuestas Online:** las opciones se envían al elegir. Ubicación permite marcar antes de **Confirmar ubicación**; distancia usa un campo etiquetado en kilómetros y **Confirmar distancia**; ordenar numera los países elegidos, permite **Deshacer último** y exige completar la lista antes de **Confirmar orden**. Tras enviar, bloquear nuevas respuestas; la solución se muestra en la revelación.
- **Globo Online:** reutiliza mapa, papel y tipografía del atlas dentro de `online-map.html`, integrado mediante `GeodueloGlobe.jsx`. La retícula plana, el sombreado direccional y el limbo conservan la lectura de atlas. Arrastrar gira; pellizcar o usar la rueda cambia el zoom; pulsar marca en preguntas interactivas. Flechas giran, +/− acercan y alejan, y Enter o **Marcar centro** seleccionan el centro. Conservar controles de 44px, iconos SVG, foco visible y estados **Cargando globo…** / **Reintentar mapa**. La instrucción visible del pie se oculta hasta 480px, pero el canvas conserva su nombre accesible con instrucciones de teclado. La marca propia tiene etiqueta y la respuesta revelada aparece en verde; **Marcar centro** solo aparece cuando se puede responder sobre el mapa.
- **Estados Online:** activación pendiente, sesión requerida, búsqueda pública, sala privada, confirmación de ambos, pregunta, revelación, resultado, sala vencida y reconexión comparten papel y tinta. Conexión y acción de cancelar/abandonar quedan en el pie; errores usan aviso con `role="alert"`. El reloj continúa fuera de la pestaña: no trasladar la pausa local a Online. Activación y persistencia se documentan en [la guía online](geoduelo-online.md).
- **Controles Online:** botones, campos y selectores tienen al menos 44px de altura; respuestas, 52px en escritorio y 48px hasta 999px. Conservar foco visible de 3px con separación de 2px, etiquetas y estados deshabilitados legibles. Estos valores son propios de Online; no sustituyen los controles del iframe.
- **Pantalla completa:** el mismo botón permite entrar y salir en ambos modos, actualiza `aria-pressed` y su nombre accesible y conserva el juego montado para no reiniciar la partida ni reconectar la sala. `useGeodueloFullscreen.js` usa la API nativa y, si no está disponible o falla, una vista fija inmersiva. La alternativa bloquea el desplazamiento del documento y vuelve inertes las superficies externas; al salir restaura ambos. Escape funciona también desde los iframes y el foco regresa al botón; el contenedor gestiona el recorrido de Tab en sus extremos.
- **Movimiento y render:** respetar `prefers-reduced-motion`, incluida la rotación automática y el indicador de carga local; Online elimina las transiciones de sus botones. El render del globo local se limita a 30fps y reduce resolución en dispositivos táctiles. El globo Online no gira automáticamente ni programa fotogramas en reposo: agrupa invalidaciones en un único `requestAnimationFrame`, cancela el pendiente al ocultar la pestaña y redibuja al volver. No tiene un límite propio de 30fps. `ResizeObserver` ajusta el canvas al tamaño real con densidad máxima de 1.5; el componente del globo y la configuración están memorizados para evitar actualizaciones por cada tic del reloj.

## Do's and Don'ts

- **Conservar** el carrusel y muelle existentes al añadir o ajustar esta portada.
- **Conservar** el globo como instrumento interactivo y los paneles como soporte de lectura.
- **Verificar** configuración, turno y resultado local en escritorio, móvil estrecho y horizontal tras cambios de disposición. Para Online, comprobar lobby, configuración de ambos puestos, reinicio de confirmaciones, marcador, respuestas largas, ubicación, distancia, orden, código, reconexión y resultado en escritorio y móvil. Comprobar entrada y salida de pantalla completa en ambos modos, alternativa inmersiva, Escape desde el mapa, retorno de foco y desplazamiento hasta el pie en móvil. Las capturas de referencia de la extensión de modos son `.impeccable/review/modes-setup-{desktop,mobile}.png` y `.impeccable/review/modes-globe-{desktop,mobile}.png`; las pruebas funcionales se describen en [la guía online](geoduelo-online.md).
- **Evitar** sustituir la portada por una captura de toda la interfaz, añadir adornos de trivia o convertir la paleta del atlas en un tema global de Arcade.
- **Evitar** duplicar instrucciones entre marcador y tarjeta, o depender solo del color para indicar el jugador.
