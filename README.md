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
- `sync_features.sql` — soporte para sincronización de plan y calendario académico
- `course_detail.sql`, `temporadas.sql`, `logros.sql` — ficha de curso, rankings de arcade y sistema de logros
- `GEMINI_ADVISOR.md` — configuración segura del asesor académico con una clave privada de Gemini

## Scripts

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run preview` — previsualizar el build

