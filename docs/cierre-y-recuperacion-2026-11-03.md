# Cierre y recuperación de Lyra · 3 de noviembre de 2026

Primero se cerró la revisión general de errores. Después se comprobó que los cambios de Inicio, personalización y acceso funcionan junto a esas correcciones. La comprobación adicional no encontró nuevos fallos en los recorridos revisados.

## 1. Revisión original de errores

| Corrección | Commit |
| --- | --- |
| Evitar que una respuesta atrasada revierta preferencias guardadas | `7bca335` |
| PDF: promedio institucional y rechazo de lecturas incompletas | `00c392b` |
| Dependencias vulnerables y compatibilidad del Worker/lector PDF | `0ffa6df` |
| Diagnóstico de Brevo, configuración y bloqueo de acciones simultáneas | `acdbc4d` |
| Paginación del historial de grupos y código duplicado sin uso | `cde05c4` |
| Etiquetas accesibles del importador de mallas | `4f08bf5` |
| Publicación secundaria de GitHub Pages solo manual | `c8145f1` |

Las 165 pruebas de aplicación/SQL y las 4 pruebas del Worker pasaron. El catálogo reproducible, la compilación y la revisión del repositorio también pasaron. La auditoría de dependencias terminó con cero alertas. La validación de GitHub del commit `c8145f1` terminó correctamente con Node 22; Vercel lo publicó en producción.

## 2. Comprobación de Inicio y acceso

| Cambio | Commit |
| --- | --- |
| Mantener oscuro el acceso al salir del portal claro | `95577f7` |
| Explicar la afiliación ESAN y actualizar el acceso desde Mi IA | `9325bb3` |
| Tamaños por esquina y botones, adaptación en vivo, deshacer y movimiento | `379039b` |
| Guía general de revisión y pasos manuales | `3d20ae7` |

Pasaron los 13 recorridos de navegador en desarrollo. Además, se compiló la aplicación con datos de prueba y se sirvió mediante la vista previa de producción para comprobar estos seis recorridos sobre los archivos compilados:

- Semestre, planificación, catálogo y exportación académica.
- Fichas de cursos, profesores y comentarios de Recursos.
- Preferencias entre dispositivos, reportes y comunicaciones de administración.
- Acceso, caducidad de sesión y cierre sin conexión.
- Importación de mallas, personalización de Inicio, tamaños y acceso oscuro.
- Mi IA, verificación administrativa, modos y gestión de claves personales.

Estas comprobaciones utilizaron servicios simulados: no enviaron correos ni consumieron proveedores de IA reales. No confirman el estado individual de afiliación de una cuenta. Los tamaños por esquina también se probaron con mouse, tacto y teclado, cancelación, deshacer, recuperación y nueva visita, en 1440, 390 y 320 px.

## 3. Lo que queda manual

1. **Actualizar los cuatro servicios de IA en Supabase:** `study-advisor`, `text-to-tasks`, `excel-schedule` y `personal-ai`. Las fuentes desplegadas conservan el enrutamiento anterior. Los comandos y el orden están en [la guía de revisión](revision-main-2026-11-03.md#actualización-manual-pendiente-de-los-servicios-de-ia).
2. **Comprobar tu cuenta en Perfil → Mi IA:** si la afiliación ESAN está verificada, selecciona **Servicio de la app**. Si está pendiente y tu sesión es administradora, usa **Verificar afiliación ESAN → Usar mi cuenta**, revisa la prueba institucional, marca la confirmación y pulsa **Verificar por 180 días**. Registrarse como ESAN no completa automáticamente esa verificación.
3. **Brevo, si el panel indica configuración pendiente o rechazo:** revisa las variables y el remitente verificado siguiendo [Comunicaciones](communications.md). Después realiza una sola prueba con tu cuenta. La aceptación del proveedor no confirma entrega en la bandeja.

Estos cambios no requieren SQL nuevo. La ejecución manual de SQL de otros entornos se mantiene según sus guías; no se deben ejecutar todos los archivos históricos.

## 4. Puntos de recuperación

| Referencia | Estado |
| --- | --- |
| `02a41b47ec707594ed0738c3ebcbe6299ea4f266` | Estado anterior a los 11 commits de esta revisión |
| `c8145f14561cc9ff732de95b8637cea85589b856` | Cierre comprobado: correcciones, Inicio/acceso, CI correcto y Vercel publicado |

### Volver al cierre comprobado después de cambios posteriores

Desde una copia sin cambios locales pendientes, estos comandos revierten todos los commits posteriores a `c8145f1`. Conservan el historial y generan un nuevo commit de restauración:

```bash
git switch main
git pull --ff-only
git revert --no-commit c8145f14561cc9ff732de95b8637cea85589b856..HEAD
git commit -m "Restaurar el cierre comprobado de Lyra"
npm ci
npm run check
git push origin main
```

Si Git informa un conflicto, hay que resolverlo antes de continuar; `git revert --abort` cancela esa operación. El rango incluye todos los cambios posteriores al punto indicado: úsalo cuando quieras volver a ese conjunto completo.

### Deshacer los 11 commits y volver al estado anterior

El rango exacto de la revisión es:

```bash
git revert --no-commit 02a41b47ec707594ed0738c3ebcbe6299ea4f266..c8145f14561cc9ff732de95b8637cea85589b856
git commit -m "Revertir la revisión general de noviembre"
npm ci
npm run check
git push origin main
```

Se ensayó ese rango en una copia temporal y se comprobó que recupera exactamente el árbol `b98c3ca6ddb4863422a746e01ad243ec57bad49d` del estado anterior. Este documento de cierre es posterior a ese rango y puede conservarse como referencia. Las publicaciones manuales posteriores de Edge Functions se revierten desplegando sus fuentes de la revisión elegida; una reversión de Git no cambia el servidor de Supabase.
