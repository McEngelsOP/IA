# Revisión por secciones · 3 de noviembre de 2026

La revisión siguió este orden: Inicio, Mi carrera (malla), Mi semestre, Planificar, Asistente y herramientas. Cada fallo se reprodujo y se comprobó antes de continuar. Se trabajó en `main` con una corrección por commit.

## Correcciones

| Sección | Fallo corregido | Commit |
| --- | --- | --- |
| Inicio | Al ampliar un bloque desde un acceso rápido, el siguiente ajuste de tamaño partía del tamaño personalizado anterior. Ahora parte del tamaño visible. | [0f780a3](https://github.com/McEngelsOP/IA/commit/0f780a3fb501fbea37514d2a7306e06c48ef6a4d) |
| Mi semestre | «Próxima clase» y la fecha de hoy quedaban desactualizadas si el calendario permanecía abierto. Se actualizan por minuto y al recuperar la pestaña; una fecha elegida por el usuario se conserva. | [1471b0c](https://github.com/McEngelsOP/IA/commit/1471b0c28d067a8770caa1f8fc062299523be365) |
| Planificar | Si todos los cursos restantes estaban en curso, se mostraba un falso problema de requisitos. Se distinguen matrícula actual, malla completada y requisitos pendientes; se elimina el aviso duplicado. | [c618336](https://github.com/McEngelsOP/IA/commit/c61833674740182fcae0ed6837a52071fea8b9d8) |
| Recursos | Un enlace mal escrito mostraba un fallo genérico. Ahora pide corregir el enlace, conserva el formulario y evita una solicitud de publicación inválida. | [4e0b12b](https://github.com/McEngelsOP/IA/commit/4e0b12befac102280f7f75d2864b877c32668ed7) |
| Arcade | La pantalla de entrada fallaba porque la fuente de píxeles no contenía las letras L e Y del título LYRA. Se completaron las letras y se comprobó la apertura y la salida. | [77744fd](https://github.com/McEngelsOP/IA/commit/77744fd73227168949d67e012ccdfc1b31c86f78) |

No aparecieron otros fallos en los recorridos comprobados de malla, Asistente, Mi IA, grupos y Focus.

## Comprobaciones

- `npm run check`: 167 pruebas de aplicación/SQL y 4 del Worker; revisión del repositorio, catálogo reproducible y compilación correctos.
- 17 recorridos distintos de navegador. La pasada completa y las comprobaciones posteriores del cambio de Arcade cubrieron escritorio, móvil, temas y movimiento reducido según cada recorrido.
- Cuatro recorridos sobre archivos compilados con configuración de prueba: Focus, Arcade, espacio académico ESAN y fichas/Recursos.
- Regresiones nuevas: tamaño tras ampliar un bloque; cambio de clase y medianoche de Lima sin interacción; último semestre en curso; enlaces inválidos; pausa y continuación de Focus; apertura de Arcade y carga de Dino/Galaxia.
- Los 18 catálogos ESAN se abrieron; se comprobaron planificación, guardado y recuperación ante fallos.

Los servicios de cuenta, correo e IA se simularon en las pruebas de navegador. Estas pruebas no verifican la afiliación privada de una cuenta, entregas reales de correo ni cuotas reales de proveedores.

Los nuevos recorridos quedaron incorporados a `npm run test:browser`. Para ejecutarlos se necesita Chromium de Playwright o indicar su ejecutable mediante `SETUP_BROWSER`.

## Pasos manuales y recuperación

Esta ronda no cambia SQL ni servicios de Supabase y no requiere pasos manuales nuevos. Se mantienen los pendientes de la revisión anterior: actualizar las cuatro funciones de IA, comprobar la afiliación ESAN y revisar Brevo si el panel lo solicita. El detalle está en [la guía de cierre](cierre-y-recuperacion-2026-11-03.md#3-lo-que-queda-manual).

El estado anterior a esta ronda es `e657ba457b71b43e6a02753610eb0b88f4107fb6`. Para retirar una corrección concreta, utiliza `git revert SHA_DEL_COMMIT` sobre `main`, comprueba el resultado y publica el nuevo commit. Esto conserva el historial; los cinco commits de corrección están enlazados arriba.
