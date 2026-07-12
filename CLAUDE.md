# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Malla curricular interactiva para dos carreras de ESAN: **Ingeniería en IA** e **Ingeniería Industrial y Comercial**. React 18 + Vite, Supabase (auth + Postgres con RLS + una Edge Function), desplegada en Vercel: **push a `main` = deploy a producción**. Todo el texto de la interfaz y los mensajes de commit van en español.

## Comandos

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción (única verificación automática; no hay tests ni linter)
- Requiere `.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`

## Arquitectura

`App.jsx` decide la pantalla según la sesión de Supabase: `LoginPage` (login/registro/recuperación), `UpdatePassword` (llega del enlace del correo), `CareerSelect` o `MallaCurricular`. La malla recibe `user` y `carrera` — si `user` es `null` es **modo visitante**: puede explorar (y alternar de carrera con `onSwitchCarrera`) pero nada persiste, y las funciones sociales (profesores, panel lateral) ni se renderizan. El bloqueo real del visitante no es la UI: las tablas nuevas tienen políticas RLS solo para `authenticated`, el rol `anon` no tiene ninguna.

### Carreras

- `data/carreras.js` indexa las dos mallas: `data/cursos.js` (IA, 200 créd) y `data/cursosIndustrial.js` (Industrial y Comercial, 215 créd). Cada curso: `id`, `n` nombre, `c` ciclo, `cr` créditos, `r` prerequisitos, `rc` créditos aprobados requeridos (opcional; bloquea el marcado hasta alcanzar el umbral).
- **Cursos equivalentes entre carreras comparten el mismo `id`** (calc1, fis1, est1, prog1, com1, fin, glob, talleres, pre-formación): así los profesores y sus votos se ven desde ambas mallas sin tocar la base. **No renombrar esos ids** sin migrar la tabla `professors`.
- La carrera vive en `profiles.carrera` (`'ia'` | `'industrial'`), se elige en el registro (desplegable, va en los metadatos del signUp) y **es fija**: un trigger (`lock_carrera`) rechaza el cambio desde la app; solo el dueño la corrige desde el Table Editor. Cuentas anteriores a esta función tienen `carrera` NULL y `App.jsx` les muestra `CareerSelect` una sola vez.

### Componentes

- `MallaCurricular.jsx` — grafo de cursos (layout calculado por carrera a nivel de módulo en `buildMalla`). Tres modos: qué abre / qué requiere / marcar llevados (BFS sobre dependencias; los cursos con `rc` no se marcan sin los créditos y caen en cascada al desmarcar). El avance se guarda en la tabla `progress` (array `done`).
- `ProfessorPanel.jsx` — tarjeta bajo la barra de estado al seleccionar un curso: profesores con likes/dislikes, orden por `likes − dislikes`, insignia al primero si su puntaje es positivo. Votos con actualización optimista.
- `SidePanel.jsx` — panel lateral (botón "Mi panel"): notas por curso, gráficos SVG hechos a mano (barras y línea, sin librería de charts), ponderado `Σ(nota×créd)/Σcréd` ignorando cursos de 0 créditos, y herramientas compartidas.

## Autenticación — reglas no negociables

- **Todo flujo de auth pasa por la Edge Function `auth-by-code`** (`supabase.functions.invoke`, acciones `login`/`recover`/`resend`/`exists`). La RPC vieja `email_for_student_code` está **revocada en producción** — cualquier código que la llame falla. El navegador nunca debe recibir el correo completo de otro usuario (solo enmascarado `ju•••@gmail.com`).
- La Edge Function vive en `supabase/functions/auth-by-code/index.ts` pero **se despliega a mano en el dashboard de Supabase** (Edge Functions → editor); el push a Vercel NO la actualiza. Si se edita ese archivo, avisar al usuario que debe redesplegarla.
- Código de alumno: exactamente 8 dígitos; los dos primeros (promoción) van de 25 hasta el año en curso. Se valida en `LoginPage` y en la base (CHECK `NOT VALID` + trigger `handle_new_user`). **Los mensajes de error no deben revelar la regla** (decisión deliberada para no ayudar a colados); el placeholder tampoco muestra ejemplos con "25".
- Con confirmación de correo activa, Supabase devuelve un usuario sin identidades (`data.user.identities.length === 0`) al registrar un correo repetido, en vez de error — `LoginPage` ya lo maneja; no quitar ese check.

## Base de datos

Los `.sql` de `supabase/` son scripts que el usuario corre **a mano** en el SQL Editor (guardados allí como queries numeradas); editarlos en el repo no cambia producción. Cada script nuevo debe correrse **antes** de desplegar el frontend que lo usa. Tablas: `profiles` (incluye `carrera` y `alias`), `progress`, `professors` + `professor_votes` (PK compuesta = un voto por alumno), `grades` (privadas por alumno), `tools` (compartidas) + `tool_likes` (un like por alumno) + `tool_comments` (anónimos).

Decisiones que no hay que re-proponer:

- **Borrado en listas compartidas**: el creador de un profesor solo puede borrarlo mientras nadie más haya votado (política RLS con `not exists`); después, solo el dueño del proyecto desde Table Editor. Herramientas: siempre el creador. Nunca borrado libre para todos — los dislikes son la señal comunitaria, no el borrado.
- **Topes anti-spam** por RLS: 5 profesores por alumno por curso, 20 herramientas por alumno.
- Nombres de profesor **siempre en mayúsculas** (toUpperCase al guardar + CHECK en la base + CSS).
- Escala de notas 0–20, aprobado desde 10.5 (`PASS` en `SidePanel.jsx`).
- **Comentarios de herramientas son anónimos de verdad**: se firman con el `alias` ("nombre secreto", único, se elige una vez — trigger `lock_alias`), el servidor lo estampa (`stamp_comment_alias`) y `tool_comments.author_id` NO es legible por el cliente (permiso a nivel de columna). Por eso los `select` a `tool_comments` deben pedir columnas explícitas — `select('*')` falla — y nunca hay que exponer `author_id` ni un join alias↔perfil al navegador. Tope: 5 comentarios por alumno por herramienta (300 caracteres).

## Gotchas

- La cuenta admin/limpieza es el propio usuario vía Supabase Table Editor; el contacto público de la app es hernandengels@gmail.com.
- Pendientes conocidos que requieren coordinación con el usuario: CAPTCHA Turnstile (hay que tocar login + Edge Function juntos; no activarlo en el dashboard antes) y leaked password protection (probablemente requiere plan Pro).
