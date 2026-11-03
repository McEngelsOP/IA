# Revisión de main · 3 de noviembre de 2026

Se revisaron los commits de comunicaciones individuales, temas/PDF/estado de IA, guía de importación y la integración de Oficial. Las correcciones se separan en commits para poder revertirlas por tema.

## Cambios

- **Inicio:** tamaños por botones o por la esquina, con ancho y alto en vivo. Funciona con mouse, tacto y flechas del teclado. Escape cancela el ajuste. Deshacer recupera el cambio anterior; Restablecer diseño también puede deshacerse. El contenido pasa entre resumen y contenido completo según su espacio, con desplazamiento interno cuando hace falta. La paloma permanece fija. Se conservan tamaños, orden y bloques ocultos por cuenta.
- **Movimiento:** transiciones de 160–280 ms y reacomodo de los bloques vecinos; el control sigue al puntero durante el gesto. Se respeta movimiento reducido.
- **Acceso:** conserva el tema oscuro al salir del portal claro; la preferencia de la plataforma se mantiene para el próximo ingreso. Se retiró la hoja de estilo clara del acceso.
- **Preferencias:** una lectura atrasada ya no revierte una elección guardada ni una respuesta más reciente.
- **PDF:** el promedio con igual peso por curso funciona incluso sin créditos de catálogo. Una lectura incompleta no se presenta como un informe completo. Se conservan los nombres de universidad/carrera de perfiles externos cuando falta el catálogo.
- **Grupos:** se corrigió una variable inexistente al paginar mensajes anteriores y se verificó que la moderación siga actualizando el historial cargado.
- **Comunicaciones:** diagnóstico de configuración y errores de Brevo más preciso; las acciones administrativas se coordinan durante un envío. Las pruebas usan un proveedor simulado.
- **Importación:** lector PDF actualizado y etiquetas del prompt/tabla separadas del contenido para evitar nombres accesibles ambiguos.
- **Mantenimiento:** dependencias actualizadas, CI con Node 22, una sola versión directa de esbuild y retirada de código sin uso. Node admitido: 22.13+ de la serie 22, o 24+.

## Por qué una cuenta ESAN puede pedir una API key

El sistema diferencia la universidad registrada de una afiliación institucional verificada y vigente. La cuota compartida requiere ambas cosas. Si la cuenta está pendiente, vencida o revocada, se pide una clave propia. Una cuenta verificada también puede haber elegido voluntariamente «Mis claves»; en ese caso debe seleccionar «Servicio de la app» para utilizar Lyra.

La consulta de infraestructura confirmó que las funciones SQL de política y administración existen. **No se confirmó el estado privado de tu cuenta.** La consulta de estados de administradores fue bloqueada por la revisión automática porque podía abarcar cuentas ajenas. No se concedieron verificaciones automáticas.

### Comprobación de tu cuenta al volver

1. Entra en **Perfil → Mi IA · claves personales** y lee **Acceso de tu cuenta**.
2. Si indica que estás verificado, elige **Servicio de la app**. No necesitas agregar una clave para ese modo.
3. Si está pendiente y tu sesión es administradora, baja a **Verificar afiliación ESAN**, pulsa **Usar mi cuenta**, revisa la prueba institucional y marca la confirmación. Después pulsa **Verificar por 180 días**. El acceso se vuelve a consultar automáticamente.
4. Si tu sesión no es administradora, el identificador está en **Identificador de cuenta para soporte**. La revisión debe hacerla un administrador.

## Actualización manual pendiente de los servicios de IA

Se leyeron las fuentes desplegadas: `study-advisor` v16, `text-to-tasks` v4, `excel-schedule` v2 y `personal-ai` v2 todavía incluyen el enrutamiento anterior, sin las comprobaciones comunes de la revisión del repositorio. Publicar `main` en Vercel no actualiza estas Edge Functions.

Desde una copia actualizada de `main`, con tu CLI de Supabase autenticada, revisa la ayuda y publica las cuatro funciones del mismo código. Sustituye `TU_PROJECT_REF` por la referencia del proyecto Lyra conectado al frontend:

```bash
npx supabase --help
npx supabase functions deploy --help
npx supabase login
npx supabase functions deploy study-advisor --project-ref TU_PROJECT_REF --use-api
npx supabase functions deploy text-to-tasks --project-ref TU_PROJECT_REF --use-api
npx supabase functions deploy excel-schedule --project-ref TU_PROJECT_REF --use-api
npx supabase functions deploy personal-ai --project-ref TU_PROJECT_REF --use-api
```

Conserva la verificación JWT activada. `--use-api` permite empaquetar en el servidor sin Docker. Después vuelve a abrir Mi IA y comprueba el modo elegido, una consulta del asistente y las herramientas que uses. Este cambio de interfaz no requiere SQL nuevo; no vuelvas a ejecutar todos los SQL históricos. La ejecución de SQL sigue siendo manual cuando corresponda a otro entorno.

Referencia: [despliegue de Edge Functions](https://supabase.com/docs/guides/functions/deploy) y [referencia de CLI](https://supabase.com/docs/reference/cli/global-flags).

## Validación y alcance

La revisión usa pruebas Node/PostgreSQL local, partidas reales del Worker dentro del simulador, archivos PDF de prueba y recorridos de navegador con servicios simulados. Incluye tamaños de 1440, 390 y 320 px, temas, lectura/guardado fallidos, sesión, cuotas y aislamiento por cuenta. Los ensayos no envían correos ni consumen proveedores de IA reales. La comprobación de Vercel previa a los cambios no encontró errores de ejecución registrados en la ventana de 24 horas; eso no acredita el acceso individual a IA.

Resultado: `npm run check` completado (165 pruebas de aplicación/SQL y 4 de Worker, catálogo reproducible y build), 13 recorridos de `npm run test:browser` y auditoría de dependencias con cero alertas. La cuadrícula de los resúmenes personalizados se comprobó además en escritorio y móvil después del ajuste visual final.
