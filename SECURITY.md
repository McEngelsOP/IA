# Seguridad y acceso

El repositorio de desarrollo debe mantenerse privado. Solo sus colaboradores
necesitan acceso al código; quienes prueban la aplicación pueden usar la web.
Una persona con acceso de lectura al repositorio puede descargarlo completo.

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
