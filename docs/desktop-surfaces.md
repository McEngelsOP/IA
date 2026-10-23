# Superficies del portal

Un mismo portal responsive compone las funciones en `src/app/portal.js` y carga React bajo demanda. La referencia de arquitectura vigente es `CONTEXT.md`.

| Superficie | Implementación |
| --- | --- |
| Mi carrera | `src/features/career/OfficialCurriculum.jsx` |
| Mi semestre | `src/features/semester/OfficialCalendar.jsx` y notas compartidas de Inicio |
| Planificar | `src/features/planning/OfficialRoadmap.jsx` |
| Asistente y recursos | Composición en `src/app/AcademicWorkspace.jsx` |
| Grupos | `src/features/groups/OfficialStudyGroups.jsx` |
| Buzón | `src/features/support/OfficialMailbox.jsx` |
| Focus | Estado del portal y `src/features/focus/focusModel.js` |

Se conservan identidad, temas, logo, paloma y animaciones del lateral. El lateral se compacta en escritorio y usa un desplegable en móvil. Las funciones académicas reciben la misma carrera, revisión y estados privados que Inicio.

Las proyecciones declaran aprobación condicional de matriculados y requisitos de electivos por verificar. El asistente explica con catálogo de servidor. El buzón conserva su integración de envío mediante `/api/mailbox`. Los errores mantienen datos y borradores.
