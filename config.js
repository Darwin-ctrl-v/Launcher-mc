// Configuración del launcher.
// Si cambias algo aquí y ya generaste el .exe, hay que volver a generarlo (npm run build).
module.exports = {
  appName: ".LauncherNotx",       // nombre de la carpeta en AppData donde se guardan versiones e instalaciones
  minecraft: "1.21.1",           // solo se usa si el Gist no define instalaciones
  loader: "fabric",

  // URL del archivo mods.json (enlace "Raw" de tu Gist). Ahí defines las INSTALACIONES:
  // cada una con su nombre, imagen, versión de Minecraft y lista de mods.
  // Así puedes añadir o quitar instalaciones y mods sin volver a compilar el launcher.
  // Formato (la instalación con id "principal" usa la carpeta de siempre, no pierde sus mundos):
  //   { "instances": [ { "id": "principal", "name": "Principal", "image": "https://...png",
  //                      "minecraft": "1.21.1", "loader": "fabric", "mods": ["sodium", "lithium"] } ] }
  // El formato viejo (["sodium", "lithium"]) sigue funcionando como una sola instalación.
  // Opcional por instalación: "pack": { "url": "https://...pack.zip", "version": "1", "once": ["options.txt"] }
  //   un .zip con carpetas/archivos (config, options.txt...) que se copian a la instalación antes de jugar.
  //   Se vuelve a instalar cuando cambias "version"; lo que pongas en "once" solo se copia si no existe.
  modsUrl: "https://gist.githubusercontent.com/Darwin-ctrl-v/efe67e29582bc129f9bd4fe40b952f41/raw/mods.json",

  // Mods por defecto (o de respaldo si no hay conexión a GitHub):
  mods: [
    "sodium",
    "lithium",
    "iris",
    "ok-zoomer",
    "modmenu",
    "ferrite-core",
  ],
  userAgent: "tunombre/mi-launcher/0.2.0", // CAMBIA ESTO por algo tuyo (lo pide Modrinth)
  ram: { min: "2G", max: "4G" },
  javaMajor: 21,                  // Java por defecto; cada instalación calcula el suyo según su versión de Minecraft

  // ---- Apariencia (lo que se ve en la ventana) ----
  branding: {
    title: "Launcher Insano",
    subtitle: "El Mejor Launcher xdd",
    accentColor: "#ffffff",       // color del botón Jugar y de la barra (formato #rrggbb)
    news: [
      "¡Bienvenidos! Esta es la primera versión del launcher.",
      "Por ahora incluye Sodium. Pronto, más mods.",
    ],
  },
};
