# Recursos de Geoduelo

- Motor: adaptación del `Geoduelo.html` entregado por Engels para integrarlo en IA.
- `d3.v3.min.js`: D3 3.5.17, https://cdn.jsdelivr.net/npm/d3@3.5.17/d3.min.js. Licencia BSD de tres cláusulas en `D3-LICENSE.txt`.
- `../world.json`: topología extraída sin modificar las coordenadas de `Datamap.prototype.worldTopo` de Datamaps 0.5.9, https://cdn.jsdelivr.net/npm/datamaps@0.5.9/dist/datamaps.world.min.js. Licencia MIT en `DATAMAPS-LICENSE.txt`. Datamaps utiliza cartografía de Natural Earth.
- `../fonts/`: Archivo variable, Hanken Grotesk variable y DM Mono 400/500, subconjunto latino en WOFF2, distribuidos por Google Fonts. Licencias SIL Open Font License en `Archivo-OFL.txt`, `Hanken-Grotesk-OFL.txt` y `DM-Mono-OFL.txt`.
- `../cover.svg`: geometría calculada desde `world.json`, con la proyección ortográfica de D3. Composición basada en la referencia visual aportada por Engels. Las cifras 120/95 son ilustrativas.

Todas las dependencias se sirven desde el mismo sitio; no se carga código de terceros durante la partida.
