// Fondo minimalista: la animación (auras grises que se mueven muy despacio) es solo CSS.
// Aquí únicamente se pausa mientras juegas, para no gastar recursos.
(() => {
  window.setBackgroundPaused = (v) => document.body.classList.toggle("bg-paused", !!v);
})();
