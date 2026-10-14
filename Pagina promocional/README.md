# Página promocional de ASEGEM

Landing en español basada en las funciones de `McEngelsOP/IA`, rama `aea`. Presenta malla curricular, planificación, Asesor IA, Brújula, Focus, Texto → tareas, calendario, Inicio, grupos, recursos, profesores, personalización y Arcade.

## Acceso y desarrollo

Desde la raíz del repositorio:

```sh
npm install
npm run dev
```

Abrir `/Pagina%20promocional/index.html`. La compilación `npm run build` genera `dist/Pagina promocional/index.html`. Vercel ofrece el alias `/promocional` mediante un rewrite. La portada actual del aplicativo permanece en `/login.html`.

No abrir el archivo fuente directamente con doble clic: el script es un módulo para que Vite empaquete las interacciones y los recursos. Usar el servidor de desarrollo o una versión desplegada.

## Archivos

- `index.html`: contenido semántico, demostraciones, primer uso y preguntas frecuentes.
- `styles.css`: composición espacial, cristal translúcido, Rubik local, adaptación móvil y movimiento reducido.
- `script.js`: navegación móvil, pestañas con teclado, suma de créditos, ejemplos de asesoría, temporizador con pausa/reinicio y organización de pendientes.
- `assets/`: marca SVG y recursos reutilizados del proyecto; imagen con procedencia registrada en su sidecar JSON.
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/`: contexto y documentación de esta superficie promocional.

## Demostraciones y contenido

Todos los ejemplos son ilustrativos. No requieren Supabase, no solicitan claves API, no consumen proveedores de IA ni escriben datos de estudiantes. La demostración de Texto → tareas separa las líneas introducidas; la herramienta real propone tareas usando el proveedor disponible. El temporizador solo funciona en la página y pausa al cambiar de herramienta.

Los enlaces de entrada van a `/login.html` del mismo dominio. Si se publica la carpeta en otro dominio, configurar `data-app-url="https://dominio-del-aplicativo/login.html"` en `<body>`.

## Verificación

Compilación completa de las entradas Vite y sintaxis JavaScript verificadas. Comprobados los IDs, anclas, recursos y relaciones de pestañas. La revisión de fuentes de Impeccable corrigió textos pequeños y el grafo en pantallas estrechas. Revisión visual y prueba interactiva en navegador pendientes: el entorno de trabajo no dispone del control de navegador compatible.

## Referencias técnicas consultadas

- https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
- https://web.dev/articles/prefers-reduced-motion

No se instalaron skills ni dependencias de terceros desde búsquedas web.
