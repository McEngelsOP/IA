# Comunicaciones individuales de Lyra

Administración → Comunicaciones permite buscar los usuarios registrados por apodo o correo, seleccionar una persona, copiar su correo o descargar un CSV compatible con la importación de Brevo (EMAIL y FIRSTNAME). La lectura usa la RPC existente `admin_get_users`, reservada a administradores. No importa toda la base a Brevo, no interpreta antigüedad como feedback y no suscribe contactos a novedades. Las exportaciones las inicia explícitamente el administrador y contienen una sola persona.

El mensaje de agradecimiento queda como borrador editable. Revisar mensaje muestra el correo, asunto y contenido. Solo «Enviar a esta persona» solicita un envío real. La selección, borradores y referencias se mantienen únicamente mientras está abierta la sección; no quedan en almacenamiento local ni se registran cuerpos o direcciones en logs del servidor.

## Activación en Vercel

En el proyecto de Lyra, Settings → Environment Variables, configurar para Production:

- `BREVO_API_KEY`: clave **API**, distinta de la contraseña SMTP, creada en Brevo → SMTP & API → API Keys.
- `BREVO_SENDER_EMAIL`: dirección de un remitente ya verificado en Brevo. Usar la dirección admitida por Brevo, sin inventar una con el dominio vercel.app.
- `SUPABASE_SERVICE_ROLE_KEY`: clave privada del mismo proyecto Supabase que `VITE_SUPABASE_URL`. Solo servidor; nunca usar prefijo VITE_. También se puede configurar aquí una clave secreta de Supabase compatible con Auth Admin.
- `BREVO_SENDER_NAME`: opcional; por defecto Lyra AI.

No cambiar las credenciales SMTP de Supabase. Volver a desplegar tras configurar variables. Ninguna clave se incorpora al repositorio. Sin credenciales, la búsqueda, copia y exportación siguen disponibles, pero enviar queda deshabilitado. El estado comprueba presencia y formato de configuración, no valida credenciales con Brevo.

No requiere SQL nuevo. Deben estar instaladas las RPC del panel y su endurecimiento existentes; los errores de lectura no se presentan como una lista vacía. Una cuenta sin `profiles.is_admin = true` no puede utilizar el endpoint ni acceder al componente desde el panel. Moderadores de soporte o mallas no reciben este permiso.

## Verificación y límites

`/api/communications` valida la sesión con Auth y verifica `is_app_admin` en cada GET y POST. Solo entonces usa Auth Admin para resolver la dirección actual y confirmada por ID, rechazando cuentas anónimas, borradas, bloqueadas o con correo distinto al revisado. No admite destinatarios arbitrarios, CC, BCC, listas ni HTML del cliente. El contenido HTML se escapa en el servidor. GET no envía correos ni devuelve secretos.

Un identificador determinista de idempotencia para el mismo administrador, destinatario y contenido se envía a Brevo. Su ventana documentada es de 30 minutos: no constituye un historial permanente ni impide duplicados después de esa ventana. La interfaz bloquea clics simultáneos y no reintenta automáticamente. Si la respuesta se pierde, verificar los registros transaccionales de Brevo antes de intentar otro envío. Editar el mensaje cambia su identificador.

Una respuesta correcta muestra que **Brevo aceptó** la solicitud junto a su referencia. No afirma entrega, lectura ni ubicación en Principal. Los estados finales se consultan en Brevo; esta entrega no añade webhooks ni un registro permanente en Supabase. No se han enviado mensajes reales en las pruebas. Para campañas periódicas se necesita un flujo separado de preferencias y bajas; el CSV no acredita consentimiento.

Validar primero con la cuenta propia o un destinatario acordado: seleccionar, revisar, enviar una vez y comprobar el registro y la bandeja. Las pruebas automatizadas usan usuarios, claves y proveedor simulados.
