# Asistente personal con historial local

Implementación en `aea`. El frontend mantiene conversaciones y borradores exclusivamente en IndexedDB, por cuenta y por origen. No hay sincronización de chats ni memoria conversacional en Supabase. Cambiar de navegador o dominio no migra el historial. El navegador puede borrar el almacenamiento: no se ofrece una garantía de respaldo.

## Conversación

1. Cargar los chats de la cuenta; permitir crear, abrir, eliminar uno o borrar el historial de esa cuenta.
2. Seleccionar hasta ocho mensajes y 6.000 caracteres del historial. Nunca se envían propuestas, aprobaciones ni atributos de autoridad dentro del historial.
3. Verificar sesión antes del envío y después de recibir la respuesta. El servidor autentica cada solicitud y vuelve a validar estructura, roles y tamaño (32.000 bytes). Solo permite `user` y `assistant` del cliente; las instrucciones de sistema se construyen en servidor.
4. Consultar perfil mínimo (alias, carrera, revisión). Un registro cerrado de lecturas deterministas decide por la pregunta y el último turno si necesita cursos/progreso, tareas o agenda. Las consultas académicas usan exclusivamente el cliente con JWT del estudiante, filtro de propietario y RLS. No se envían correo, código ni notas individuales.
5. Contexto académico: plan guardado, matrícula, aprobaciones y semestre informados. No se toma como verdadero el avance suministrado por el cliente. El plan que aún no se guardó no se considera vigente. La dificultad agregada solo se consulta cuando la pregunta la necesita.
6. Agenda: ventana de hoy a 30 días en America/Lima; hasta 40 eventos, incluyendo reglas semanales, y 40 tareas pendientes (también vencidas). Un resultado adicional detecta truncamiento. Los datos no consultados no equivalen a listas vacías. Otros períodos y archivos personales están fuera de esta primera entrega.
7. Construir contexto con campos permitidos y textos como datos no confiables. El servidor impone un máximo de 18.000 caracteres para el contexto personal, 55 segundos para peticiones externas de todo el turno, 42 segundos para generación y hasta tres intentos de proveedor, con 1.000 tokens de salida por intento. El presupuesto de entrada se limita conservadoramente por caracteres/bytes; no utiliza un tokenizador específico de cada modelo.
8. El modelo responde o propone un borrador estricto. No existe un ciclo de herramientas conducido por el modelo: la selección determinista evita añadir otro turno de generación para decidir lecturas. No recibe SQL, acceso a tablas arbitrarias ni herramientas de escritura.
9. React presenta texto sin HTML ejecutable. Mensajes, borrador de entrada y propuestas se conservan localmente. Límite local: 40 chats y 300 mensajes por chat; nunca se elimina silenciosamente una conversación para hacer espacio.

## Guardar un borrador

Solo se permite crear una tarea o un evento personal individual, sin recurrencia. La IA no puede borrar, modificar matrícula, notas ni perfil. El estudiante revisa título, fecha y horas; una fecha desconocida queda vacía y debe completarse.

- `prepare_draft`: autentica y valida el contenido exacto, y devuelve una aprobación HMAC ligada a usuario, operación, argumentos y caducidad de cinco minutos. Se usa `ADVISOR_APPROVAL_SECRET` si existe; de lo contrario, una clave derivada con separación de dominio de la clave del servidor existente. Nunca se envía el secreto al navegador.
- El identificador de operación se guarda localmente con la propuesta. Antes de ejecutar, se comprueba que la copia local puede persistirse. Se mantiene el identificador ante recarga y reintentos.
- `save_draft`: vuelve a autenticar, valida firma, propietario, caducidad y argumentos, y llama a `assistant_save_draft` con el JWT del estudiante. No invoca al modelo ni consume cuota de generación.
- La RPC es SECURITY INVOKER. Valida de nuevo los campos, aplica RLS y crea el registro junto a un recibo mínimo en la misma transacción. El bloqueo por propietario serializa reintentos. Un identificador repetido devuelve el resultado anterior; contenido diferente para la misma operación se rechaza. Máximo diez nuevas operaciones por minuto y cuenta.
- El recibo guarda identificador, propietario, tipo, hash de contenido, referencia y fecha; no mensajes, respuestas, resúmenes ni copia del borrador. La aprobación no habilita una segunda mutación; repetirla solo recupera el recibo. No se implementa limpieza automática de recibos: borrarlos permitiría reutilizar identificadores.
- La interfaz comunica éxito solo a partir del resultado del servidor. Si un guardado queda ambiguo por conexión, se reintenta la misma propuesta. Si se cambian datos de una operación ya aplicada, debe usarse el calendario para editar el registro; no se genera otra creación automáticamente.

## Privacidad y límites

El historial local es contexto no confiable y no concede permisos. Separar por cuenta protege la navegación normal, pero IndexedDB no es una caja cifrada: scripts del mismo origen y una persona con acceso al perfil del navegador pueden acceder al almacenamiento. Se conserva el historial al vencer la sesión; la interfaz privada se desmonta mediante la gestión de sesión existente.

El servidor no persiste contenido de chats. El proveedor recibe lo necesario para generar y aplica su propia política de retención; almacenamiento local no significa inferencia local. El cliente administrativo existente se mantiene **solo** para claves personales, cuotas y disponibilidad de proveedores; no se utiliza para leer o escribir datos académicos. La moderación existente conserva contadores/severidad, y esta ruta deja de enviar palabras extraídas del mensaje a su registro.

`assistant_local.sql` deshabilita las escrituras de `advisor_conversations` y la RPC antigua `advisor_append_reply`. No borra registros históricos. Otros chats comunitarios son funciones independientes y no se modifican.

## Activación y validación

Aplicar `supabase/assistant_local.sql` después del esquema de calendario; desplegar `study-advisor` incluyendo `personalContext.ts` y `drafts.ts`, además de sus dependencias actuales. Publicar el frontend de `aea` por separado. No requiere nuevos servicios ni cambios en Cloudflare.

Pruebas: `tests/assistantPersonal.test.mjs`, `tests/assistantLocal.sql.test.mjs`, `tests/advisorCurriculum.test.mjs` y `npm run test:browser -- assistantLocal`. Las pruebas con servicios simulados no prueban la calidad de una respuesta de un proveedor real ni sustituyen una sesión real de producción.
