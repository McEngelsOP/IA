# Geoduelo: mantenimiento visual

## Overview

Contrato limitado a la integración de Geoduelo en **Arcade → Educativos**. La galería de `pagina.html` conserva su carrusel de portadas, cristal oscuro, filtros y muelle de juego. Dentro del iframe, Geoduelo mantiene el carácter **atlas impreso + marcador de duelo** del juego aportado: papel frío, tinta y dos identidades de jugador.

Las fuentes de verdad son `pagina.html`, `src/components/Geoduelo.jsx`, `src/components/OfficialArcadeGame.jsx` y `public/juegos/geoduelo/`. Este documento describe su implementación y no establece un sistema global. `Pagina promocional/PRODUCT.md` y `Pagina promocional/DESIGN.md` pertenecen a la landing promocional y no rigen Arcade.

## Colors

Los valores viven en las variables de `public/juegos/geoduelo/index.html`; conservar también sus equivalentes de tema oscuro.

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

**Regla de frontera.** La portada, los filtros y el botón **Jugar** usan el lenguaje vigente de Arcade. Los estilos del atlas se mantienen dentro del iframe; las adaptaciones del contenedor están limitadas a Geoduelo.

El juego distribuye marcador, escenario y muelle en tres filas, con ancho máximo de 1440px y espacio para el área segura inferior. Desde 1000px, las tarjetas de turno y respuesta se sitúan al lado derecho del globo. Hasta 999px, globo y controles ocupan filas propias, sin superposición; hasta 760px, los dos jugadores van juntos y la pregunta debajo. Hasta 520px se compactan marcador y controles. En vistas de hasta 999px de ancho y 480px de alto, el documento admite desplazamiento vertical.

Mantener la misma jerarquía al cambiar tamaños: quién juega, qué responder, dónde actuar. Los avisos de puntaje del anfitrión quedan fuera del iframe y pueden envolver o desplazarse sin aplastar el juego.

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
- **Movimiento:** respetar `prefers-reduced-motion`, incluida la rotación automática y el indicador de carga; no introducir animación decorativa continua. El render del globo se limita a 30fps y reduce resolución en dispositivos táctiles.

## Do's and Don'ts

- **Conservar** el carrusel y muelle existentes al añadir o ajustar esta portada.
- **Conservar** el globo como instrumento interactivo y los paneles como soporte de lectura.
- **Verificar** configuración, turno y resultado en escritorio, móvil estrecho y horizontal tras cambios de disposición.
- **Evitar** sustituir la portada por una captura de toda la interfaz, añadir adornos de trivia o convertir la paleta del atlas en un tema global de Arcade.
- **Evitar** duplicar instrucciones entre marcador y tarjeta, o depender solo del color para indicar el jugador.
