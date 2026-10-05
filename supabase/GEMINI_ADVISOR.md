# Asesor académico con Gemini

El asesor aparece para alumnos con sesión iniciada. Cuando el alumno envía una pregunta, LESAN remite a Google Gemini el texto de esa pregunta y los cursos de su plan actual con créditos y promedios comunitarios de dificultad. No se envían notas, código de alumno, correo ni identificador de cuenta. El historial de conversación solo se conserva en memoria del navegador mientras la ventana está abierta.

La clave de Google vive como secreto de Supabase Edge Functions; nunca debe guardarse en variables `VITE_*` ni en el navegador.

## Configuración

1. Crea una clave para Gemini API en Google AI Studio y configura cuotas o límites de uso en Google Cloud.
2. Guarda la clave como secreto de Supabase:

   ```sh
   supabase secrets set GEMINI_API_KEY="TU_CLAVE" --project-ref esuyrftsopevmbhvhwov
   ```

3. Despliega la función:

   ```sh
   supabase functions deploy study-advisor --project-ref esuyrftsopevmbhvhwov
   ```

4. Inicia sesión en LESAN, agrega cursos en el Planificador y abre «Asesor IA». Si Gemini devuelve que falta configuración, revisa los secretos de la función.

El modelo predeterminado es `gemini-3.5-flash-lite`. Se puede cambiar con el secreto opcional `GEMINI_MODEL` sin modificar código. Si el modelo configurado devuelve 404, la función reintenta una vez con el modelo predeterminado. No reintenta errores de cuota ni autenticación. La función limita preguntas a 1,200 caracteres, historial a seis mensajes y respuestas a 700 tokens. La recomendación es orientativa y usa solo el plan y sus votos de dificultad.

## Verificación

Con una cuenta autenticada, pregunta por la carga del plan. La respuesta debe mencionar los créditos y distinguir los cursos con estrellas y votos insuficientes. Revisa Supabase Edge Function Logs para errores de proveedor; los registros de la función no guardan la pregunta, historial, clave de API ni respuesta.

## Diagnóstico

- `model_unavailable`: el modelo no existe o no está disponible para el proyecto de Google. Revisa `GEMINI_MODEL` y los modelos disponibles en Google AI Studio.
- `provider_configuration`: Google rechazó la solicitud; revisa la clave, sus restricciones y la configuración de Gemini API.
- `rate_limited`: Google rechazó la solicitud por cuota o límite de uso.
- `provider_timeout`: Google no respondió dentro de 20 segundos.

Los registros incluyen el nombre del modelo y el estado HTTP del proveedor; no incluyen secretos, preguntas ni respuestas. La función sigue validando la sesión del alumno antes de contactar a Gemini.
