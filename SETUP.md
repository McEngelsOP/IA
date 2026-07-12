# Configuración Rápida - Sílabo IA

## 1. Obtener credenciales de Supabase

### Paso 1: Crear proyecto en Supabase
1. Ve a https://supabase.com
2. Haz clic en "Start Your Project"
3. Crea una nueva cuenta o inicia sesión
4. Crea un nuevo proyecto (ej: "silabo-ia")
5. Espera a que se cree (2-3 minutos)

### Paso 2: Obtener URL y API Key
1. En tu proyecto, ve a **Settings → API**
2. Copia:
   - **Project URL** (en la sección "Project API keys")
   - **Anon public** key

## 2. Configurar archivo .env.local

Abre el archivo `.env.local` en la raíz del proyecto y pega:

```env
VITE_SUPABASE_URL=https://tuproyecto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5...
```

(Reemplaza con tus valores reales)

## 3. Crear estructura de base de datos

En Supabase, ve a **SQL Editor** y ejecuta los siguientes scripts:

### Script 1: Tabla de estudiantes

```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT auth.uid(),
  student_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view their own data"
ON students FOR SELECT
USING (auth.uid() = id);
```

### Script 2: Tablas de cursos

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
  status TEXT DEFAULT 'completed',
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

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prerequisites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Courses are viewable by all"
ON courses FOR SELECT
USING (true);

CREATE POLICY "Students can view their courses"
ON student_courses FOR SELECT
USING (auth.uid() = student_id);

CREATE POLICY "Prerequisites are public"
ON course_prerequisites FOR SELECT
USING (true);
```

## 4. Crear un usuario de prueba

Ve a **Authentication → Users** y haz clic en "Add User":
- Email: `A00123456@estudiante.esan.edu.pe`
- Password: `Tu contraseña segura`

Luego en SQL Editor, inserta el registro del estudiante:

```sql
INSERT INTO students (id, student_code, full_name, email)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'A00123456@estudiante.esan.edu.pe'),
  'A00123456',
  'Juan Pérez',
  'A00123456@estudiante.esan.edu.pe'
);
```

## 5. Ejecutar la aplicación

```bash
npm run dev
```

Se abrirá en http://localhost:5173

### Credenciales de prueba:
- **Código**: A00123456
- **Contraseña**: (la que estableciste)

## Solución de problemas

### "Variables de entorno no encontradas"
- ¿Guardaste `.env.local`?
- ¿Reiniciaste `npm run dev`?
- ¿Verificaste que NO hay espacios en blanco?

### "Invalid login credentials"
- ¿El usuario existe en Supabase Authentication?
- ¿El email es exacto: `{CODE}@estudiante.esan.edu.pe`?

### "CORS error"
- Ve a Supabase → Settings → API → CORS
- Añade `http://localhost:5173` a la lista

## Próximos pasos

1. Poblar tabla `courses` con tu malla curricular
2. Conectar tabla `student_courses` con datos de cada alumno
3. Configurar `course_prerequisites` con dependencias
4. Implementar visualización gráfica de malla curricular
5. Agregar estadísticas y dashboards

¿Necesitas ayuda con los siguientes pasos? 🚀
