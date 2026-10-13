# Mi IA: claves personales

## Uso

**Mi IA** se abre desde el perfil en escritorio o desde «+» en móvil. Requiere sesión y permite guardar o reemplazar, activar, desactivar, probar y eliminar claves de Gemini, Groq y OpenRouter. El servicio de la app es el modo predeterminado; guardar una clave activa **Mis claves**. El usuario puede volver al servicio de la app en cualquier momento.

El campo se oculta inicialmente y se vacía tras guardar. Las claves guardadas solo muestran sus últimos cuatro caracteres y estado; no se pueden recuperar desde la interfaz ni se guardan en `localStorage`. Eliminar una clave la borra de la app, pero no la revoca en el proveedor.

El Asesor IA y Texto → tareas usan el modo elegido. **Mis claves** utiliza únicamente los proveedores propios activos: si no hay claves disponibles o fallan, no recurre automáticamente a las credenciales compartidas. Brújula usa cálculos locales y no llama a proveedores. OpenRouter personal usa `openrouter/free`, sin selector de modelos de pago.

El modo personal admite 10 solicitudes cada 15 minutos y 200 al día; las pruebas también consumen cuota. Los límites del servicio compartido se conservan. Las consultas personales consumen la cuota de la cuenta del proveedor.

## Arquitectura e instalación

La interfaz está en `src/components/PersonalAISettings.jsx`, `src/styles/PersonalAISettings.css` y su integración en `pagina.html`. Conserva el diseño existente. `personal-ai` verifica la identidad con `auth.getUser()` y usa esa identidad para todas las operaciones; no acepta un `userId` del llamador como autorización.

`supabase/personal_ai_keys.sql` almacena configuración, referencias a claves y uso en tablas privadas. Supabase Vault guarda los secretos cifrados. Las RPC de gestión, lectura y cuota solo admiten `service_role`; las funciones privadas con privilegios elevados acotan el acceso a Vault. La respuesta de gestión devuelve metadata enmascarada, nunca la clave completa. Un trigger elimina el secreto de Vault cuando se elimina su registro.

`supabase/functions/study-advisor/aiRouting.ts` centraliza la selección de credenciales y cuotas para `study-advisor` y `text-to-tasks`. El modo personal tiene sus propias reservas y pausas por usuario/proveedor; el modo compartido mantiene las RPC existentes del asesor.

Para otro entorno, aplicar `supabase/personal_ai_keys.sql` sobre el esquema existente con Vault disponible y desplegar las funciones conservando los secretos del servicio compartido:

```sh
supabase functions deploy personal-ai
supabase functions deploy text-to-tasks
supabase functions deploy study-advisor
```

En el entorno revisado están desplegadas `personal-ai` v1, `text-to-tasks` v3 y `study-advisor` v12. La publicación del frontend de esta extensión aún no está confirmada.

## Verificación

Pasaron 29 pruebas relacionadas y el build de producción:

```sh
node --test tests/personalAi.test.mjs tests/textTasks.test.mjs tests/calendarModel.test.mjs tests/webSession.test.mjs
node tests/personalAi.browser.mjs
npm run build
```

La prueba de navegador con respuestas simuladas cubrió el flujo de configuración en 1366, 390 y 320 px, sin desbordamiento horizontal ni errores JavaScript. La revisión final concluyó «Ship», sin correcciones obligatorias.

El endpoint real autenticado se comprobó con una clave ficticia: guardado, metadata enmascarada, desactivación y eliminación. Con modo personal sin claves activas, la generación devolvió el error previsto sin usar el servicio compartido. El acceso directo a la RPC de lectura de secretos devolvió 403. Se eliminó la clave de prueba y se restauró el modo original; esto verifica el ciclo de gestión, no la disponibilidad de una clave personal válida.

Una prueba SQL en una transacción revertida verificó cifrado frente a descifrado sin emitir texto plano, permisos del alumno y eliminación del secreto. Los asesores de seguridad no registraron hallazgos nuevos; permanecen 30 advertencias previas sobre funciones con privilegios elevados ajenas a esta extensión.

Dos comprobaciones reales del servicio compartido confirmaron respuestas de Groq y OpenRouter; Gemini devolvió timeout o indisponibilidad. La generación real de tareas respondió mediante Groq. Esta evidencia refleja el momento de las pruebas, no garantiza disponibilidad futura.
