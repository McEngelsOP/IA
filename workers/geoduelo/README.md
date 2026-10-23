# Geoduelo en Cloudflare

Este módulo forma parte del workspace npm raíz. Desde la raíz, `npm ci` instala sus dependencias junto con las de Lyra y `npm run test:worker` comprueba motor y Durable Objects con servicios simulados. Se conserva la versión fijada de Wrangler.


Servidor autoritativo de los once modos de Geoduelo, selección del anfitrión y duelos mixtos. Configuración, SQL manual, despliegue, comportamiento y pruebas: [guía completa](../../docs/geoduelo-online.md).

No cargar credenciales en `wrangler.jsonc`. Los secretos se configuran con `wrangler secret put`.
