# IA · Malla curricular interactiva

Para mejorar la visualización de los cursos y lo que conlleva cada uno. ¿La razón? El sistema de nuestra U está zzzzz.

Aplicación web de la malla de **Ingeniería en IA (ESAN)**: cada alumno inicia sesión con su código, marca los cursos que ya llevó y explora qué cursos abre o requiere cada uno. El progreso se guarda en su cuenta (Supabase).

## Características

- 🎓 Registro con las **18 carreras ESAN** de `Mallas curriculares/` y Mecatrónica PUCP; [fuentes, generación y activación](docs/careers.md)
- 🔐 Login con **código de alumno** (ESAN / PUCP) y contraseña
- ✉️ Registro con correo real: confirmación de cuenta y recuperación de contraseña
- 🗺️ Malla interactiva con cálculo heurístico de cruces mínimos y **filtro por áreas formativas**
- 🔗 Modos **"Qué abre"** / **"Qué requiere"** y **"Qué puedo llevar"**
- ✅ Modo **"Marcar llevados"**: requisitos previos en cascada y persistencia en Supabase
- 📅 **Planificador de ciclo y Calendario Académico** (eventos oficiales + personales sincronizados en la nube)
- 📝 **Ficha del curso**: notas, veces llevado, comentarios personales, reseñas anónimas y estrellas de dificultad
- 🤖 **Asesor académico Gemini, Groq y OpenRouter**: estima la carga del plan con créditos y dificultad agregada
- 🧭 **Proyección de ciclos**: compara rutas ligeras, equilibradas e intensivas respetando prerrequisitos
- 👨‍🏫 **Directorio de profesores**: likes/dislikes y etiquetas comunitarias
- 📊 **Mi Panel**: estadísticas, histogramas y línea de tiempo con logros desbloqueables
- 🕹️ **Arcade**: 7 juegos (4 educativos), incluido Geoduelo para dos jugadores, y puntajes por temporada en los juegos compatibles. [Integración de Geoduelo](docs/geoduelo.md).

## Stack

- **React + Vite** (frontend SPA con PWA y chunks lazy)
- **Supabase** (autenticación Edge Function, base de datos PostgreSQL con RLS y Storage)
- **Brevo** (SMTP para correos de confirmación/recuperación)

## Instalación

```bash
git clone https://github.com/McEngelsOP/IA.git
cd IA
npm install
```

Crea `.env.local` con tus credenciales de Supabase:

```
VITE_SUPABASE_URL=https://tuproyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-anon
```

Y ejecuta:

```bash
npm run dev
```

## Configuración de Supabase

Ejecuta en el **SQL Editor** los scripts de la carpeta [`supabase/`](supabase/), según corresponda:
- `setup.sql` — perfiles y triggers de autenticación
- `careers_catalog.sql` — ampliación a todas las carreras; ejecutar antes de publicar el registro actualizado, sin repetir los scripts históricos
- `progress.sql` — avance de malla
- `sync_features.sql` — plan, eventos con horarios/repetición semanal y tareas privadas; ejecutar antes de publicar `pagina.html`
- `focus_sessions.sql` — temporizador persistente e historial privado de Mod Focus; [guía de activación](supabase/FOCUS_SETUP.md)
- `study_groups.sql` — salas públicas/privadas, participantes, mensajes (`study_room_messages`) y funciones con permisos de membresía; conserva el chat anterior `study_messages`
- [`STUDY_GROUPS_SETUP.md`](supabase/STUDY_GROUPS_SETUP.md) — activación y pruebas de Grupos de estudio
- [`CALENDAR_SETUP.md`](supabase/CALENDAR_SETUP.md) — migración, revisión de RLS y orden de instalación de los scripts consolidados
- `course_detail.sql`, `arcade.sql`, `logros.sql` — ficha de curso, rankings de arcade y sistema de logros
- `GEMINI_ADVISOR.md` — configuración del asesor académico y respaldo automático Gemini → Groq → OpenRouter

## Scripts

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run preview` — previsualizar el build
- `node --test tests/calendarModel.test.mjs tests/studyGroups.test.mjs tests/focusModel.test.mjs` — calendario, conversación y validación de salas


## Oficial: información real por usuario

La rama `Oficial` corresponde a producción en `https://l-esan.vercel.app`. La arquitectura SPA anterior se conserva en `Revisar para limpiar/src/`; no se incluye en las entradas de Vite actuales.

`login.html` abre `pagina.html` en Inicio. Calendario/Horarios permite crear, editar y eliminar eventos y tareas de la cuenta, con vistas Día/Semana/Mes, horarios semanales, filtros y agenda accesible. Los cambios fallidos conservan los registros anteriores y el borrador. Inicio y Malla usan el mismo progreso privado.

El acceso incluye registro, recuperación por código, aviso de correo y cambio de contraseña dentro del mismo diseño. `src/lib/accessController.js` registra con `auth.signUp` y metadatos `student_code`/`carrera`, que consume el trigger existente del perfil. Con confirmación de correo activa, hay que abrir el enlace antes de entrar. Recuperación y reenvío usan la Edge Function `auth-by-code`; el contador de 45 segundos se calcula con una fecha límite del cliente y no es un límite de seguridad del servidor. La nueva contraseña se guarda con `auth.updateUser` después de verificar la sesión mediante `auth.getUser`.

En Supabase → Authentication → URL Configuration, permite `https://l-esan.vercel.app/login.html` como URL de redirección de correo; el acceso completado continúa a `pagina.html` en Inicio. Estas pantallas no requieren SQL nuevo ni redesplegar `auth-by-code`. El panel se adapta al viewport sin scroll de página y el éxito lleva directamente a Inicio, sin pantalla final. [Matriz de pruebas y capturas del acceso](docs/access-layout/verification.md). Se verificaron el build y siete grupos de pruebas de navegador con Supabase simulado; no se crearon cuentas reales ni se comprobó el envío de correo o el despliegue en producción.

Se retiraron las notas, horarios, conversaciones, menciones y enlaces de muestra. Asesor y Brújula reutilizan las herramientas reales; Recursos consulta los enlaces compartidos en Supabase. Grupos de estudio permite crear salas públicas o privadas por curso, entrar por código, consultar participantes y conversar con mensajes persistentes. Empieza vacío hasta que alguien cree una sala. Buzón sigue pendiente, sin simular envíos.

Para activar Calendario y Grupos en la base existente, ejecuta `supabase/sync_features.sql` y después `supabase/study_groups.sql` en el SQL Editor. Las migraciones no se aplicaron a producción desde este entorno: su proxy rechaza la conexión PostgreSQL. Consulta [la guía de Grupos de estudio](supabase/STUDY_GROUPS_SETUP.md). La variable administrativa `SUPABASE_DB_URL` nunca se incluye en el frontend.

Mod Focus ofrece sesiones persistentes con pausa y recuperación al recargar, historial por fecha y mensajes según el tiempo registrado. El selector muestra únicamente los cursos marcados como Matriculado de la carrera, en orden alfabético. Para activar esta versión, ejecutar `supabase/focus_sessions.sql` completo y recargar; no incluye sesiones de muestra.

## Material archivado

`Revisar para limpiar/README.md` describe los componentes de la aplicación anterior, juegos externos y planes alternativos que se conservaron para revisión. `Revisar para limpiar/inventario.json` registra sus rutas originales y motivos. `Mallas curriculares/` conserva las 18 fuentes activas; el prototipo HTML de IA y su hoja de fuentes se eliminaron, junto con la copia idéntica del Markdown de IA.

