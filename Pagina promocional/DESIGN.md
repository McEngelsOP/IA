---
name: Lyra — Página promocional
description: Cristal cálido y paisaje de estudio para explicar un espacio académico conectado.
colors:
  bg: "#18231f"
  surface: "#24332b"
  ink: "#f5f1e5"
  muted: "#c3cabc"
  accent: "#e6db8a"
  accent-ink: "#263327"
  line: "#435348"
  accent-hover: "#f3eaa6"
  control-border: "#758675"
  outline-border: "#7d8a7c"
  field-bg: "#18251d"
  glass-base: "#d6ded721"
  glass-graph: "#17291ede"
  glass-focus: "#eae5d8e6"
  glass-agenda: "#243228dc"
  light-bg: "#ece9dd"
  light-ink: "#26352a"
  light-muted: "#52624e"
  graph-connection: "#8eac8e"
typography:
  display:
    fontFamily: "Rubik, Arial, sans-serif"
    fontSize: "clamp(54px, 5.65vw, 82px)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-.035em"
  headline:
    fontFamily: "Rubik, Arial, sans-serif"
    fontSize: "clamp(34px, 3.5vw, 52px)"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-.035em"
  title:
    fontFamily: "Rubik, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-.025em"
  body:
    fontFamily: "Rubik, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Rubik, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "Rubik, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  surface: "16px"
  scene: "24px"
  mobile-scene: "18px"
  field: "10px"
  choice: "12px"
  course-check: "6px"
  graph-node: "9px"
  pill: "100px"
spacing:
  inline-gap: "14px"
  small-gap: "12px"
  standard-gap: "24px"
  card-padding: "32px"
  heading-gap: "44px"
  section: "100px"
  section-tablet: "68px"
  section-mobile: "54px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "13px 23px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "13px 23px"
  demo-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "32px"
  field-select:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 13px"
    width: "100%"
  field-textarea:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "14px"
    width: "100%"
  tool-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "12px 22px"
  tool-tab-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
  question-choice:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.choice}"
    padding: "9px 13px"
  glass-graph:
    backgroundColor: "{colors.glass-graph}"
    rounded: "{rounded.surface}"
    padding: "24px 20px"
---

# Design System: Lyra — Página promocional

## Overview

**Creative North Star: "Cristal cálido sobre el paisaje de estudio"**

El paisaje de estudio de la aplicación sostiene paneles translúcidos, una base verde carbón y tipografía marfil. El amarillo suave orienta la mirada hacia acciones y estados relevantes; Rubik mantiene la voz continua entre títulos y herramientas.

Este sistema describe exclusivamente la página promocional. La atmósfera proviene de los materiales y la imagen existente; las demos usan superficies sólidas para leer y actuar con claridad. La documentación se extrajo de HTML, CSS y JavaScript finales: no representa una validación visual en navegador.

**Key Characteristics:**
- Paisaje existente con paneles de cristal cálido.
- Contraste oscuro, marfil y amarillo suave.
- Rubik autoalojada con títulos de peso regular.
- Herramientas locales con estados visibles y navegación por teclado.
- Composición espacial cuyo tamaño sigue al contenido.

## Colors

### Primary

El amarillo suave (`accent`) marca el CTA principal, la pestaña seleccionada, las selecciones de controles y los indicadores de foco. Su compañero oscuro (`accent-ink`) permite leer dentro de esas superficies. La variante clara (`accent-hover`) corresponde al hover del botón principal.

### Neutral

Verde carbón (`bg`) sostiene la página; verde profundo (`surface`) delimita las demos. Marfil (`ink`) corresponde a títulos y controles, y salvia clara (`muted`) a explicaciones. La línea verde (`line`) separa grupos y filas sin introducir superficies adicionales.

Los fondos de campo y sus bordes mantienen la identidad oscura. Los paneles de paisaje emplean transparencias distintas: oscuro para la malla y la agenda, marfil para Focus. La sección clara usa `light-bg`, `light-ink` y `light-muted` como conjunto, sin heredar el texto salvia de la página oscura.

**The State Color Rule.** Usa el amarillo con un estado o una acción reconocible; conserva texto, atributos y forma para que el color no sea la única señal.

## Typography

**Display Font:** Rubik, con Arial y sans-serif como fallback.
**Body Font:** la misma familia, autoalojada mediante archivos WOFF de pesos 400 y 600.

Los títulos de peso regular, interletraje cerrado y líneas equilibradas son amplios; las acciones usan semibold. Los cuerpos explicativos varían entre 12 y 18px según contexto, sobre una base de 16px. Los párrafos generales limitan el ancho a 70ch, y los relatos de herramienta a 41ch en escritorio.

### Hierarchy

El display usa la escala del frontmatter en escritorio. Se ajusta a 64px hasta 1100px, a 74px hasta 820px y a `clamp(47px,12.2vw,63px)` con interlínea 1.08 hasta 520px. Los títulos de sección usan headline; los relatos de herramienta usan title, que pasa a 28px en móvil. Las filas de funciones usan títulos menores, entre 19 y 20px.

Las etiquetas y los estados de demos se mantienen en 12px. El reloj usa números tabulares: 78px en la demo, 66px en móvil; la vista de paisaje usa 42px, 36px hasta 1100px, vuelve a 42px hasta 820px y usa 34px hasta 520px.

**The Regular Headline Rule.** Mantén los títulos en el peso 400 y reserva el 600 para acciones, marca y encabezados de respuesta.

## Layout

El contenedor se limita a 1320px con 48px por lado. Las consultas reducen los márgenes a 32px hasta 1100px, 24px hasta 820px y 18px hasta 520px. El ritmo de sección sigue los tokens de escritorio, tablet y móvil del frontmatter.

