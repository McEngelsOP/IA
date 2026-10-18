# Activar Geoduelo online

Implementación para `McEngelsOP/IA`, rama `aea`. El código no crea recursos remotos ni modifica Supabase automáticamente. Offline conserva el juego local completo. Online incluye **los once modos y el duelo mixto, con 10 rondas simultáneas de 25 segundos**. El anfitrión elige modo y dificultad antes de empezar. Hay un intento por pregunta y 100–150 puntos por acierto según el tiempo recibido por el servidor; las apuestas, pistas, robos y turnos alternados pertenecen al modo local.

## Actualización de interfaz y pantalla completa

Si Online ya funciona con el servidor de todos los modos (protocolo 2), esta actualización **solo requiere desplegar la web** desde la rama `aea` en Vercel. No vuelvas a ejecutar SQL ni a desplegar el Worker por estos cambios visuales. Se conservan la URL configurada, salas, autenticación y guardado de resultados.

La partida adopta la jerarquía de Offline: jugadores, pregunta/reloj, globo y respuestas, y muelle de conexión/salida. En móvil los controles pasan debajo del globo; las pantallas bajas permiten desplazamiento interno. La barra Offline/Online incluye entrar/salir de pantalla completa. Si el navegador no permite pantalla completa nativa, se abre una vista inmersiva dentro del navegador; su botón de salida permanece visible. Escape sale de esa vista sin cerrar la partida.

El globo no recibe actualizaciones por los cambios del reloj y solo dibuja cuando cambia la pregunta, el tamaño o una interacción. Admite arrastrar, pellizcar, botones de zoom y teclado. El servidor conserva la autoridad sobre tiempo, respuestas y puntajes.

## Qué hace cada servicio

- Vercel sirve la interfaz. La sesión de la cuenta existente se utiliza para entrar.
- Cloudflare Workers verifica la identidad contra Supabase una vez por solicitud de acceso/reconexión. Un Durable Object coordina la cola; otro por sala mantiene preguntas, respuestas, tiempos y puntajes. WebSockets con hibernación y alarmas por fase, sin intervalos en el servidor.
- Supabase recibe **una fila por partida terminada**, con reintentos idempotentes. La tabla online está separada del ranking local. Cada participante puede consultar su historial con RLS; el cliente no puede insertar resultados. Esta versión muestra el resultado final en el juego; no incorpora todavía una pantalla de historial ni ranking online.

Se incluyen búsqueda pública, sala privada con código, una partida por cuenta, anfitrión y configuración compartida, confirmación de ambos jugadores, reconexión, cancelación y abandono. En búsqueda pública el anfitrión se elige al azar al emparejar; en sala privada es quien la crea. Solo él puede cambiar modo y dificultad; cada cambio anula las confirmaciones anteriores. Una sala privada **no** acepta personas de la búsqueda pública. No hay chat ni espectadores.

## 1. Supabase: ejecutar SQL manualmente

En el proyecto Supabase que ya usa la web, abre **SQL Editor**. Si el Arcade ya funciona, ejecuta solamente `supabase/geoduelo-online.sql`. Si falta la instalación anterior, el orden es `supabase/arcade.sql`, `supabase/geoduelo.sql`, `supabase/geoduelo-online.sql`. No ejecutes el archivo base sobre una instalación distinta sin revisarlo antes.

El SQL online se puede repetir: crea tabla, índices, política de lectura y función `record_geoduelo_online`. Solo `service_role` puede invocar la función. No habilites escritura de la tabla para usuarios ni cambies esa función a `authenticated`.

Para comprobar permisos, ejecuta:

```sql
select has_function_privilege('authenticated',
 'public.record_geoduelo_online(uuid,uuid,uuid,integer,integer,text,integer)', 'EXECUTE') as usuario_puede_escribir,
 has_function_privilege('service_role',
 'public.record_geoduelo_online(uuid,uuid,uuid,integer,integer,text,integer)', 'EXECUTE') as servidor_puede_escribir;
```

Debe devolver `false`, `true`.

## 2. Cloudflare: desplegar el servidor

Crea una cuenta Cloudflare y usa **Workers & Pages**. No necesitas transferir tu dominio. En tu computadora, instala Node.js 22 LTS o posterior y descarga la rama:

```bash
git clone --branch aea https://github.com/McEngelsOP/IA.git
cd IA/workers/geoduelo
npm ci
npx wrangler login
```

Si ya tienes el repositorio, actualiza `aea` y entra a `workers/geoduelo`.

Edita `workers/geoduelo/wrangler.jsonc`, en `vars`:

