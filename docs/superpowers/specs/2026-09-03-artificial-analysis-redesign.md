# Especificación de Diseño: Rediseño Estilo Artificial Analysis

**Fecha:** 2026-09-03  
**Estado:** Propuesta aprobada por el usuario  
**Alcance:** Sistema de diseño global, Header en píldoras, Sidebar de navegación estilo índice, Contenedor principal estilo Benchmark Card, Gráficos y Fichas.

---

## 1. Visión General y Objetivos
Transformar la interfaz de la Malla Curricular interactiva adoptando íntegramente el lenguaje visual moderno, editorial y analítico de **Artificial Analysis**:
- Header superior con branding en píldora, pestañas redondeadas y buscador con atajo `⌘K`.
- Sidebar lateral izquierdo tipo índice técnico con indicadores de viñeta cuadrada (`■`) para modos y filtros de áreas.
- Contenedor principal de la malla enmarcado en una tarjeta redondeada (`border-radius: 16px`, borde hairline `1px solid #e5e7eb`), cabecera editorial con `Source Serif 4` e indicadores de progreso en píldoras (`X de Y cursos · Z créditos`).
- Rediseño de `SidePanel` (Mi Panel) y `CourseDetail` (Ficha del curso) para alinear los gráficos de barras, métricas y etiquetas con la estética de benchmark de IA.
- Soporte impecable y coherente tanto en **Modo Claro** como en **Modo Oscuro**.

---

## 2. Sistema de Diseño y Tokens (CSS Variables)

### 2.1. Tipografía
- **Titulares Principales y Títulos de Secciones:** `'Source Serif 4', Georgia, serif;` (peso 600 y 700). Precedidos por el caracter cuadrado `■` para un toque analítico/editorial idéntico a la referencia.
- **Textos de Interfaz, Botones y Píldoras:** `'Inter', system-ui, -apple-system, sans-serif;` (pesos 400, 500, 600).
- **Métricas, Códigos y Datos Numéricos:** `'JetBrains Mono', monospace;` (pesos 500, 600).

### 2.2. Paleta de Colores

#### Modo Claro (Light Theme)
```css
--aa-bg: #f9fafb;             /* Fondo general de la página con grid tenue */
--aa-card: #ffffff;           /* Superficie de tarjetas y drawers */
--aa-card-subtle: #f8fafc;    /* Fondos de secciones internas */
--aa-border: #e5e7eb;         /* Borde hairline nítido */
--aa-border-strong: #cbd5e1;  /* Borde de elementos activos o interactivos */
--aa-ink: #0f172a;            /* Texto primario (carbón profundo) */
--aa-ink-muted: #64748b;      /* Texto secundario y leyendas */
--aa-ink-faint: #94a3b8;      /* Texto terciario y placeholders */

/* Acentos y Píldoras */
--aa-pill-dark-bg: #0f172a;   /* Píldoras primarias (ej. botón login, activo) */
--aa-pill-dark-text: #ffffff;
--aa-pill-neutral-bg: #f1f5f9;/* Píldoras secundarias / filtros */
--aa-pill-neutral-border: #e2e8f0;
--aa-pill-neutral-text: #334155;
--aa-accent-purple: #682057;  /* Acento especial (estilo botón Premium) */
--aa-accent-green: #059669;   /* Aprobados / Llevados */
--aa-accent-green-soft: #ecfdf5;
--aa-accent-amber: #d97706;   /* Requisitos / Alertas */
--aa-accent-blue: #2563eb;    /* Convalidados / Info */
```

#### Modo Oscuro (Dark Theme: `[data-theme='dark']`)
```css
--aa-bg: #090d13;             /* Fondo general grafito muy profundo */
--aa-card: #111622;           /* Superficie de tarjetas */
--aa-card-subtle: #161c2b;    /* Fondos secundarios */
--aa-border: #1e293b;         /* Borde fino de bajo contraste */
--aa-border-strong: #334155;
--aa-ink: #f8fafc;            /* Texto blanco suave */
--aa-ink-muted: #94a3b8;      /* Texto secundario */
--aa-ink-faint: #64748b;

/* Píldoras en oscuro */
--aa-pill-dark-bg: #ffffff;
--aa-pill-dark-text: #0f172a;
--aa-pill-neutral-bg: #1e293b;
--aa-pill-neutral-border: #334155;
--aa-pill-neutral-text: #e2e8f0;
--aa-accent-purple: #9d3f84;
--aa-accent-green: #10b981;
--aa-accent-green-soft: #064e3b33;
--aa-accent-amber: #f59e0b;
--aa-accent-blue: #3b82f6;
```