En escritorio la cabecera es horizontal, el hero usa columnas `.92fr 1.08fr` y separación de 44px, y las demos usan `.85fr 1.15fr` con separación de 80px. Hasta 820px, hero, herramientas, sección clara y FAQ pasan a una columna. Los pasos conservan tres columnas hasta 520px y después se ordenan verticalmente con el número al lado del texto.

La composición de paisaje usa una cuadrícula de dos columnas y altura determinada por contenido en todos los tamaños. La malla ocupa ambas columnas; Focus y agenda están debajo. Su altura mínima de escritorio es 640px y desaparece hasta 820px. La malla también fluye: dos cursos en la primera fila, un curso centrado en la segunda y otro en la tercera. Los nodos centrales ocupan 70% del ancho, 86% en móvil; las conexiones CSS usan un espacio vertical de 36px. El SVG posicionado anterior queda oculto.

**The Content Height Rule.** Conserva el flujo de las tarjetas y la malla: las alturas fijas y las posiciones absolutas anteriores están sobrescritas y no son el patrón vigente.

## Elevation & Depth

El paisaje, el sombreado gradual y el desenfoque aportan profundidad al hero. Las demos son sólidas; líneas y cambios tonales organizan el resto de la página.

### Shadow Vocabulary

- **Cristal ambiental:** `0 14px 36px #101c2433`, en los paneles con blur de 20px.
- **Menú móvil:** `0 15px 30px #0b120f55`, para separar la navegación desplegada.

Sin soporte de backdrop-filter, los paneles oscuros usan un fondo sólido verde; el fondo marfil más opaco de Focus se conserva por la regla final de la cascada. La animación de entrada solo funciona con `prefers-reduced-motion: no-preference`: desplazamiento vertical de 16px y opacidad de .7 a 1, con duraciones .9s, 1.1s y 1.25s para malla, Focus y agenda. Usa la curva `cubic-bezier(.16,1,.3,1)`. La preferencia de movimiento reducido elimina transiciones y animaciones y desactiva el scroll suave.

## Shapes

Las acciones y pestañas son cápsulas; las demos y paneles usan esquinas suavemente curvas. El paisaje y el cierre comparten una curva más amplia, que se reduce en móvil. Campos, opciones y nodos usan curvas menores según su función. Indicadores de estado y números de paso son circulares; los iconos son SVG de línea.

## Components

### Buttons

Cápsulas semibold de al menos 52px de alto, con separación interna de 14px cuando contienen un SVG. El principal usa amarillo sobre tinta oscura; el alternativo tiene fondo transparente y borde salvia. Hover cambia el fondo durante .2s. La variante pequeña mide al menos 44px; algunos controles de demos miden al menos 46px. El foco visible global es un contorno amarillo de 3px separado 5px. Los botones deshabilitados reducen opacidad a .55 y muestran cursor de indisponibilidad.

### Navigation

En escritorio, enlaces de 13px y separación de 30px, reducida a 18px hasta 1100px. Hasta 820px, aparece el botón Menú y la navegación se despliega verticalmente sobre una superficie verde sólida; el CTA de cabecera se oculta. Escape cierra y devuelve el foco al botón; elegir un enlace cierra el menú.

### Tabs and choices

Las pestañas se desplazan horizontalmente cuando falta espacio. La selección amarilla coincide con `aria-selected`; solo la pestaña activa entra en la secuencia de tabulación. Flechas, Home y End cambian de pestaña y foco. Las opciones de pregunta usan `aria-pressed`, borde y fondo amarillo al seleccionarse, y pasan a ancho completo en móvil.

### Cards / Containers

Las demos usan el token de tarjeta sólida, con padding de 26px hasta 1100px, 30px hasta 820px y `22px 18px` hasta 520px. El panel de malla sobre paisaje utiliza la variante de cristal oscuro; su padding vigente es `24px 20px` y `20px 14px` en móvil. Focus tiene fondo marfil más opaco para sus textos oscuros.

### Inputs / Fields

Select y textarea usan fondo verde profundo, borde salvia de 1px y radio de campo. El select ocupa todo el ancho; el textarea permite redimensionar verticalmente entre 130 y 300px. Los checks de curso tienen radio de 6px, marca gráfica y relleno amarillo al seleccionarse; su foco visible se coloca en el control visual. Los pendientes completados añaden tachado y texto atenuado. El select de Focus queda deshabilitado mientras corre el reloj.

### FAQ and demo feedback

La FAQ usa `details` y `summary`, líneas divisorias y un SVG de suma que gira 45° al abrirse. La transición dura .2s. Los créditos, el asesor y el reloj cambian texto según la acción. La organización de tareas usa un estado anunciado con `aria-live="polite"` y conserva texto literal en cada resultado. Los ejemplos son locales y no guardan información en la cuenta.

## Do's and Don'ts

### Do:
- **Do** conserva Rubik autoalojada y la relación entre títulos regulares y acciones semibold.
- **Do** usa superficies sólidas para las demos y cristal para los paneles sobre paisaje.
- **Do** mantiene las tarjetas y los nodos de la malla en flujo con conexiones CSS.
- **Do** conserva estados semánticos, foco visible y movimiento reducido.
- **Do** limita este sistema a la página promocional.

### Don't:
- **Don't** recupera las posiciones absolutas o alturas fijas sobrescritas de los paneles y nodos.
- **Don't** comunica selecciones exclusivamente mediante color.
- **Don't** añade nuevas familias tipográficas para controles o etiquetas.
- **Don't** presenta esta extracción de fuentes como una revisión visual en navegador.
