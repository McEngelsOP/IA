// Creepypasta!

// Based on the original 4chan thread.
// No Images - No JavaScript - Pure HTML - Too much CSS!
// Only HTML, CSS and the teeny-tiniest amount of JavaScript required to play sound.

// WARNING! Playing on Safari may result in actual noclip!

// Follow me for more: bsky.app/profile/ivorjetski.bsky.social
// The making of: https://www.youtube.com/watch?v=xiEZ54lGFt8

// Added by AI to support WASD and Arrow Keys:
document.addEventListener('keydown', (e) => {
  let labelSelector = null;
  switch (e.key.toLowerCase()) {
    case 'w': case 'arrowup': labelSelector = 'buttons label.upb'; break;
    case 's': case 'arrowdown': labelSelector = 'buttons label.downb'; break;
    case 'a': case 'arrowleft': labelSelector = 'buttons label.leftb'; break;
    case 'd': case 'arrowright': labelSelector = 'buttons label.rightb'; break;
    default: return;
  }
  
  if (labelSelector) {
    const labels = Array.from(document.querySelectorAll(labelSelector));
    
    // Filter out explicitly hidden elements
    const validLabels = labels.filter(l => {
      const s = window.getComputedStyle(l);
      return s.display !== 'none' && s.pointerEvents !== 'none' && s.opacity !== '0';
    });
    
    if (validLabels.length > 0) {
      let maxZ = -999;
      validLabels.forEach(l => {
        const z = parseInt(window.getComputedStyle(l).zIndex) || 0;
        if (z > maxZ) maxZ = z;
      });
      
      const topLabels = validLabels.filter(l => (parseInt(window.getComputedStyle(l).zIndex) || 0) === maxZ);
      const target = topLabels[topLabels.length - 1]; // Last in DOM is on top
      
      if (target) target.click();
    }
  }
});

// Hide the visual on-screen arrows (opacity 0 on parent so children compute normally)
const style = document.createElement('style');
style.textContent = `buttons { opacity: 0 !important; }`;
document.head.appendChild(style);