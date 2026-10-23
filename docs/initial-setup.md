# Configuración inicial de Lyra

El registro usa `login.html`. Tras autenticar y cargar la carrera, el portal ofrece configuración a cuentas que no la han completado, también desde móvil.

## Recorrido

1. Indicar semestre actual. Se sugieren cursos anteriores como llevados, con revisión posterior; pre-formación se revisa manualmente.
2. Revisar pendientes ciclo por ciclo, conservando selecciones al retroceder.
3. Elegir matrícula real, con cursos de distintos ciclos.
4. Indicar carga habitual para Planificar.
5. Consultar cómo preparar el horario desde Mi semestre. No hay un segundo importador ni entrada CSV.
6. Elegir compañero, método, reloj y tema de Focus.
7. Revisar y confirmar.

Los borradores anteriores que ya contenían clases se conservan y validan. Una configuración nueva importa el Excel después, desde Mi semestre, con revisión de propuesta y fechas antes de guardar.

## Persistencia y recuperación

`student_setup` guarda borrador, preferencias y finalización. La confirmación usa las RPC existentes y aplica cambios académicos de forma atómica. El token evita duplicar una confirmación reintentada. Un fallo conserva el borrador y no aplica cambios parciales.

Continuar después conserva el borrador y permite entrar a Inicio. Puede retomarse desde Inicio o el perfil. Una configuración completada no vuelve a abrirse como una cuenta nueva. Los cursos se ajustan en Mi carrera y las clases en Mi semestre.

Los scripts históricos de creación de tablas no deben volver a ejecutarse sobre una base instalada. Las pruebas actuales están en `tests/setupModel.test.mjs` y `tests/initialSetup.browser.mjs`; el último utiliza servicios simulados y se ejecuta mediante `npm run test:browser -- initialSetup`.
