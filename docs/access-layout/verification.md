# Acceso directo y fondo optimizado

Revisión del 12 de octubre de 2026 sobre `Oficial`, base `5a9f296`.

## Problema y comportamiento nuevo

El HTML mostraba inicialmente el formulario, pero `initialize()` lo reemplazaba por `startup()`. La secuencia esperaba fuentes/video hasta 4 segundos y añadía pausas de 850 y 750 ms, además de la transición. Un `ResizeObserver` y la carga de fuentes podían volver a compactar el formulario mediante varias mediciones de layout.

Ahora el formulario permanece visible desde el HTML. La verificación de sesión empieza inmediatamente, sin depender del paisaje. Se eliminaron la pantalla «Un momento para comenzar», su barra, «Continuar al acceso», el botón de repetición y sus esperas. Registro, recuperación, confirmación de correo y validación de sesión conservan sus flujos reales.

El panel tiene el mismo ancho/alto en todas las vistas de una misma resolución: ancho entre 420 y 560 px en escritorio, alto máximo de 760 px limitado al viewport disponible. CSS determina los tamaños antes de pintar; JavaScript solo adapta el viewport visual cuando aparece el teclado o cambia el zoom. Los errores no agrandan el panel. En ventanas pequeñas el contenido se desplaza dentro del formulario, conservando controles de al menos 44 px y dejando el pie accesible.

## Recursos del paisaje

| Recurso | Antes | Ahora |
| --- | ---: | ---: |
| Video | 11.284.737 bytes, 2880×1620, 30 fps y audio | 654.520 bytes, 1920×1080, 24 fps, sin audio |
| Imagen previa | Sin imagen | WebP de 153.612 bytes, tomada del primer fotograma |
| HTML de login compilado | Aproximadamente 181 KB | Aproximadamente 30 KB |

El video pesa un 94,2 % menos. Se conserva el mismo paisaje en Full HD. MP4 H.264 con `faststart` permite reproducir sin descargar el archivo entero. Las fuentes existentes se sirven como archivos cacheables y se precarga la regular, en lugar de repetir datos base64 dentro del HTML.

`accessBackground.js` inicia el video después de dos fotogramas de renderizado y nunca espera `loadeddata` para habilitar el formulario. Si hay movimiento reducido, ahorro de datos o conexión 2G, muestra la imagen; con ahorro de datos se puede reanudar manualmente. Una pestaña oculta pausa el video. Un autoplay rechazado conserva un control para reanudar; un error de descarga vuelve a la imagen sin reintentos automáticos.

## Validación

- `node --test tests/accessBackground.test.mjs`: 8 pruebas aprobadas (inicio diferido, movimiento reducido, ahorro de datos, 2G, pestaña oculta, fallo del video y autoplay rechazado).
- `node --check src/features/access/accessController.js`, compilación Python de la prueba de viewport y `git diff --check`.
- `npm run build`: compilación de las tres entradas, con fuentes, imagen y video incluidos.
- `tests/accessViewport.py` fue adaptada a la eliminación de replay y al panel estable. No se volvió a ejecutar la matriz completa de 80 estados: no había un Chromium local utilizable. No se atribuyen resultados nuevos a esa matriz histórica.

Para reproducir navegación con Supabase simulado:

```sh
VITE_SUPABASE_URL=https://access-fixture.supabase.co VITE_SUPABASE_ANON_KEY=fixture-public-key npm run dev -- --host 127.0.0.1 --port 5181
ACCESS_BASE_URL=http://127.0.0.1:5181 ACCESS_BROWSER=/usr/bin/chromium python tests/accessViewport.py
```

Las pruebas interceptan autenticación y destino: no crean cuentas reales.

