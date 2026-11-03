# Lyra Android — primera beta

Aplicación Android con interfaz empaquetada mediante Capacitor 8.6.0. Identificador estable: `app.lyra.campus`; versión `0.1.0-beta.1`, código 1. Android mínimo: 7.0 (API 24), con Android System WebView actualizado. No requiere crear otra cuenta: utiliza las mismas cuentas y datos de la web. La sincronización, IA y operaciones de cuenta requieren internet.

## Preparación y compilación

Instala Node 22 y Android Studio con JDK 21, SDK 36 y Build Tools 36. Configura `ANDROID_HOME`. Ejecuta `npm ci`. Crea `.env.android.local` (ignorado por git) con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` públicos del proyecto de producción. Nunca uses `service_role`.

Ejecuta `npm run android:apk`. El resultado sin firmar queda en `android/app/build/outputs/apk/release/app-release-unsigned.apk`. `npm run android:sync` solo prepara y copia la interfaz. No subas `dist-android`, `.env`, salidas Gradle ni claves al repositorio.

Cuando esta rama se integre en main, el flujo manual estará disponible en GitHub Actions. Para usarlo, configura las variables públicas del repositorio `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, abre el flujo **Android APK de prueba**, selecciona esta rama y ejecútalo manualmente. Su artefacto requiere firma antes de instalar; el APK de la primera entrega ya está firmado por separado.

## Firma y actualizaciones

El respaldo privado entregado contiene el keystore y su contraseña. Guárdalo en un lugar privado, fuera de GitHub. Firma futuras versiones con el mismo certificado e identificador, incrementando `versionCode`. Usa `zipalign` y `apksigner` de Android Build Tools; comprueba el resultado con `apksigner verify --verbose --print-certs`. Nunca publiques una clave ni su contraseña en un workflow o commit.

## Acceso y enlaces por correo

La primera beta usa `https://l-esan.vercel.app/login.html` para confirmar el correo o recuperar la contraseña. El proceso se completa en el navegador y después el alumno vuelve a la aplicación. No necesita SQL ni modificar las redirecciones actuales.

También está implementado el retorno `app.lyra.campus://auth/callback`, tanto en arranque en frío como con la aplicación abierta. Para activarlo, añade exactamente esa URL a Supabase → Authentication → URL Configuration → Redirect URLs y configura `VITE_ANDROID_AUTH_CALLBACK=app.lyra.campus://auth/callback` antes de recompilar. No actives esta opción antes de autorizar la URL.

## Archivos y servicios

PDF del registro académico, malla Markdown y CSV usan el menú nativo de guardar/compartir. El proveedor de archivos solo permite compartir `cache/exports/`, no todo el almacenamiento. Los archivos y sesiones de la app no se incluyen en copias de seguridad Android. El buzón y las comunicaciones conservan los endpoints HTTPS de producción y su autorización; las claves administrativas permanecen en el servidor. Los enlaces externos se abren en el navegador del sistema. La app no solicita permisos generales de almacenamiento.

## Prueba en un teléfono

1. Descarga el APK firmado. Android puede pedir permiso para instalar desde el navegador o gestor de archivos.
2. Abre Lyra e ingresa con una cuenta existente; comprueba Inicio, Malla, Mi semestre y Asistente.
3. Prueba el botón Atrás y el teclado, importación de PDF/Excel, exportación del registro y guardar/compartir.
4. Prueba confirmación y recuperación desde el correo en el navegador y vuelve a Lyra.
5. Cierra y abre la app y comprueba que tus datos se conservan. Para actualizar, instala el siguiente APK firmado encima del anterior.

La compilación y los flujos se verifican automáticamente con datos simulados; la instalación, teclado, selector de archivos y menú de compartir requieren además la prueba en un dispositivo Android real antes de distribuir a alumnos o presentar a Galaxy Store. Esta beta no incorpora notificaciones push ni actualización silenciosa del APK. La interfaz incluida se actualiza instalando una nueva versión; los datos del servidor se sincronizan al conectarse.