### 2.3. Radios y Sombras
- **Píldoras:** `border-radius: 9999px;` (botones de navegación, buscador, badges, switches).
- **Tarjetas y Contenedores:** `border-radius: 16px;`.
- **Nodos de la Malla:** `border-radius: 8px;` con bordes estilizados de `1.5px`.
- **Sombras:** `0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);` (prácticamente flat, confiando en bordes limpios).

---

## 3. Estructura de Componentes y Layout

```
+---------------------------------------------------------------------------------------+
| HEADER SUPERIOR: [ ❖ ESAN · Ingeniería en IA ]  [Malla] [Plan] [Calendario] [Arcade]  |
|                                     [🔍 Buscar curso ⌘K]  [Mi Panel]  [20261234] [🌙] |
+---------------------------------------------------------------------------------------+
| [SIDEBAR ÍNDICE]   | [CARD CONTENEDOR PRINCIPAL: ESTILO ARTIFICIAL ANALYSIS]         |
| ■ Vista General    | +---------------------------------------------------------------+ |
| ■ Qué abre         | | ■ Malla Curricular · Ingeniería en IA               [X de 72] | |
| ■ Qué requiere     | | Plan de estudios presencial · 200 créditos totales  [Filtros] | |
| ■ Marcar llevados  | +---------------------------------------------------------------+ |
| ■ Qué puedo llevar | | [BARRA DE ESTADO / ACCIONES / CONTADOR DE CRÉDITOS]           | |
| ■ Planificar ciclo | +---------------------------------------------------------------+ |
| -----------------  | |                                                               | |
| ■ Áreas Formativas | |   GRAFO DE CURSOS INTERACTIVO (10 CICLOS / SEMESTRES)         | |
|   ▫ Ciencias       | |   [Cálculo 1] ───> [Cálculo 2] ───> [Estadística]             | |
|   ▫ IA y ML        | |   [Prog. 1]   ───> [Prog. 2]   ───> [Deep Learning]           | |
|   ▫ Software       | |                                                               | |
| [ << Colapsar ]    | +---------------------------------------------------------------+ |
+---------------------------------------------------------------------------------------+
```

### 3.1. Header Superior (`Header` / `MallaTop`)
- **Logo / Brand Badge:** Botón o badge en forma de píldora negra: `[ ❖ {M.uni} · {M.nombre} ]`.
- **Pestañas de Navegación:** Píldoras con efecto hover sutil (`Malla`, `Planificador`, `Calendario`, `🕹 Arcade`).
- **Barra de Búsqueda:** Input encapsulado en píldora con lupa e indicador de atajo `⌘K` / `Ctrl+K`. Al presionar Enter cicla resultados con contador `1 / 4`.
- **Acciones de Usuario:**
  - Botón de cambio de carrera (en modo visitante).
  - Píldora de código de alumno (`20261234`) y botón "Mi Panel".
  - Botón de tema flotante/integrado (🌙/☀️).
  - Botón "Cerrar sesión" en píldora outline limpia.

### 3.2. Sidebar Izquierdo de Índice Técnico (`MallaSidebar`)
- Columna izquierda estilizada idéntica a la lista de índices de Artificial Analysis (`■ Intelligence`, etc.).
- **Elementos de lista:**
  - `■ Vista General`
  - `■ Modo: Qué abre`
  - `■ Modo: Qué requiere`
  - `■ Modo: Marcar llevados`
  - `■ Modo: Qué puedo llevar`
  - `■ Modo: Planificar ciclo`
  - `■ Modo: Ficha del curso` (solo con sesión)
  - Separador sutil.
  - **Filtros por Área Temática:**
    - Indicadores pequeños de color o viñetas para filtrar cursos por especialidad (Matemática, IA, Software, Negocios, etc.).
- **Comportamiento colapsable:** Botón minimalista `<<` en la parte inferior para replegarlo a un ancho mínimo (solo iconos/viñetas) en pantallas con resolución reducida, permitiendo ver el lienzo de la malla a pantalla completa.

