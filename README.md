# IA · Malla curricular interactiva

Para mejorar la visualización de los cursos y lo que conlleva cada uno. ¿La razón? El sistema de nuestra U está zzzzz.

Aplicación web de la malla de **Ingeniería en IA (ESAN)**: cada alumno inicia sesión con su código, marca los cursos que ya llevó y explora qué cursos abre o requiere cada uno. El progreso se guarda en su cuenta (Supabase).

## Características

- 🔐 Login con **código de alumno** (ESAN / PUCP) y contraseña
- ✉️ Registro con correo real: confirmación de cuenta y recuperación de contraseña
- 🗺️ Malla interactiva con cálculo heurístico de cruces mínimos y **filtro por áreas formativas**
- 🔗 Modos **"Qué abre"** / **"Qué requiere"** y **"Qué puedo llevar"**
- ✅ Modo **"Marcar llevados"**: requisitos previos en cascada y persistencia en Supabase
- 📅 **Planificador de ciclo y Calendario Académico** (eventos oficiales + personales sincronizados en la nube)
- 📝 **Ficha del curso**: notas, veces llevado, comentarios personales, reseñas anónimas y estrellas de dificultad
- 🤖 **Asesor académico Gemini**: estima la carga del plan con créditos y dificultad agregada
- 🧭 **Proyección de ciclos**: compara rutas ligeras, equilibradas e intensivas respetando prerrequisitos
- 👨‍🏫 **Directorio de profesores**: likes/dislikes y etiquetas comunitarias
- 📊 **Mi Panel**: estadísticas, histogramas y línea de tiempo con logros desbloqueables
- 🕹️ **Arcade Retro**: 5 juegos nativos con ranking por temporada + juegos locales

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
- `progress.sql` — avance de malla
- `sync_features.sql` — plan, eventos con horarios/repetición semanal y tareas privadas; ejecutar antes de publicar `pagina.html`
- `study_groups.sql` — salas públicas/privadas, participantes, mensajes y funciones con permisos de membresía
- [`STUDY_GROUPS_SETUP.md`](supabase/STUDY_GROUPS_SETUP.md) — activación y pruebas de Grupos de estudio
- [`CALENDAR_SETUP.md`](supabase/CALENDAR_SETUP.md) — migración, revisión de RLS y orden de instalación de los scripts consolidados
- `course_detail.sql`, `arcade.sql`, `logros.sql` — ficha de curso, rankings de arcade y sistema de logros
- `GEMINI_ADVISOR.md` — configuración segura del asesor académico con una clave privada de Gemini

## Scripts

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run preview` — previsualizar el build
- `node --test tests/calendarModel.test.mjs tests/studyGroups.test.mjs` — calendario, conversación y validación de salas


## Oficial: información real por usuario

`login.html` abre `pagina.html` en Inicio. Calendario/Horarios permite crear, editar y eliminar eventos y tareas de la cuenta, con vistas Día/Semana/Mes, horarios semanales, filtros y agenda accesible. Los cambios fallidos conservan los registros anteriores y el borrador. Inicio y Malla usan el mismo progreso privado.

Se retiraron las notas, horarios, conversaciones, menciones y enlaces de muestra. Asesor y Brújula reutilizan las herramientas reales; Recursos consulta los enlaces compartidos en Supabase. Grupos de estudio permite crear salas públicas o privadas por curso, entrar por código, consultar participantes y conversar con mensajes persistentes. Empieza vacío hasta que alguien cree una sala. Buzón sigue pendiente, sin simular envíos.

Para activar Calendario y Grupos en la base existente, ejecuta `supabase/sync_features.sql` y después `supabase/study_groups.sql` en el SQL Editor. Las migraciones no se aplicaron a producción desde este entorno: su proxy rechaza la conexión PostgreSQL. Consulta [la guía de Grupos de estudio](supabase/STUDY_GROUPS_SETUP.md). La variable administrativa `SUPABASE_DB_URL` nunca se incluye en el frontend.
