# Geoduelo: mantenimiento visual

## Overview

Contrato limitado a la integración de Geoduelo en **Arcade → Educativos**. La galería de `pagina.html` conserva su carrusel de portadas, cristal oscuro, filtros y muelle de juego. Dentro del iframe, Geoduelo mantiene el carácter **atlas impreso + marcador de duelo** del juego aportado: papel frío, tinta y dos identidades de jugador.

Las fuentes de verdad son `pagina.html`, `src/components/Geoduelo.jsx`, `src/components/GeodueloOnline.jsx`, `src/components/GeodueloGlobe.jsx`, `src/components/geoduelo-online.css`, `src/components/OfficialArcadeGame.jsx` y `public/juegos/geoduelo/`. Este documento describe su implementación y no establece un sistema global. `Pagina promocional/PRODUCT.md` y `Pagina promocional/DESIGN.md` pertenecen a la landing promocional y no rigen Arcade.

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

## Layout

**Regla de frontera.** La portada, los filtros y el botón **Jugar** usan el lenguaje vigente de Arcade. Los estilos del atlas se mantienen dentro del iframe local y en la superficie Online acotada; las adaptaciones del contenedor están limitadas a Geoduelo. La barra Offline/Online pertenece al contenedor y conserva la selección visible mediante `aria-pressed`; indica si se juega en una o dos máquinas. Offline continúa cargando el juego local completo en su iframe.

El juego distribuye marcador, escenario y muelle en tres filas, con ancho máximo de 1440px y espacio para el área segura inferior. Desde 1000px, las tarjetas de turno y respuesta se sitúan al lado derecho del globo. Hasta 999px, globo y controles ocupan filas propias, sin superposición; hasta 760px, los dos jugadores van juntos y la pregunta debajo. Hasta 520px se compactan marcador y controles. En vistas de hasta 999px de ancho y 480px de alto, el documento admite desplazamiento vertical.

Mantener la misma jerarquía al cambiar tamaños: quién juega, qué responder, dónde actuar. Los avisos de puntaje del anfitrión quedan fuera del iframe y pueden envolver o desplazarse sin aplastar el juego.

Online dispone el lobby en dos columnas: portada existente y acciones, con búsqueda pública como acción principal y sala privada separada por una línea. La partida limita la lectura a 900px y mantiene ambos jugadores en dos columnas. La configuración agrupa modo y dificultad en campos flexibles con etiquetas visibles. Las preguntas con mapa sitúan globo y respuesta en dos columnas; el iframe mide 390px de alto y las opciones contiguas forman una sola columna. Las preguntas sin mapa presentan las opciones en dos columnas. Hasta 650px, portada, lobby, mapa y respuestas se apilan; el iframe pasa a 320px. El panel admite desplazamiento interno y la barra puede envolver su texto sin ocultar controles. Mantener la disposición Online propia, sin trasladar el muelle del juego local.

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
- **Duelo Online:** diez rondas simultáneas de 25 segundos. Modo y número de ronda comparten la misma línea de metadatos, con el reloj al otro extremo; la pregunta mantiene el protagonismo. El marcador conserva círculo naranja y rombo azul, nombre y puntaje, además de «(tú)» para la cuenta propia. La selección usa tinta; el acierto en opciones usa verde y el texto «Correcta». Mantener estados de envío, espera y respuesta recibida, sin depender solo del color.
- **Respuestas Online:** las opciones se envían al elegir. Ubicación permite marcar antes de **Confirmar ubicación**; distancia usa un campo etiquetado en kilómetros y **Confirmar distancia**; ordenar numera los países elegidos, permite **Deshacer último** y exige completar la lista antes de **Confirmar orden**. Tras enviar, bloquear nuevas respuestas; la solución se muestra en la revelación.
- **Globo Online:** reutiliza mapa, papel y tipografía del atlas dentro de `online-map.html`, integrado mediante `GeodueloGlobe.jsx`. Arrastrar gira; pulsar marca; flechas giran, +/− acercan y alejan, y Enter o **Marcar centro** seleccionan el centro. Conservar controles de 44px, foco visible, instrucciones y estados **Cargando globo…** / **Reintentar mapa**. La marca propia tiene etiqueta y la respuesta revelada aparece en verde; el globo sigue siendo instrumento de respuesta o referencia según la pregunta.
- **Estados Online:** activación pendiente, sesión requerida, búsqueda pública, sala privada, confirmación de ambos, pregunta, revelación, resultado, sala vencida y reconexión comparten papel y tinta. Conexión y acción de cancelar/abandonar quedan en el pie; errores usan aviso con `role="alert"`. El reloj continúa fuera de la pestaña: no trasladar la pausa local a Online. Activación y persistencia se documentan en [la guía online](geoduelo-online.md).
- **Controles Online:** botones, campos y selectores tienen al menos 46px de altura; respuestas, 64px en escritorio y 52px en móvil. Conservar foco visible de 3px con separación de 3px, etiquetas y estados deshabilitados. Estos valores son propios de Online; no sustituyen los controles del iframe.
- **Movimiento:** respetar `prefers-reduced-motion`, incluida la rotación automática y el indicador de carga; no introducir animación decorativa continua. El render del globo local se limita a 30fps y reduce resolución en dispositivos táctiles. El globo Online dibuja solo cuando cambia y la pestaña está visible, con límite aproximado de 30fps y densidad máxima de 1.5; no gira automáticamente.

## Do's and Don'ts

- **Conservar** el carrusel y muelle existentes al añadir o ajustar esta portada.
- **Conservar** el globo como instrumento interactivo y los paneles como soporte de lectura.
- **Verificar** configuración, turno y resultado local en escritorio, móvil estrecho y horizontal tras cambios de disposición. Para Online, comprobar lobby, configuración de ambos puestos, reinicio de confirmaciones, marcador, respuestas largas, ubicación, distancia, orden, código, reconexión y resultado en escritorio y móvil. Las capturas de referencia de la extensión de modos son `.impeccable/review/modes-setup-{desktop,mobile}.png` y `.impeccable/review/modes-globe-{desktop,mobile}.png`; las pruebas funcionales se describen en [la guía online](geoduelo-online.md).
- **Evitar** sustituir la portada por una captura de toda la interfaz, añadir adornos de trivia o convertir la paleta del atlas en un tema global de Arcade.
- **Evitar** duplicar instrucciones entre marcador y tarjeta, o depender solo del color para indicar el jugador.
