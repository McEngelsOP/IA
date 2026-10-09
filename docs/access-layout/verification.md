# Verificación del acceso

Se comparó el acceso actual con el PDF «I'ESAN · Sistema de acceso» y las capturas compartidas. El ajuste anterior imponía densidades pequeñas a todas las vistas por altura: a 1536×730, Recuperación quedaba con un título de 28 px y un panel de 348 px pese a disponer de espacio. A 1366×657, el título se reducía a 24 px. Eso comprimía innecesariamente el diseño.

`src/styles/accessViewport.css` conserva la fuente, superficie, colores, textos, fondo de video y animaciones. `html`/`body` siguen limitados al viewport, `.entry` permanece fija y `.panel` tiene altura máxima. Las vistas breves recuperan la altura del panel y la marca original. `fitViewport()` ahora prueba primero la composición original, después amplía la altura disponible y reduce espacios, y solo finalmente ajusta tamaños si el contenido activo todavía desborda. No fuerza una densidad según la altura de la ventana ni utiliza escala o zoom. Un error visible se vuelve a medir; el formulario recupera su distribución amplia al desaparecer el mensaje. Solo `.stage` permite desplazarse por debajo de 520 px o con el teclado virtual. En escritorio bajo se conserva un ancho mínimo de 420 px para evitar líneas adicionales en errores y la nota del pie.

## Proporciones recuperadas

Medidas de las vistas normales, sin mensaje de error:

| Vista | Viewport | Título | Logo | Alto del panel |
| --- | --- | ---: | ---: | ---: |
| Crear cuenta | 1920×947 | 42 px | 68 px | 863 px |
| Crear cuenta | 1536×730 | 34 px | 48 px | 697 px |
| Crear cuenta | 1366×657 | 32 px | 40 px | 622 px |
| Recuperación | 1536×730 | 38,4 px | 63 px | 604 px |
| Recuperación | 1366×657 | 34,15 px | 56 px | 625 px |

La suite comprueba también estas proporciones para impedir que un resultado sin scroll vuelva a aprobar una interfaz innecesariamente reducida.

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

Las capturas actuales muestran los cinco campos, botón, enlace y nota completos con el tamaño recuperado.

Recuperación: [1536×730](recuperar-1536x730.png).

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
