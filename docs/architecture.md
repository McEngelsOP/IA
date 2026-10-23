# Arquitectura de Lyra para ESAN

`app` compone las funciones y conecta su estado. `features` contiene experiencias concretas. `core` recibe cursos y estados como argumentos; no conoce universidades, Supabase ni componentes visuales. `institutions` aporta catálogos y configuración. `shared` se reserva para piezas utilizadas por varias funciones.

## Contrato académico

La malla se identifica por institución, carrera y revisión. Los cursos conservan ID, nombre, ciclo, créditos, requisitos, área y umbrales/notas especiales. Una malla no demuestra la oferta de secciones de un periodo. La matrícula actual pertenece al estudiante y al periodo.

El perfil se asocia a una revisión desde el servidor. Las revisiones publicadas se conservan. Equivalencias y cambios de plan se revisan explícitamente; no convertir cursos por similitud de nombre.

Las tablas personales y sus propietarios se conservan. `curriculum_versions` solo registra metadatos del catálogo y aplica RLS de lectura; las escrituras quedan para administración. Las RPC existentes mantienen los guardados académicos atómicos.

## Actualización de una malla

1. Revisar documento, procedencia y plan al que corresponde.
2. Editar las fuentes seleccionadas y ejecutar el generador.
3. Revisar IDs, créditos, requisitos, electivos y snapshot.
4. Conservar revisiones anteriores y ejecutar `npm run check`.
5. Preparar servidor y frontend en el mismo entorno.
6. Cambiar asignaciones existentes solo mediante una transición revisada.

## Expansión

Agregar otra universidad requiere un adaptador y datos versionados, sin duplicar el portal ni introducir condiciones institucionales dentro del motor. Si existen correquisitos o reglas no modeladas, ampliar el contrato y sus pruebas; no aproximarlos silenciosamente.

El adaptador ESAN mantiene la validación sintáctica de códigos previa. Esto no acredita matrícula ni pertenencia institucional por sí solo. Una verificación de pertenencia requiere una fuente autorizada independiente. No hay integración automática con sistemas internos de ESAN.
