-- ============================================================
-- Sílabo IA · Cerrar la fuga de correos
-- La función email_for_student_code devolvía el correo real de
-- cualquier código de alumno a quien la llamara, incluso sin
-- cuenta. Ahora esa búsqueda vive en la Edge Function
-- auth-by-code (solo servidor), así que se revoca el acceso.
--
-- ⚠️ ORDEN IMPORTANTE — ejecutar este archivo SOLO después de:
--   1) Desplegar la Edge Function auth-by-code
--   2) Publicar la nueva versión de la app en Vercel
--   3) Probar que login, registro y recuperación funcionan
-- Si se ejecuta antes, el login de la versión vieja deja de servir.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 07 · Cerrar fuga de correos
-- ============================================================

revoke execute on function public.email_for_student_code(text)
  from public, anon, authenticated;
