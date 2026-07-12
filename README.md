# Sílabo IA - Gestión de Cursos

Aplicación web para gestionar la malla curricular de Ingeniería en IA en ESAN, con autenticación mediante Supabase.

## Características

- ✅ Interfaz de login con código de alumno y contraseña
- ✅ Autenticación segura con Supabase
- ✅ Visualización de malla curricular
- ✅ Gestión de cursos llevados y disponibles
- ✅ Seguimiento de dependencias entre cursos

## Requisitos

- Node.js 16+
- npm o pnpm
- Cuenta de Supabase

## Instalación

1. **Clonar o descargar el proyecto**

```bash
git clone https://github.com/McEngelsOP/IA.git
cd IA
```

2. **Instalar dependencias**

```bash
npm install
```

3. **Configurar variables de entorno**

Copia `.env.example` a `.env.local` y completa tus credenciales de Supabase:

```bash
cp .env.example .env.local
```

Edita `.env.local` y añade:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Obtén estas credenciales desde tu proyecto en [supabase.com](https://supabase.com):
- Settings → API → Project URL y anon key

4. **Ejecutar en desarrollo**

```bash
npm run dev
```

Se abrirá automáticamente en http://localhost:5173

## Configurar Supabase

### 1. Crear proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) y crea una nueva cuenta
2. Crea un nuevo proyecto
3. Ve a Settings → API y copia:
   - Project URL
   - Anon (public) key

### 2. Crear tabla de usuarios (estudiantes)

En el editor SQL de Supabase, ejecuta:

```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT auth.uid(),
  student_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Política de RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view their own data"
ON students FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Students can update their own data"
ON students FOR UPDATE
USING (auth.uid() = id);
```

### 3. Crear tabla de cursos

```sql
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  credits INT,
  semester INT,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE student_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'completed', -- completed, in_progress, pending
  grade FLOAT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, course_id)
);

CREATE TABLE course_prerequisites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  prerequisite_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE(course_id, prerequisite_id)
);

-- Políticas de RLS
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prerequisites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Courses are viewable by all"
ON courses FOR SELECT
USING (true);

CREATE POLICY "Students can view their courses"
ON student_courses FOR SELECT
USING (auth.uid() = student_id);

CREATE POLICY "Prerequisite info is public"
ON course_prerequisites FOR SELECT
USING (true);
```

### 4. Registrar usuarios en Supabase

Puedes hacerlo desde:
- Dashboard de Supabase → Authentication → Users (botón "Add user")
- O desde tu aplicación después de crear un endpoint de registro

Email debe ser: `{student_code}@estudiante.esan.edu.pe`

Ejemplo:
- Student Code: A00123456
- Email: A00123456@estudiante.esan.edu.pe
- Password: Una contraseña segura

## Estructura del Proyecto

```
src/
├── components/
│   ├── LoginPage.jsx       # Página de login
│   └── MallaCurricular.jsx # Dashboard principal
├── lib/
│   └── supabaseClient.js   # Cliente de Supabase
├── styles/
│   ├── LoginPage.css
│   └── MallaCurricular.css
├── App.jsx                 # Componente principal
├── main.jsx
└── index.css
```

## Scripts

- `npm run dev` - Inicia servidor de desarrollo
- `npm run build` - Compila para producción
- `npm run preview` - Previsualiza build de producción

## Próximos Pasos

- [ ] Integrar visualización de malla curricular interactiva
- [ ] Mostrar cursos completados vs pendientes
- [ ] Mostrar dependencias entre cursos
- [ ] Dashboard de progreso académico
- [ ] Exportar malla curricular en PDF

## Troubleshooting

### Error: "Las variables de entorno ... son requeridas"
- Asegúrate de que `.env.local` existe y tiene valores válidos
- Restart el servidor (`npm run dev`)

### No puedes iniciar sesión
- Verifica que el usuario existe en Supabase Authentication
- El email debe ser: `{student_code}@estudiante.esan.edu.pe`
- Revisa que la contraseña es correcta

### Errores de CORS
- Supabase debería manejarlo automáticamente, pero si ocurre:
  - Ve a Supabase → Settings → API
  - Verifica que tu dominio está en la lista de allowed hosts

## Soporte

¿Preguntas? Contacta con:
- sistemas@esan.edu.pe
- McEngelsOP en GitHub

## Licencia

Privada - ESAN
