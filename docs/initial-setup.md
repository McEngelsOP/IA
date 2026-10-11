# Configuración inicial web

La creación de una cuenta continúa usando el registro existente de `login.html`. Después de autenticar y cargar su carrera, `pagina.html` abre el asistente para cuentas que todavía no hayan completado la configuración. Se activa solo en escritorio (más de 860 px); `ios-android.html` no cambia.

## Recorrido

1. Elegir semestre. Se sugieren como llevados los ciclos anteriores; pre-formación se revisa manualmente.
2. Revisar el catálogo ciclo por ciclo, desde el 1 hasta el actual. Se puede avanzar sin pendientes y retroceder sin perder selecciones. El ciclo actual se muestra sin marcarlo como llevado.
3. Ajustar la matrícula del ciclo y agregar cursos de la malla, incluidos adelantados.
4. Registrar el nombre de la mención o dejarla pendiente. No existe todavía un catálogo de menciones oficiales por carrera: no se ofrecen opciones inventadas ni se reemplazan los electivos.
5. Elegir carga habitual. Brújula IA incorpora esa carga como opción inicial de proyección.
6. Importar horario o posponerlo. Se aceptan CSV y XLSX de hasta 2 MB, una fila por clase, primera hoja, máximo 200 clases. Las columnas pueden reasignarse; días, horas y duplicados se revisan antes de continuar. Se requiere revisar las fechas del ciclo. Los nombres reconocidos deben estar seleccionados en la matrícula; otros se guardan como clases sin vínculo a la malla. Solo las clases se guardan, nunca el archivo.
7. Elegir compañero, método, reloj y tema de Mod Focus, o continuar con los valores predeterminados.
8. Revisar el resumen y confirmar.

## Persistencia

`supabase/initial_setup.sql` se aplica una sola vez antes del frontend. La migración exime a los perfiles ya existentes, sin modificar su avance académico.

La tabla privada `student_setup` guarda borrador, preferencias y fecha de finalización. Las RPC usan `SECURITY INVOKER`, verifican identidad/carrera y respetan RLS. La confirmación actualiza `progress`, `course_status`, clases semanales y preferencias en una sola transacción; una fila inválida revierte todos los cambios. El token del borrador hace idempotente un reintento de confirmación.

«Continuar después» guarda el borrador y permite entrar a Inicio. Puede retomarse desde Inicio o desde el perfil. Después de completar, el perfil abre «Preferencias de estudio». Los cursos se ajustan desde la malla y las clases desde Calendario. El avance que se haya registrado después de posponer el asistente se conserva al confirmar; no se generan notas ni logros artificialmente.

## Verificación realizada

- `npm run build`: compilación correcta, incluidos los puntos de entrada existentes.
- `node --test tests/setupModel.test.mjs tests/calendarModel.test.mjs tests/focusModel.test.mjs`: 17 pruebas aprobadas.
- `tests/initialSetup.browser.mjs`: flujo de escritorio con API simulada, fallo/reintento de borrador y confirmación, navegación por ciclos, recuperación tras recarga, importación CSV/XLSX, tema, preferencias y cursos de Mod Focus. Sin errores JavaScript.
- Supabase real, con datos temporales dentro de transacciones revertidas: confirmación, clases recurrentes, aislamiento entre cuentas, reversión por horario inválido y reintento sin duplicados.
- Capturas de escritorio: temas claro/oscuro, selección de semestre, pendientes, importación, personalización y resumen. Sin cambios a la versión móvil.

Para ejecutar la prueba de navegador se necesita Playwright y Chromium. Variables opcionales: `SETUP_BASE_URL`, `SETUP_BROWSER` y `SETUP_XLSX_FIXTURE`. El servidor de prueba debe usar `VITE_SUPABASE_URL=https://setup-fixture.supabase.co` y `VITE_SUPABASE_ANON_KEY=fixture-public-key`; la prueba intercepta esa API y no crea cuentas reales.
