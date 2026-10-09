# Asesor académico: Gemini → Groq → OpenRouter

El asesor aparece para alumnos con sesión iniciada. Cada pregunta empieza con Gemini. Si el proveedor agota su cuota o saldo, rechaza su clave, no encuentra el modelo, falla, tarda demasiado o devuelve una respuesta vacía, la función intenta Groq y después OpenRouter. Omite los proveedores sin clave. Una solicitud mal formada (por ejemplo, HTTP 400) detiene el proceso. No se mantiene un contador de saldo local: el cambio depende de la respuesta de cada proveedor y la siguiente pregunta vuelve a intentar Gemini.

Los proveedores que se intenten pueden recibir la pregunta, hasta seis mensajes recientes y los cursos del plan con créditos y promedios comunitarios de dificultad. No se envían notas, código de alumno, correo ni identificador de cuenta. El historial solo se conserva en memoria del navegador mientras la herramienta está abierta. OpenRouter recibe una preferencia `data_collection: deny` para excluir proveedores que recopilan datos; si no hay un proveedor elegible, informa un error.

## Secretos en Supabase

En el proyecto `esuyrftsopevmbhvhwov`, abre **Edge Functions → Secrets**. Conserva las claves existentes si ya están configuradas y comprueba los nombres exactos:

| Secreto | Proveedor | Modelo predeterminado | Ajuste opcional |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Google Gemini | `gemini-3.5-flash-lite` | `GEMINI_MODEL` |
| `GROQ_API_KEY` | Groq | `llama-3.3-70b-versatile` | `GROQ_MODEL` |
| `OPENROUTER_API_KEY` | OpenRouter | `openrouter/free` | `OPENROUTER_MODEL` |

Las claves viven en Supabase y nunca en variables `VITE_*`, el navegador ni Git. Las variables del entorno de desarrollo o de Vercel no se copian automáticamente a Supabase. Cada modelo debe estar disponible para la cuenta del proveedor. `openrouter/free` selecciona un modelo gratuito disponible, sujeto a sus límites; un modelo de pago elegido manualmente puede consumir saldo.

## Desplegar la actualización

Subir la rama a GitHub o desplegar Vercel no actualiza esta Edge Function. Hay que redesplegar **`study-advisor`** con **los dos archivos** de `supabase/functions/study-advisor/`:

- `index.ts`: verifica la sesión y prepara el contexto académico.
- `providers.mjs`: ejecuta las peticiones y el cambio automático de proveedor.

Con la CLI autenticada, desde la raíz del repositorio:

```sh
supabase functions deploy study-advisor --project-ref esuyrftsopevmbhvhwov
```

La CLI incluye ambos archivos. Si usas el editor de Supabase, actualiza `index.ts` y añade también `providers.mjs` en la misma carpeta de la función antes de desplegar. Pegar solo `index.ts` dejaría una importación sin resolver. No se necesita una migración SQL.

## Límites y diagnóstico

Se mantienen preguntas de 1.200 caracteres, seis mensajes recientes y respuestas de hasta 700 tokens y 8.000 caracteres. Cada proveedor tiene como máximo ocho segundos; la cadena completa tiene un presupuesto de 28 segundos. Se envía una petición por proveedor configurado y se detiene al recibir una respuesta válida. La sesión se verifica antes de contactar a cualquier proveedor.

Si todos los intentos fallan, se informa el último error. `rate_limited` indica cuota/saldo agotados; `model_unavailable`, modelo no disponible; `provider_configuration`, configuración rechazada; `provider_timeout`, tiempo excedido. `configuration_missing` aparece si ninguna clave está configurada.

Los logs de `study-advisor` indican proveedor, modelo, estado HTTP y categoría del fallo; nunca claves, preguntas, historial o respuestas. Cuando obtiene una respuesta, registran qué proveedor la produjo. Para verificar producción, inicia sesión, agrega cursos al plan y pregunta por la carga del ciclo. La respuesta debe usar sus créditos y distinguir votos insuficientes de dificultad.

## Verificación local

```sh
node --test tests/advisorProviders.test.mjs
npm run build
```

Las pruebas simulan respuestas HTTP y fallos de conexión: no consultan proveedores reales ni consumen cuotas. Cubren prioridad, cuota/saldo, historial equivalente, claves por destino, proveedores ausentes, errores, presupuesto de tiempo y exclusión de secretos de los logs.
