(()=>{const mobile=matchMedia('(max-width:860px)');const leave=()=>{if(mobile.matches)location.replace('/pagina.html')};leave();mobile.addEventListener('change',leave)})();
