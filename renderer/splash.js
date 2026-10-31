/*
 * Pantalla de carga con el logo animado.
 * Línea de tiempo: zoom dinámico -> el logo se inclina un poco y guiña el ojo derecho
 * (con partículas) -> aparece el nombre y una barra fina -> se desvanece y deja ver el launcher.
 *
 * Uso: <link rel="stylesheet" href="splash.css"> en el <head> y
 *      <script src="splash.js"></script> justo después de abrir el <body>.
 */
(() => {
  "use strict";

  const TOTAL = 3600;      // ms que dura la animación antes de salir (cámbialo si la quieres más corta o larga)
  const EXIT = 560;        // ms de la salida (desvanecido)
  const WINK_AT = 1500;    // ms en los que empieza el guiño
  const WINK_DUR = 620;    // ms que dura el guiño
  const COLORS = ["#ffffff", "#e6e6e6", "#c3c3c3", "#9a9a9a", "#777777"];

  const LOGO_SVG = `
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M62.115 889.818 L961.963 889.818 L961.963 961.268 L62.115 961.268 Z" class="sp-c1"/>
  <path d="M5.325 5.685 L1019.916 5.685 L1019.916 889.818 L5.325 889.818 Z" class="sp-c2"/>
  <path d="M133.7 132.897 L896.406 132.897 L896.406 765.237 L133.7 765.237 Z" class="sp-c3"/>
  <path d="M174.015 174.396 L850.142 174.396 L850.142 765.237 L174.015 765.237 Z" class="sp-c4"/>
  <g class="sp-eye-r"><path d="M624.425 399.713 L737.249 399.713 L737.249 624.878 L624.425 624.878 Z" class="sp-c5"/></g>
  <g class="sp-eye-l"><path d="M287.532 399.095 L399.331 399.095 L399.331 623.883 L287.532 623.883 Z" class="sp-c5"/></g>
</svg>`;

  function play() {
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduce ? 1100 : TOTAL;

    const root = document.createElement("div");
    root.id = "splash";
    root.innerHTML =
      '<div class="sp-glow"></div>' +
      '<div class="sp-stage">' +
      '<div class="sp-logo">' + LOGO_SVG + "</div>" +
      '<div class="sp-title"></div>' +
      '<div class="sp-bar"><i></i></div>' +
      "</div>";
    (document.body || document.documentElement).prepend(root);
    document.documentElement.classList.add("splash-active");
    document.documentElement.classList.remove("splash-done");

    const $ = (s) => root.querySelector(s);
    const logo = $(".sp-logo"), glow = $(".sp-glow"), title = $(".sp-title");
    const bar = $(".sp-bar"), fill = $(".sp-bar i"), eyeR = $(".sp-eye-r");

    title.textContent = document.title || "Launcher";
    if (window.api && typeof window.api.getBranding === "function") {
      window.api.getBranding().then((b) => { if (b && b.title) title.textContent = b.title; }).catch(() => {});
    }

    const A = (el, keyframes, opts) => el.animate(keyframes, Object.assign({ fill: "both" }, opts));
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    let finished = false;
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));

    if (reduce) {
      A(logo, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      A(title, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
    } else {
      // Logo: zoom dinámico, se inclina un poco hacia el ojo que guiña y vuelve con un pequeño rebote
      A(logo, [
        { opacity: 0, transform: "scale(0.55) rotate(0deg)", filter: "blur(12px)", offset: 0, easing: "cubic-bezier(.2,.8,.2,1)" },
        { opacity: 1, transform: "scale(1.12) rotate(0deg)", filter: "blur(0px)", offset: 0.17, easing: "ease-in-out" },
        { opacity: 1, transform: "scale(1) rotate(0deg)", filter: "blur(0px)", offset: 0.31, easing: "ease-in-out" },
        { opacity: 1, transform: "scale(1.07) rotate(4deg)", filter: "blur(0px)", offset: 0.42, easing: "linear" },
        { opacity: 1, transform: "scale(1.07) rotate(4deg)", filter: "blur(0px)", offset: 0.6, easing: "cubic-bezier(.3,1.4,.5,1)" },
        { opacity: 1, transform: "scale(1) rotate(0deg)", filter: "blur(0px)", offset: 0.74, easing: "linear" },
        { opacity: 1, transform: "scale(1) rotate(0deg)", filter: "blur(0px)", offset: 1 },
      ], { duration: total });

      // Ojo derecho: guiño (se cierra rápido, se queda un instante y se abre) con un destello
      A(eyeR, [
        { transform: "scaleY(1)", filter: "brightness(1)", offset: 0, easing: "cubic-bezier(.5,0,.9,.4)" },
        { transform: "scaleY(0.07)", filter: "brightness(1.6)", offset: 0.32, easing: "linear" },
        { transform: "scaleY(0.07)", filter: "brightness(1.6)", offset: 0.62, easing: "cubic-bezier(.2,.8,.2,1)" },
        { transform: "scaleY(1)", filter: "brightness(1)", offset: 1 },
      ], { delay: WINK_AT, duration: WINK_DUR });

      // Resplandor suave detrás del logo
      A(glow, [
        { opacity: 0, transform: "scale(0.6)", offset: 0 },
        { opacity: 0.9, transform: "scale(1)", offset: 0.2 },
        { opacity: 0.5, transform: "scale(1)", offset: 0.4 },
        { opacity: 1, transform: "scale(1.06)", offset: 0.5 },
        { opacity: 0.6, transform: "scale(1)", offset: 0.75 },
        { opacity: 0.6, transform: "scale(1)", offset: 1 },
      ], { duration: total, easing: "ease-in-out" });

      // Nombre y barra fina de progreso
      A(title, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }],
        { delay: 1700, duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
      A(bar, [{ opacity: 0 }, { opacity: 1 }], { delay: 1900, duration: 400 });
      A(fill, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
        { delay: 1900, duration: Math.max(600, total - 1900 - 150), easing: "cubic-bezier(.4,0,.2,1)" });

      // Partículas al guiñar (salen del ojo hacia arriba y a la derecha, con algo de gravedad)
      const burst = (n) => {
        if (finished) return;
        const r = eyeR.getBoundingClientRect();
        const h = root.getBoundingClientRect();
        const cx = r.left + r.width / 2 - h.left;
        const cy = r.top + r.height / 2 - h.top;
        for (let i = 0; i < n; i++) {
          const p = document.createElement("i");
          const s = 3 + Math.random() * 6;
          p.className = "sp-particle";
          p.style.cssText = "left:" + cx + "px;top:" + cy + "px;width:" + s + "px;height:" + s + "px;background:" +
            COLORS[(Math.random() * COLORS.length) | 0];
          root.appendChild(p);
          const ang = ((-105 + Math.random() * 135) * Math.PI) / 180;
          const dist = 50 + Math.random() * 130;
          const dx = Math.cos(ang) * dist;
          const dy = Math.sin(ang) * dist + 24 + Math.random() * 34;
          const rot = (Math.random() - 0.5) * 360;
          const a = p.animate([
            { transform: "translate(-50%,-50%) translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
            { transform: "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg) scale(0.2)", opacity: 0 },
          ], { duration: 650 + Math.random() * 650, easing: "cubic-bezier(.12,.75,.3,1)", fill: "forwards" });
          a.onfinish = () => p.remove();
        }
      };
      later(() => burst(20), WINK_AT + 110);
      later(() => burst(8), WINK_AT + Math.round(WINK_DUR * 0.62));
    }

    // Salida: el logo se acerca un poco mientras todo se desvanece y aparece el launcher
    const exit = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      document.documentElement.classList.remove("splash-active"); // la interfaz empieza a entrar en este momento
      A(logo, [{ transform: getComputedStyle(logo).transform === "none" ? "scale(1)" : getComputedStyle(logo).transform }, { transform: "scale(1.18)" }],
        { duration: EXIT, easing: "cubic-bezier(.4,0,1,1)" });
      const out = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: EXIT, easing: "ease", fill: "forwards" });
      root.style.pointerEvents = "none";
      out.onfinish = () => {
        root.remove();
        document.documentElement.classList.remove("splash-active");
        document.documentElement.classList.add("splash-done");
        window.dispatchEvent(new Event("splash:done"));
        resolveDone();
      };
    };
    later(exit, total);
    later(exit, total + 4000); // seguro: nunca se queda pegada

    const skip = () => exit();
    root.addEventListener("click", skip);
    window.addEventListener("keydown", skip, { once: true });
    return { done, skip };
  }

  window.splash = { play, skip: () => { const r = document.getElementById("splash"); if (r) r.click(); } };
  if (!window.SPLASH_MANUAL) play();
})();
