# Guía del administrador

Todo lo de esta guía se hace desde el **dashboard de Supabase** (supabase.com → tu proyecto), sin tocar código y sin desplegar nada. Las herramientas son tres: **Table Editor** (editar filas), **SQL Editor** (consultas) y **Authentication → Users** (cuentas).

Dato clave: las reglas que bloquean a los alumnos (RLS, candados de carrera y alias) **no te aplican a ti** en el dashboard — ahí operas como dueño del proyecto. Los candados `lock_carrera` y `lock_alias` solo rechazan cambios hechos desde la app.

---

## 1. Cuentas

### Saber quién es quién (código ↔ correo ↔ uuid)
Table Editor → `profiles`. Columnas: `id` (uuid, la identidad en todas las demás tablas), `student_code`, `email`, `carrera`, `alias`.

### Borrar una cuenta (código usurpado, correo mal escrito, limpieza)
Authentication → Users → busca por correo → ⋮ → **Delete user**.

Esto borra **en cascada todo lo suyo**: perfil, progreso, notas, votos, likes y comentarios, **y también los profesores y herramientas que esa persona agregó** (aunque otros ya hayan votado o comentado en ellos). Si quieres conservar sus aportes compartidos, antes de borrar reasigna el creador:

```sql
-- Reasignar profesores y herramientas de un alumno a otro uuid (p. ej. el tuyo)
update professors set created_by = 'UUID_NUEVO' where created_by = 'UUID_A_BORRAR';
update tools set created_by = 'UUID_NUEVO' where created_by = 'UUID_A_BORRAR';
```

### Correo escrito mal al registrarse
Si nunca confirmó, borra el usuario (arriba); eso libera el código y el correo para registrarse de nuevo. Es el flujo del aviso "¿Escribiste mal tu correo?" de la app.

### Confirmar un correo a mano
Authentication → Users → el usuario → ⋮ → **Confirm email**. Útil si los correos no llegan (límite del SMTP).

### Mandarle un enlace de recuperación
El alumno debería usar "Olvidé mi contraseña", pero también puedes: Authentication → Users → ⋮ → **Send password recovery**.

### Ver quiénes no han confirmado su correo
```sql
select u.email, u.created_at, p.student_code
from auth.users u
left join profiles p on p.id = u.id
where u.email_confirmed_at is null
order by u.created_at desc;
```

---

## 2. Carrera

- **Corregir la carrera de un alumno**: Table Editor → `profiles` → columna `carrera` → `ia`, `industrial`, `marketing` o `pucp-mecatronica`.
- **Que vuelva a elegir**: pon `carrera` en `NULL` y la app le mostrará la pantalla de elección la próxima vez que entre.
- El alumno **no** puede cambiarla solo (trigger `lock_carrera`); tú sí, porque en el dashboard `auth.uid()` es NULL.

Su progreso y notas no se pierden al cambiar de carrera: quedan guardados por id de curso, y los cursos equivalentes (Cálculo I, Física I, Comunicación y Literatura, talleres, etc.) comparten id entre las tres carreras de ESAN, así que esos aparecen marcados en la otra malla. **La PUCP no comparte nada**: sus cursos usan ids con prefijo `pucp-`, así que al cambiar entre ESAN y PUCP el avance de la otra universidad simplemente no aparece (pero tampoco se borra).

```sql
-- Cuántos alumnos hay por carrera
select coalesce(carrera, 'sin elegir') as carrera, count(*) from profiles group by 1;
```

---

## 3. Nombre secreto (alias)

- **Cambiar o liberar el alias de alguien**: Table Editor → `profiles` → `alias` (ponlo en `NULL` para que elija otro). Igual que la carrera, el alumno no puede cambiarlo desde la app, tú sí.
- Los comentarios ya publicados **guardan el alias con el que se firmaron**: si le cambias el alias a alguien, sus comentarios viejos conservan la firma vieja. Si hace falta, actualízalos:

```sql
update tool_comments set alias = 'ALIAS_NUEVO' where author_id = 'UUID_DEL_ALUMNO';
```

- El alias es único entre todos (sin distinguir mayúsculas); si asignas uno repetido, la base lo rechazará.

---

## 4. Moderación

### Desenmascarar y borrar comentarios
Los alumnos solo ven el alias; **tú sí ves `author_id`** en `tool_comments` y `course_comments` (la restricción de columna solo aplica a la app). Para saber quién es cada comentario:

```sql
select c.created_at, c.alias, c.body, p.student_code, p.email, t.name as herramienta
from tool_comments c
join profiles p on p.id = c.author_id
join tools t on t.id = c.tool_id
order by c.created_at desc;

-- Lo mismo para las reseñas anónimas de cursos
select c.created_at, c.alias, c.body, c.course_id, p.student_code, p.email
from course_comments c
join profiles p on p.id = c.author_id
order by c.created_at desc;
```

