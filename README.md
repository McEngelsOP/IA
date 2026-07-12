# IA · Malla curricular interactiva

Para mejorar la visualización de los cursos y lo que conlleva cada uno. ¿La razón? El sistema de nuestra U está zzzzz.

Aplicación web de la malla de **Ingeniería en IA (ESAN)**: cada alumno inicia sesión con su código, marca los cursos que ya llevó y explora qué cursos abre o requiere cada uno. El progreso se guarda en su cuenta (Supabase).

## Características

- 🔐 Login con **código de alumno** y contraseña
- ✉️ Registro con correo real: confirmación de cuenta y recuperación de contraseña ("Olvidé mi contraseña")
- 🗺️ Malla interactiva: 68 cursos, 10 ciclos + pre-formación
- 🔗 Modos **"Qué abre"** / **"Qué requiere"**: cadenas de dependencias iluminadas
- ✅ Modo **"Marcar llevados"**: los requisitos previos se marcan en automático y el avance (`X llevados · Y / 200 créd`) se guarda por alumno

## Stack

- **React + Vite** (frontend)
- **Supabase** (autenticación + base de datos con RLS)
- **Brevo** (SMTP para correos de confirmación/recuperación)

## Instalación

```bash
git clone https://github.com/McEngelsOP/IA.git
cd IA
npm install
```

Crea `.env.local` (puedes copiar `.env.example`) con tus credenciales de Supabase (Settings → API):

```
VITE_SUPABASE_URL=https://tuproyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-anon
```

Y ejecuta:

```bash
npm run dev
```

## Configuración de Supabase

1. Ejecuta en el **SQL Editor** los scripts de la carpeta [`supabase/`](supabase/), en orden:
   - [`setup.sql`](supabase/setup.sql) — tabla `profiles`, trigger de registro y función `email_for_student_code`
   - [`progress.sql`](supabase/progress.sql) — tabla `progress` (cursos llevados por alumno)
2. En **Authentication → URL Configuration**: pon la URL de la app como *Site URL* y agrégala a *Redirect URLs*.
3. En **Authentication → Emails → SMTP Settings**: configura un SMTP propio (ej. Brevo) para que los correos de confirmación y recuperación no se queden cortos con el límite gratuito.
4. En **Authentication → Rate Limits**: sube el límite de correos por hora (ej. 30).

## Cómo funciona el login

- Al **registrarse**, el alumno da su código + correo real + contraseña. El correo es la cuenta de Supabase; el código queda vinculado en `profiles` (vía trigger).
- Al **iniciar sesión**, solo escribe su código: la app busca el correo asociado con la función `email_for_student_code` y autentica con Supabase.
- **"Olvidé mi contraseña"** envía el enlace de recuperación al correo registrado (mostrado enmascarado).

## Estructura

```
src/
├── components/
│   ├── LoginPage.jsx       # Login, registro y recuperación
│   ├── UpdatePassword.jsx  # Nueva contraseña (desde el enlace del correo)
│   └── MallaCurricular.jsx # Malla interactiva con progreso
├── data/
│   └── cursos.js           # Cursos, ciclos y prerequisitos
├── lib/
│   └── supabaseClient.js
└── styles/
supabase/
├── setup.sql               # profiles + trigger + función de login
└── progress.sql            # progreso por alumno (RLS)
```

## Scripts

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run preview` — previsualizar el build

## Pendientes

- [ ] Desplegar en Vercel/Netlify para uso de los compañeros
- [ ] Dashboard de progreso académico
- [ ] Exportar la malla en PDF
