# Rediseño Estilo Artificial Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar visualmente toda la aplicación de la Malla Curricular adaptándola al lenguaje estético y analítico de *Artificial Analysis* (header en píldoras, sidebar tipo índice con viñetas `■`, contenedor principal estilo Benchmark Card, tipografía Source Serif 4 y gráficos de barras estilizados).

**Architecture:** Se crea un archivo central de tokens CSS (`design-tokens.css`) que define paletas claras y oscuras, radios de píldora y sombras sutiles. Se crea un componente modular `MallaSidebar` para navegación e índice técnico con viñetas cuadradas y filtro de áreas. Se refactoriza la estructura de `MallaCurricular` para envolver el grafo en una tarjeta redondeada (16px) con cabecera editorial y métricas en píldoras, y se estilizan `SidePanel` y `CourseDetail` con la misma estética de benchmark.

**Tech Stack:** React 18, Vite, Vanilla CSS, SVG puro para visualizaciones.

**Spec:** `docs/superpowers/specs/2026-09-03-artificial-analysis-redesign.md`

## Global Constraints
- No romper la funcionalidad existente: BFS de dependencias, cálculo de baricentro de la malla, autenticación vía Supabase Edge Function, marcado de cursos llevados, planificador de ciclo, arcade, calendario y persistencia.
- Mantener compatibilidad total con tema claro y oscuro (`[data-theme='dark']`).
- Mantener todo el texto en español como exige la arquitectura del proyecto (`CONTEXT.md`).
- Verificar siempre que `npm run build` pase con código 0 sin errores de empaquetado.

---

### Task 1: Tokens de Diseño y Estilos Globales

**Files:**
- Create: `src/styles/design-tokens.css`
- Modify: `src/index.css`

**Interfaces:**
- Produces: Variables CSS `--aa-*` para fondos, tarjetas, bordes, texto primario/secundario y estados en tema claro y tema oscuro.

