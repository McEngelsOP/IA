# Diseño del portal Lyra

El portal existente es la referencia visual. Conservar tipografía, temas, paleta, logo Lyra, paloma pixel art y superficies. Los tokens están en `src/app/portal.css` y estilos compartidos; no crear otro sistema visual.

La superficie funciona en modo Operate: facilitar organización y decisiones académicas. Cinco destinos principales, herramientas secundarias y perfil. Mi semestre utiliza pestañas con foco visible y navegación por teclado.

En escritorio el lateral admite ancho completo y compacto, con iconos anclados y transición coordinada de 420 ms. En móvil usa un menú desplegable y navegación inferior. Respetar movimiento reducido.

Mostrar carga, errores, datos vacíos y estados no soportados. Los guardados comunican actividad y evitan acciones simultáneas. Los lienzos y horarios pueden desplazarse dentro de su región; la página no debe desbordar horizontalmente.

La paloma acompaña Inicio sin controles obligatorios. Las simulaciones declaran condiciones y los requisitos por verificar tienen una indicación textual independiente del color.

Inicio mantiene el banner fijo y usa bloques de tamaño pequeño, mediano o completo. Los resúmenes se encajan, con orden accesible y movimiento reducido. El acceso conserva su material transparente en ambos viewports y temas.

El foco de campos y selectores recolorea su borde existente sin cambiar grosor ni dimensiones. `src/shared/styles/FormFocus.css` comparte la regla entre acceso y portal; los buscadores indican foco en su contenedor, sin un segundo aro. Se conservan los indicadores de teclado de botones y enlaces.