| Variable | Valor |
| --- | --- |
| `ALLOWED_ORIGINS` | El origen exacto de tu web, por ejemplo `https://mi-proyecto.vercel.app`. Sin ruta ni `/` final. Varios orígenes separados por comas. Incluye el dominio personalizado si lo usas; no uses `*`. |
| `SUPABASE_URL` | La URL del mismo proyecto que usa el frontend: `https://TU_REF.supabase.co`. Sin `/` final. |
| `MAX_PLAYERS` | `50` inicialmente. Es un límite operativo de plazas reservadas, no una garantía de capacidad ni el máximo del plan gratuito. |

Despliega para crear los bindings y las dos clases SQLite de Durable Objects:

```bash
npm run deploy
```

Wrangler mostrará la URL `https://geoduelo-online.TU_SUBDOMINIO.workers.dev`. Anótala. Todavía rechazará conexiones hasta que cargues los secretos:

```bash
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TICKET_SECRET
```

Cada comando solicita el valor de forma interactiva:

- `SUPABASE_ANON_KEY`: clave pública **anon** o **publishable** del proyecto, usada para verificar la cuenta.
- `SUPABASE_SERVICE_ROLE_KEY`: clave **service_role JWT** de Supabase, desde Project Settings → API Keys → Legacy API Keys. Es un secreto exclusivo de Cloudflare. Esta implementación la envía también como Bearer, así que no reemplazarla por `sb_secret_...` sin adaptar el transporte de autenticación del servidor.
- `TICKET_SECRET`: cadena aleatoria de al menos 32 caracteres. Puedes generar 64 hexadecimales con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` en tu computadora. No compartas este valor.

No pongas `service_role` ni `TICKET_SECRET` en Vercel, variables `VITE_`, GitHub ni archivos versionados. Los `.dev.vars` locales están ignorados por git. No necesitas crear namespaces a mano: Wrangler los crea mediante `durable_objects` y `migrations`. Conserva el tag `v1` después del primer despliegue.

## 3. Vercel: activar Online

En el proyecto de la web, **Settings → Environment Variables**, agrega:

```text
VITE_GEODUELO_ONLINE_URL=https://geoduelo-online.TU_SUBDOMINIO.workers.dev
```

Selecciona los entornos donde vayas a probarlo y **redeploy** la rama `aea` o su despliegue correspondiente. Al ser una variable Vite, cambiarla requiere reconstruir el frontend. El dominio de ese despliegue debe estar en `ALLOWED_ORIGINS`; si Vercel genera una nueva URL de preview, agrégala explícitamente o usa un dominio estable de pruebas y vuelve a desplegar el Worker.

Sin esta variable, Online muestra que falta la activación y Offline continúa funcionando. No es necesario cambiar las variables Supabase existentes de la web.

## 4. Comprobar con dos cuentas y dos máquinas

1. Inicia sesión con dos cuentas distintas. Una misma cuenta no ocupa ambos puestos.
2. En Arcade → Educativos → Geoduelo → Online, ambas pulsan **Buscar rival**. Deben llegar a la misma sala. El anfitrión elegido al azar selecciona modo y dificultad y ambos confirman **Estoy listo**. Si cambia la configuración, ambos deben confirmar de nuevo.
3. Termina una partida. Comprueba el marcador de ambos y el mensaje **Resultado online guardado en tu cuenta**.
4. En SQL Editor: `select match_id, outcome, score_one, score_two, created_at from public.geoduelo_online_results order by created_at desc limit 10;`. Debe aparecer una fila por partida, sin duplicados.
5. Crea una sala privada, comparte el código y entra desde la otra cuenta. Una tercera cuenta que busque públicamente no debe entrar en esa sala.
6. Desconecta una máquina y reconéctala. La partida recupera el estado con el reloj del servidor. Cambiar de pestaña o perder conexión **no pausa** el duelo; una respuesta fuera de plazo no suma.
7. Prueba **Abandonar partida**, **Cancelar búsqueda / sala** y volver a Offline.

## Operación y límites iniciales

- Cola pública: espera hasta 2 minutos. Sala privada: hasta 5 minutos. Confirmación de inicio y selección de modo: 2 minutos.
- Dos conexiones por sala, una por cuenta; abrir la misma partida en otra pestaña cierra la conexión anterior.
- Reloj local ajustado con la hora del servidor; solo se envían acciones y cambios de fase. Las soluciones no se envían antes de cerrar cada pregunta.
- El cierre explícito de Arcade o el cambio a Offline intenta cancelar/abandonar con `keepalive`. Si el navegador se cierra de golpe o no hay red, el servidor continúa con sus plazos hasta terminar o vencer. No hay victoria automática solo por un corte breve.
- Las reservas del coordinador caducan a los 15 minutos como máximo; salas que esperan se liberan al vencer. Las partidas terminadas se liberan al volver a buscar. Con 50 plazas reservadas, no pueden comenzar más de 25 duelos a la vez; tras una finalización puede haber reservas conservadoras hasta la siguiente solicitud o caducidad.
- Un resultado fallido se reintenta hasta 8 veces con espera creciente hasta 60 segundos. Tras agotar los intentos aparece un aviso; el registro temporal de la sala se limpia 5 minutos después. Activa SQL y secretos **antes** de usar partidas reales. Un fallo permanente de credenciales/SQL requiere corregirlo; no se promete recuperar resultados después de esa limpieza.
- El plan gratuito puede detener solicitudes cuando se agota una cuota. Este código no activa facturación ni garantiza capacidad frente a abuso. Revisa Workers → Metrics y Durable Objects → Metrics al abrir la prueba. El límite de 50 es deliberadamente pequeño para el estreno.
- Para desactivar Online, elimina `VITE_GEODUELO_ONLINE_URL` y reconstruye. Offline permanece disponible. Para bajar el aforo cambia `MAX_PLAYERS` y despliega el Worker.

## Verificación local reproducible

Desde `workers/geoduelo`: `npm ci && npm test`. Usa Miniflare/workerd real con Auth y persistencia remotos simulados: emparejamiento público, privacidad, integridad de tickets, reconexión, diez rondas completas y escritura final.

Desde la raíz, con Playwright y Chromium instalados, y PGlite disponible:

```bash
PLAYWRIGHT_PATH=/ruta/a/node_modules/playwright node tests/geoduelo-online.browser.mjs
PGLITE_PATH=/ruta/a/node_modules/@electric-sql/pglite node tests/geoduelo-online.sql.mjs
npm run build
```

La prueba de navegador usa dos contextos, servidor Vite y Worker local en el mismo proceso; prueba interacción completa y vistas de escritorio/móvil. Los servicios remotos solo quedan comprobados después del paso 4.

## Referencias técnicas

- [Cloudflare: WebSockets con hibernación](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Cloudflare: alarmas](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Supabase: seguridad de API](https://supabase.com/docs/guides/api/securing-your-api)

El banco de preguntas se deriva del juego local aportado en `public/juegos/geoduelo/index.html`, mediante `node scripts/geoduelo-data.mjs`. Usa los mismos datos y mapa con sus licencias existentes. Las preguntas de capital por país omiten Bolivia, Sudáfrica y Sri Lanka para evitar varias sedes/capitales posibles. Las poblaciones y superficies son aproximadas según el banco del juego; los husos se calculan para la fecha de generación de cada pregunta.

## Actualizar una instalación online que ya funciona

No hace falta ejecutar otro SQL ni cambiar los secretos. Actualiza la copia completa del repositorio (el Worker importa también módulos compartidos y el mapa):

```bash
git switch aea
git pull --ff-only origin aea
cd workers/geoduelo
npm ci
npm run deploy
```

Conserva tus valores reales de `wrangler.jsonc` al actualizar. Si los configuraste solo en el panel Cloudflare, comprueba `ALLOWED_ORIGINS`, `SUPABASE_URL` y `MAX_PLAYERS`: Wrangler publica los valores de `vars` del archivo. Los secretos existentes permanecen. No subas claves al repositorio.

Después reconstruye/redeploy la web de `aea` en Vercel con la misma `VITE_GEODUELO_ONLINE_URL`. Despliega primero el Worker; luego la web. Pide a ambos jugadores que recarguen la página. El protocolo online ahora es versión 2: un cliente anterior recibe un aviso para actualizar y un cliente nuevo detecta el Worker anterior.

Modos: Encuentra el país, Ubica la capital, Lugares del mundo, Reconoce el país, Capitales, Monedas, Idiomas, Detecta el error, Distancias, Husos horarios, Ordena los países y Duelo mixto. Ubicación utiliza globo con ratón, táctil o teclado (flechas, zoom y Enter para marcar el centro). Confirma la marca para enviarla; el rival no ve tu respuesta antes de la revelación. Distancia recibe una estimación en kilómetros y Ordenar recibe una permutación completa. Todas se validan en el servidor.

El Worker genera una pregunta por cambio de fase, en lugar de producir todas al confirmar, para acotar el trabajo de CPU por evento. Los estados de pregunta ocultan solución, coordenadas objetivo, orden correcto y márgenes de evaluación. Solo después de que ambos respondan o venza el plazo se revela la solución.
