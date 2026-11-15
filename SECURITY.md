# Seguridad y acceso

El código de Lyra se distribuye bajo la licencia PolyForm Noncommercial 1.0.0.
El repositorio de desarrollo y su mantenimiento directo corresponden a sus colaboradores.
Quienes prueban la aplicación pueden utilizar la versión web publicada.

Mantener aquí las migraciones y pruebas necesarias para reproducir cambios.
Guardar fuera del repositorio las guías administrativas, informes de producción,
respaldos, datos reales, credenciales y archivos de configuración locales.
Usar variables del servidor para las integraciones internas; nunca `VITE_`.

La comprobación `npm run test:repository` detecta patrones habituales de
secretos y archivos restringidos. No sustituye una revisión de seguridad ni
comprueba la visibilidad o las alertas de GitHub.

Si una credencial se publica, revocarla o rotarla antes de limpiar el historial.
Eliminar un archivo de una rama no elimina sus versiones anteriores ni las
copias descargadas. Coordinar cualquier reescritura del historial con los
colaboradores y las integraciones antes de realizarla.

Comunicar los fallos de forma privada al responsable del proyecto, sin publicar
contraseñas, tokens, datos de alumnos ni instrucciones con registros reales.
