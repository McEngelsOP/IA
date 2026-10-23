# Diseño del portal Lyra

El portal existente es la referencia visual. Conservar tipografía, temas, paleta, logo Lyra, paloma pixel art y superficies. Los tokens están en `src/app/portal.css` y estilos compartidos; no crear otro sistema visual.

La superficie funciona en modo Operate: facilitar organización y decisiones académicas. Cinco destinos principales, herramientas secundarias y perfil. Mi semestre utiliza pestañas con foco visible y navegación por teclado.

En escritorio el lateral admite ancho completo y compacto, con iconos anclados y transición coordinada de 420 ms. En móvil usa un menú desplegable y navegación inferior. Respetar movimiento reducido.

Mostrar carga, errores, datos vacíos y estados no soportados. Los guardados comunican actividad y evitan acciones simultáneas. Los lienzos y horarios pueden desplazarse dentro de su región; la página no debe desbordar horizontalmente.

La paloma acompaña Inicio sin controles obligatorios. Las simulaciones declaran condiciones y los requisitos por verificar tienen una indicación textual independiente del color.
