# Verificación del acceso

Se leyeron completos `login.html` y `src/lib/accessController.js` antes de editar. El desbordamiento provenía de alturas mínimas, márgenes acumulados y el override final `max-height: none`. `enterHome()` mostraba `#complete` antes de navegar a `pagina.html`.

`src/styles/accessViewport.css` limita `html`/`body` al viewport (100vh con mejora 100dvh), fija `.entry`, limita `.panel` y comprime espacios y tamaños por altura. Conserva la fuente, colores, textos y animaciones restantes. El ajuste adicional mide el contenido real; no usa escala ni zoom. Solo `.stage` admite scroll cuando la altura es menor que 520 px o se abre el teclado virtual. El ambiente queda detrás del panel para que no intercepte enlaces en móvil.

Se eliminaron el HTML, los estilos y las referencias exclusivas de `#complete`. Login, registro con sesión y nueva contraseña navegan directamente a `pagina.html`; el botón permanece deshabilitado durante la solicitud. `#accessStatus` anuncia el éxito sin contenido visual. Los errores conservan el formulario y usan `#formMessage`. Un registro sin sesión sigue solicitando la confirmación real de correo.

`#replay` sigue reiniciando la carga previa. No hay `#previewHint` ni un modo de acceso simulado en esta versión. El antiguo botón «Abrir Inicio» ejecutaba `location.replace(destination)`, con destino `./pagina.html`; se conserva ese destino.

## Matriz de Chromium / Playwright

Cada casilla incluye la vista normal y un mensaje de error visible: 10 estados por tamaño, 80 combinaciones. Todos los requests de autenticación se interceptan; no se crean cuentas reales.

| Viewport | Login | Registro | Recuperación | Correo enviado | Nueva contraseña |
| --- | --- | --- | --- | --- | --- |
| 1920×947 | Pasa | Pasa | Pasa | Pasa | Pasa |
| 1536×730 | Pasa | Pasa | Pasa | Pasa | Pasa |
| 1366×657 | Pasa | Pasa | Pasa | Pasa | Pasa |
| 1280×620 | Pasa | Pasa | Pasa | Pasa | Pasa |
| 1024×600 | Pasa | Pasa | Pasa | Pasa | Pasa |
| 768×1024 | Pasa | Pasa | Pasa | Pasa | Pasa |
| 390×844 | Pasa | Pasa | Pasa | Pasa | Pasa |
| 360×640 | Pasa | Pasa | Pasa | Pasa | Pasa |

En las 80 combinaciones: `scrollHeight <= innerHeight`, `scrollWidth <= innerWidth`, contenido dentro del viewport, ninguna diferencia entre la altura interna y la disponible de `.stage`, y `scrollX`, `scrollY` y `stage.scrollTop` iguales a cero tras rueda, PageDown, Espacio, Tab y un gesto táctil. Las etiquetas conservan al menos 14 px; inputs/selects al menos 15 px; campos y botones al menos 44 px de alto.

También pasaron navegación directa de login/registro con sesión/reset sin ningún `#complete`, anuncio oculto de éxito, replay, confirmación de correo, scroll exclusivo de `.stage` a 390×480, geometría simulada de teclado móvil, animaciones habituales y ausencia de warnings/errores de consola. `npm run build` y `node --check src/lib/accessController.js` pasaron. El teclado se simuló mediante `visualViewport`; no es una prueba de un teléfono físico ni del correo real de Supabase.

## Capturas de Crear cuenta

- [1536×730](crear-cuenta-1536x730.png)
- [1366×657](crear-cuenta-1366x657.png)

Las capturas muestran los cinco campos, botón, enlace y nota completos. La marca de foco en el ojo de contraseña procede de la prueba con Tab.

## Reproducir

Requiere Python con Playwright y Chromium. Inicia Vite con credenciales ficticias en un terminal:

```sh
VITE_SUPABASE_URL=https://access-fixture.supabase.co VITE_SUPABASE_ANON_KEY=fixture-public-key npm run dev -- --host 127.0.0.1 --port 5181
```

En otro terminal:

```sh
ACCESS_BASE_URL=http://127.0.0.1:5181 ACCESS_BROWSER=/usr/bin/chromium python tests/accessViewport.py
```

`ACCESS_REVIEW_DIR` permite cambiar la carpeta de resultados; por defecto escribe JSON y capturas en `/tmp/ia-access-review`. El destino `pagina.html` también se intercepta para aislar las pruebas de la base de datos.