Borrar: Table Editor → `tool_comments` / `course_comments` → elimina la fila. (Cada alumno puede borrar solo los suyos desde la app.)

Ojo: si le cambias el alias a alguien, sus reseñas viejas también conservan la firma vieja; el update de la sección 3 tiene su gemelo aquí:

```sql
update course_comments set alias = 'ALIAS_NUEVO' where author_id = 'UUID_DEL_ALUMNO';
```

### Borrar un profesor de la lista
El creador solo puede quitarlo mientras nadie más haya votado (decisión de diseño); después, **solo tú**: Table Editor → `professors` → elimina la fila (sus votos caen en cascada). Recuerda: la señal comunitaria normal son los dislikes, no el borrado.

### Borrar una herramienta
El creador puede hacerlo siempre desde la app. Tú también: Table Editor → `tools` (sus likes y comentarios caen en cascada).

### Votos o likes sospechosos
`professor_votes` y `tool_likes` guardan `student_id`: puedes ver quién votó qué y borrar filas puntuales. Estructuralmente solo puede existir un voto/like por alumno (clave primaria compuesta).

### Topes anti-spam vigentes (por si alguien reporta que "no puede agregar")
- 5 profesores por alumno por curso · 20 herramientas por alumno · 5 comentarios por alumno por herramienta (máx. 300 caracteres) · 3 reseñas por alumno por curso (máx. 50 palabras / 400 caracteres).

---

## 5. Progreso y notas de un alumno

- `progress`: una fila por alumno, columna `done` = array de ids de cursos marcados (los ids están en `src/data/cursos.js` y `src/data/cursosIndustrial.js`).
- `grades`: una fila por alumno+curso, nota 0–20.
- `course_status`: una fila por alumno+curso con el estado de la «Ficha del curso» (aprobado/convalidado/matriculado/desaprobado), veces llevado (1–3), fecha de aprobación y comentario personal. Un curso llevado sin fila aquí cuenta como aprobado; la app mantiene la coherencia con `progress` sola.

Normalmente no hay que tocarlos (cada alumno gestiona lo suyo), pero puedes corregir o vaciar si alguien rompe algo.

```sql
-- Ver el avance de un alumno por su código
select p.student_code, pr.done
from progress pr join profiles p on p.id = pr.student_id
where p.student_code = '25xxxxxx';
```

---

## 6. Consultas útiles varias

```sql
-- Ranking de profesores de un curso (con nombre del que lo agregó)
select pr.course_id, pr.name,
       count(*) filter (where v.vote = 1) as likes,
       count(*) filter (where v.vote = -1) as dislikes
from professors pr left join professor_votes v on v.professor_id = pr.id
group by pr.id order by pr.course_id, likes - dislikes desc;

-- Herramientas por likes
select t.name, t.url, count(l.*) as likes
from tools t left join tool_likes l on l.tool_id = t.id
group by t.id order by likes desc;

-- Últimos registros
select student_code, email, carrera, created_at from profiles order by created_at desc limit 20;
```

---

## 7. Configuración y despliegues (lo que sí requiere cuidado)

- **Scripts SQL**: las queries numeradas **01–16** ya están aplicadas en producción. No las vuelvas a correr (fallarían por objetos ya existentes). Los `.sql` del repo son solo el registro. **Pendiente de correr: `times_taken_max_3.sql` (query 17 · Veces llevado máx. 3)**. La 16 también restauró el tope de promoción por año para códigos ESAN (se había perdido al redefinir `handle_new_user` en la query 11) y acepta códigos PUCP (8 dígitos que empiezan en 20).
- **Edge Function `auth-by-code`**: se edita/redespliega a mano en Dashboard → Edge Functions (el push a Vercel NO la actualiza). No la toques si el login funciona.
- **SMTP propio (recomendado pendiente)**: Authentication → SMTP Settings. El SMTP integrado permite poquísimos correos por hora — es el primer cuello de botella si muchos se registran el mismo día.
- **CAPTCHA Turnstile**: ⚠️ **no lo actives en el dashboard** sin coordinar antes — requiere cambios simultáneos en el login y la Edge Function, o nadie podrá entrar.
- **Leaked password protection**: requiere probablemente plan Pro; pendiente conocido.
- **Deploy del frontend**: cualquier push a `main` en GitHub publica a producción vía Vercel. Los cambios de base de datos siempre van **antes** que el push que los usa.

## 8. Lo que NO conviene hacer

- Renombrar ids de cursos en los archivos de datos: los profesores, votos, notas y progreso están guardados por ese id (y los cursos equivalentes lo comparten entre carreras).
- Dar de alta políticas RLS "abiertas" o borrar las existentes: son la única barrera real (la UI es solo cosmética).
- Editar `auth.users` por SQL directo; usa siempre la pantalla de Authentication.