- [ ] **Step 1: Crear `src/styles/design-tokens.css`** con las variables de diseño de Artificial Analysis:
```css
:root {
  /* Fondo y superficies */
  --aa-bg: #f8f9fa;
  --aa-bg-grid: #edf0f2;
  --aa-card: #ffffff;
  --aa-card-subtle: #f8fafc;
  --aa-border: #e2e6ea;
  --aa-border-strong: #cbd5e1;
  --aa-border-hover: #94a3b8;

  /* Tipografías */
  --aa-font-serif: 'Source Serif 4', Georgia, serif;
  --aa-font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --aa-font-mono: 'JetBrains Mono', monospace;

  /* Colores de texto */
  --aa-ink: #0c111d;
  --aa-ink-muted: #5c6779;
  --aa-ink-faint: #94a3b8;

  /* Píldoras y botones */
  --aa-pill-dark-bg: #0f172a;
  --aa-pill-dark-text: #ffffff;
  --aa-pill-neutral-bg: #f1f4f8;
  --aa-pill-neutral-border: #e2e6ea;
  --aa-pill-neutral-text: #1e293b;
  --aa-pill-hover-bg: #e2e8f0;

  /* Acentos y estados */
  --aa-accent-purple: #682057;
  --aa-accent-purple-soft: #fdf2f8;
  --aa-accent-green: #059669;
  --aa-accent-green-soft: #ecfdf5;
  --aa-accent-green-border: #a7f3d0;
  --aa-accent-amber: #d97706;
  --aa-accent-amber-soft: #fffbeb;
  --aa-accent-blue: #2563eb;
  --aa-accent-blue-soft: #eff6ff;
  --aa-accent-red: #dc2626;
  --aa-accent-red-soft: #fef2f2;

  /* Radios y sombras */
  --aa-radius-pill: 9999px;
  --aa-radius-card: 16px;
  --aa-radius-node: 8px;
  --aa-shadow-sm: 0 1px 2px rgba(12, 17, 29, 0.04);
  --aa-shadow-card: 0 1px 3px rgba(12, 17, 29, 0.05), 0 1px 2px rgba(12, 17, 29, 0.03);
}

[data-theme='dark'] {
  --aa-bg: #090d14;
  --aa-bg-grid: #131a26;
  --aa-card: #111622;
  --aa-card-subtle: #161c2b;
  --aa-border: #1e293b;
  --aa-border-strong: #334155;
  --aa-border-hover: #475569;

  --aa-ink: #f8fafc;
  --aa-ink-muted: #94a3b8;
  --aa-ink-faint: #64748b;

  --aa-pill-dark-bg: #f8fafc;
  --aa-pill-dark-text: #0f172a;
  --aa-pill-neutral-bg: #192131;
  --aa-pill-neutral-border: #293548;
  --aa-pill-neutral-text: #e2e8f0;
  --aa-pill-hover-bg: #232d40;

  --aa-accent-purple: #a8438b;
  --aa-accent-purple-soft: #38152e;
  --aa-accent-green: #10b981;
  --aa-accent-green-soft: #064e3b44;
  --aa-accent-green-border: #059669;
  --aa-accent-amber: #f59e0b;
  --aa-accent-amber-soft: #451a0344;
  --aa-accent-blue: #3b82f6;
  --aa-accent-blue-soft: #1e3a8a44;
  --aa-accent-red: #ef4444;
  --aa-accent-red-soft: #450a0a44;

  --aa-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --aa-shadow-card: 0 2px 6px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 2: Modificar `src/index.css`** para importar `design-tokens.css` y estandarizar la fuente base:
```css
@import './styles/design-tokens.css';
```
Y asegurar que `body` use `var(--aa-font-sans)` y `var(--aa-bg)`.

- [ ] **Step 3: Verificar compilación**
Run: `npm run build`
Expected: Exitoso sin advertencias de CSS ni paths inválidos.

- [ ] **Step 4: Commit**
Run: `git add src/styles/design-tokens.css src/index.css; git commit -m "style: agregar tokens globales estilo Artificial Analysis"`

---

### Task 2: Componente Sidebar Técnico con Viñetas Cuadradas (`MallaSidebar.jsx`)

**Files:**
- Create: `src/components/MallaSidebar.jsx`
- Create: `src/styles/MallaSidebar.css`

**Interfaces:**
- Props:
  - `mode`: string ('open' | 'req' | 'done' | 'noreq' | 'plan' | 'ficha')
  - `onSelectMode`: (mode) => void
  - `isGuest`: boolean
  - `areas`: array de áreas temáticas `{ key, nombre, color }`
  - `selectedArea`: string | null
  - `onSelectArea`: (areaKey | null) => void
  - `collapsed`: boolean
  - `onToggleCollapse`: () => void

- [ ] **Step 1: Crear `src/components/MallaSidebar.jsx`**
Renderiza la lista de navegación vertical con viñeta cuadrada `■`, sección de Modos y sección de Áreas Formativas con botón inferior para colapsar/expandir.

- [ ] **Step 2: Crear `src/styles/MallaSidebar.css`**
Estilos para la barra lateral: ancho 240px (o 60px cuando colapsado), tipografía limpia, viñetas con color activo, hover redondeado sutil.

- [ ] **Step 3: Verificar compilación**
Run: `npm run build`
Expected: Build exitoso.

- [ ] **Step 4: Commit**
Run: `git add src/components/MallaSidebar.jsx src/styles/MallaSidebar.css; git commit -m "feat: crear componente MallaSidebar con índice de viñetas cuadradas"`

---

### Task 3: Rediseño de la Estructura en `MallaCurricular.jsx`

**Files:**
- Modify: `src/components/MallaCurricular.jsx`

**Interfaces:**
- Consumes: `MallaSidebar`, tokens CSS.
- Produces:
  - Header superior estilo Artificial Analysis con badge en píldora, pestañas en píldora, buscador con atajo `⌘K` y acciones en píldoras.
  - Layout de dos columnas: `MallaSidebar` a la izquierda y `Benchmark Card` a la derecha conteniendo el grafo.
  - Atajo global `Cmd+K` / `Ctrl+K` para enfocar el buscador instantáneamente.

- [ ] **Step 1: Integrar atajo `Cmd+K` / `Ctrl+K` y refactorizar el header**:
Añadir listener de teclado para enfocar el input de búsqueda.
Actualizar el header con logo en píldora negra: `[ ❖ {M.uni} · {M.nombre} ]`, pestañas centrales, buscador en píldora y botones de usuario estilizados.

- [ ] **Step 2: Envolver el grafo en el contenedor Card de Artificial Analysis**:
Cabecera de la tarjeta con título editorial en `Source Serif 4`: `■ Malla Curricular · {M.nombre}`, subtítulo descriptivo y barra de herramientas con métricas en píldoras (`X de Y cursos · Z créditos`).

- [ ] **Step 3: Integrar `MallaSidebar` en el layout general**:
Colocar el sidebar a la izquierda del área principal con estado de colapso persistido o local.

- [ ] **Step 4: Verificar compilación**
Run: `npm run build`
Expected: Build exitoso.

- [ ] **Step 5: Commit**
Run: `git add src/components/MallaCurricular.jsx; git commit -m "feat: integrar header en píldoras y contenedor Benchmark Card en MallaCurricular"`

---

### Task 4: Estilos Estilo Artificial Analysis en `src/styles/MallaCurricular.css`

**Files:**
- Modify: `src/styles/MallaCurricular.css`

**Interfaces:**
- Estiliza el header superior en píldoras, la barra de herramientas interna, las tarjetas de cursos (`.node`) con bordes limpios, las píldoras de estado y el contenedor de la malla con `border-radius: 16px` y borde hairline.

- [ ] **Step 1: Actualizar layout global y header de MallaCurricular.css**:
Aplicar flex layout general con fondo `--aa-bg`, header estilizado con botones en píldora (`border-radius: 9999px`), y botón de búsqueda con badge `⌘K`.

- [ ] **Step 2: Estilizar el Benchmark Card de la Malla**:
Contenedor `.malla-card-container` con `border-radius: 16px`, `border: 1px solid var(--aa-border)`, fondo `var(--aa-card)` y cabecera con `Source Serif 4`.

- [ ] **Step 3: Estilizar los nodos de cursos (`.node`)**:
Bordes de 1.5px, esquinas redondeadas (8px), tipografía limpia, badges de créditos integrados con contraste nítido, estados `done`, `open`, `req`, `disponible` con la paleta de Artificial Analysis.

- [ ] **Step 4: Estilizar tema oscuro en `MallaCurricular.css`**:
Asegurar que todas las clases se adapten perfectamente bajo `[data-theme='dark']`.

- [ ] **Step 5: Verificar compilación**
Run: `npm run build`
Expected: Build exitoso.

- [ ] **Step 6: Commit**
Run: `git add src/styles/MallaCurricular.css; git commit -m "style: actualizar estilos de malla curricular con diseño de Artificial Analysis"`

---

### Task 5: Rediseño de `SidePanel.jsx` y `SidePanel.css` (Gráficos estilo Benchmark)

**Files:**
- Modify: `src/components/SidePanel.jsx`
- Modify: `src/styles/SidePanel.css`

**Interfaces:**
- Gráficos de barras SVG: Transformados para coincidir con los gráficos de barras verticales de Artificial Analysis (barras verticales redondeadas en el tope, valores en el extremo superior, colores vivos por ciclo, ejes limpios).
- Cabeceras de sección con `■` y `Source Serif 4`.
- Pestañas superiores en píldoras horizontales (`Notas`, `Estadísticas`, `Logros`, `Historia`).

- [ ] **Step 1: Actualizar pestañas y cabeceras en `SidePanel.jsx`**:
Pestañas estilizadas como píldoras (`border-radius: 9999px`), título del drawer `■ Mi Panel Académico` con `Source Serif 4`.

- [ ] **Step 2: Estilizar los gráficos SVG en `SidePanel.jsx`**:
Renderizar barras verticales con `rx="4" ry="4"`, colores acordes a la paleta del benchmark, y etiquetas numéricas nítidas en monospace.

- [ ] **Step 3: Actualizar `SidePanel.css`**:
Aplicar variables `--aa-*`, tarjetas internas para métricas y promedios con bordes de 1px y fondos `--aa-card-subtle`.

- [ ] **Step 4: Verificar compilación**
Run: `npm run build`
Expected: Build exitoso.

- [ ] **Step 5: Commit**
Run: `git add src/components/SidePanel.jsx src/styles/SidePanel.css; git commit -m "feat: rediseñar SidePanel con gráficos de barras estilo benchmark de Artificial Analysis"`

---

### Task 6: Rediseño de `CourseDetail.jsx` y `CourseDetail.css` (Ficha Técnica)

**Files:**
- Modify: `src/components/CourseDetail.jsx`
- Modify: `src/styles/CourseDetail.css`

**Interfaces:**
- Drawer de ficha técnica con título editorial `■ {Nombre del curso}`, código de curso en badge mono, estados académicos en píldoras limpias y lista de profesores en chips redondeados.

- [ ] **Step 1: Actualizar encabezado y badges en `CourseDetail.jsx`**:
Incorporar `Source Serif 4` en el título, píldora de créditos, y selector de estado académico en píldoras segmentadas.

- [ ] **Step 2: Actualizar `CourseDetail.css`**:
Fondos, bordes finos, chips de profesores y reseñas anónimas en cajas técnicas limpias con tipografía `Inter` y `JetBrains Mono`.

- [ ] **Step 3: Verificar compilación**
Run: `npm run build`
Expected: Build exitoso.

- [ ] **Step 4: Commit**
Run: `git add src/components/CourseDetail.jsx src/styles/CourseDetail.css; git commit -m "feat: rediseñar ficha del curso CourseDetail con estilo analítico"`

---

### Task 7: Verificación Integral y Ajustes Finales

**Files:**
- All touched files

- [ ] **Step 1: Verificar compilación completa**
Run: `npm run build`
Expected: 0 errores.

- [ ] **Step 2: Verificar visualmente en navegador con browser subagent o inspección de DOM**
Probar:
1. Header en píldoras y atajo `⌘K`.
2. Sidebar izquierdo técnico y cambio de modos.
3. Card principal de la malla con nodos estilizados.
4. Drawer de Mi Panel con gráficos de barras verticales.
5. Drawer de Ficha de Curso.
6. Alternancia Modo Claro y Modo Oscuro.

- [ ] **Step 3: Commit final y resumen de entrega**
Run: `git commit -m "chore: verificacion y cierre de rediseño estilo Artificial Analysis"`