### 3.3. Contenedor Principal (Benchmark Card de la Malla)
- Envoltura exterior tipo Card con esquinas redondeadas (`16px`) y borde hairline.
- **Cabecera interna de la Card:**
  - Título editorial en `Source Serif 4`: `■ Malla Curricular · {Carrera}`.
  - Subtítulo descriptivo: *"Malla interactiva de prerrequisitos, créditos y planificación académica"*.
  - Grupo de herramientas a la derecha:
    - Selector de métricas en píldora: `27 de 72 cursos aprobados ⇅`.
    - Píldora de créditos: `128 / 200 créd`.
    - Botones de Zoom in/out/reset en píldoras o círculos minimalistas.
- **Lienzo del Grafo:**
  - Mantiene el cálculo de layout de baricentro y curvas Bézier SVG existentes.
  - Actualiza el diseño visual de los nodos:
    - Fondo blanco puro o superficie oscura.
    - Tipografía nítida (`Source Serif 4` o `Inter` semibold para el nombre, `JetBrains Mono` para créditos y código).
    - Pastilla de créditos integrada con fondo neutro.
    - Estados visuales claros:
      - *Llevado:* Borde verde esmeralda y pastilla suave.
      - *Seleccionado:* Borde carbón profundo / acento púrpura.
      - *Cadena qué abre / requiere:* Acentos precisos.
      - *Atenuado:* Opacidad reducida elegante.

### 3.4. Paneles Laterales y Drawers (`SidePanel` y `CourseDetail`)
- **`SidePanel` (Mi Panel):**
  - Gráficos de barras SVG: Transformados para replicar la estética de los gráficos verticales de Artificial Analysis (barras estilizadas con radio en la parte superior, valores numéricos en el tope o dentro de la barra, etiquetas rotadas limpias, colores vivos y coordinados).
  - Pestañas de secciones (`Notas`, `Estadísticas`, `Logros`, `Historia`) en píldoras horizontales.
- **`CourseDetail` (Ficha del Curso):**
  - Cabecera con título en `Source Serif 4` y código del curso en badge monoespaciado.
  - Estados académicos (Aprobado, Convalidado, Matriculado, Desaprobado, Pendiente) representados en píldoras con colores de estado de alta legibilidad.
  - Lista de profesores y votos con chips minimalistas redondeados.

---

## 4. Archivos Modificados y Creados

1. **[NEW] `src/styles/design-tokens.css`**: Variables CSS globales del sistema de diseño (colores, fuentes, bordes, sombras, transiciones para tema claro y oscuro).
2. **[MODIFY] `src/index.css`**: Importar los tokens de diseño y configurar la base global del body y temas.
3. **[NEW] `src/components/MallaSidebar.jsx`**: Componente de navegación lateral tipo índice con viñetas cuadradas y filtros de áreas.
4. **[MODIFY] `src/components/MallaCurricular.jsx`**: Adaptar el contenedor principal a la estructura de Card de Artificial Analysis, incorporar el sidebar e integrar los atajos de teclado (`⌘K`).
5. **[MODIFY] `src/styles/MallaCurricular.css`**: Estilos del header en píldoras, sidebar, card principal, toolbar y nodos de la malla.
6. **[MODIFY] `src/styles/SidePanel.css`**: Estilos del panel lateral, pestañas en píldoras y gráficos tipo benchmark.
7. **[MODIFY] `src/styles/CourseDetail.css`**: Estilos de la ficha técnica del curso.

---

## 5. Plan de Verificación

- **Verificación Visual en Navegador:**
  - Carga limpia en navegador local (`http://localhost:5173`).
  - Verificación del header con logo píldora, pestañas y buscador.
  - Verificación del sidebar interactivo (cambio de modos y filtro de áreas).
  - Verificación de la tarjeta principal con título en `Source Serif 4` y badges de conteo.
  - Verificación de interacción en nodos (click para abrir cadenas, marcar llevados, planificar).
  - Alternancia entre Modo Claro y Modo Oscuro con el botón de tema.
  - Verificación en responsive (móvil y tablet).
- **Verificación de Compilación:**
  - Ejecutar `npm run build` para garantizar cero errores sintácticos, de dependencias o de empaquetado Vite.
