const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { execFile } = require("child_process");
const { Client } = require("minecraft-launcher-core");
const config = require("./config");

const MODRINTH = "https://api.modrinth.com/v2";
const headers = { "User-Agent": config.userAgent };



async function getJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} -> ${url}`);
  return res.json();
}

/* ---------------- Login con Microsoft (MSMC) ---------------- */

async function getAuthClass() {
  const m = await import("msmc"); // import dinámico: funciona sea ESM o CJS
  return m.Auth || (m.default && m.default.Auth);
}

async function loginMicrosoft() {
  const Auth = await getAuthClass();
  const authManager = new Auth("select_account");
  const xbox = await authManager.launch("electron");
  const mc = await xbox.getMinecraft();
  return { auth: mc.mclc(), saved: xbox.save(), name: mc.profile.name };
}

async function loginSaved(savedToken) {
  const Auth = await getAuthClass();
  const authManager = new Auth("select_account");
  const xbox = await authManager.refresh(savedToken);
  const mc = await xbox.getMinecraft();
  return { auth: mc.mclc(), saved: xbox.save(), name: mc.profile.name };
}

/* ---------------- Java ---------------- */

// Qué Java necesita cada versión de Minecraft (se puede forzar con "java": 17 en el Gist)
function javaMajorFor(minecraft, override) {
  if (Number(override) > 0) return Number(override);
  const p = String(minecraft).split(".").map((n) => parseInt(n, 10) || 0);
  if (p[0] !== 1) return p[0] >= 26 ? 25 : 21; // versiones nuevas (26.x) y snapshots
  const minor = p[1] || 0;
  const patch = p[2] || 0;
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21; // 1.20.5 y posteriores
  if (minor >= 17) return 17; // 1.17 a 1.20.4
  return 8; // 1.16 y anteriores
}

const javaCache = new Map();
function javaMajor(bin) {
  if (javaCache.has(bin)) return javaCache.get(bin);
  const p = new Promise((resolve) => {
    execFile(bin, ["-version"], { timeout: 8000 }, (err, stdout, stderr) => {
      const out = `${stderr || ""}${stdout || ""}`;
      const m = /version "(\d+)(?:\.(\d+))?/.exec(out);
      if (!m) return resolve(null);
      resolve(m[1] === "1" ? Number(m[2]) : Number(m[1]));
    });
  });
  javaCache.set(bin, p);
  p.then((v) => { if (!v) javaCache.delete(bin); }); // si no se encontró, la próxima vez se vuelve a probar
  return p;
}

const ls = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };

function javaCandidates() {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const list = [];
  const add = (p) => { if (p && !list.includes(p)) list.push(p); };
  if (process.env.JAVA_HOME) add(path.join(process.env.JAVA_HOME, "bin", exe));

  if (process.platform === "win32") {
    // Java que trae el launcher oficial de Minecraft (java-runtime-delta = 21, -beta/-gamma = 17, jre-legacy = 8...)
    const roots = [];
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, ".minecraft", "runtime"));
    if (process.env.LOCALAPPDATA) {
      roots.push(path.join(process.env.LOCALAPPDATA, "Packages", "Microsoft.4297127D64EC6_8wekyb3d8bbwe", "LocalCache", "Local", "runtime"));
    }
    for (const root of roots) {
      for (const name of ls(root)) {
        for (const plat of ls(path.join(root, name))) add(path.join(root, name, plat, name, "bin", exe));
      }
    }
    // Instalaciones típicas (Temurin / Microsoft / Java / Zulu / Corretto...)
    const pf = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
    for (const p of pf) {
      for (const vendor of ["Eclipse Adoptium", "Microsoft", "Java", "Zulu", "Amazon Corretto", "BellSoft", "Semeru"]) {
        for (const d of ls(path.join(p, vendor))) add(path.join(p, vendor, d, "bin", exe));
      }
    }
  }
  add("java"); // el que esté en el PATH
  return list;
}

// Busca el Java exacto que pide la versión; si no hay, el más cercano que sea más nuevo
async function findJava(major = config.javaMajor) {
  const found = await Promise.all(javaCandidates().map(async (c) => ({ c, v: await javaMajor(c) })));
  const ok = found.filter((x) => x.v);
  const exact = ok.find((x) => x.v === major);
  if (exact) return exact.c;
  const higher = ok.filter((x) => x.v > major).sort((a, b) => a.v - b.v)[0];
  return higher ? higher.c : null;
}

/* ---------------- Fabric ---------------- */

function localFabric(root, mc) {
  const dir = path.join(root, "versions");
  const ids = ls(dir).filter((d) => d.startsWith("fabric-loader-") && d.endsWith(`-${mc}`) && fs.existsSync(path.join(dir, d, `${d}.json`)));
  return ids.sort().pop() || null;
}

// Descarga el perfil de Fabric y lo deja en <root>/versions/<id>/<id>.json
async function ensureFabric(root, mc) {
  try {
    const loaders = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${mc}`);
    if (!loaders.length) throw new Error(`Fabric todavía no está disponible para Minecraft ${mc}`);
    const elegido = loaders.find((l) => l.loader.stable) || loaders[0];
    const loaderVersion = elegido.loader.version;
    const id = `fabric-loader-${loaderVersion}-${mc}`;
    const dir = path.join(root, "versions", id);
    const file = path.join(dir, `${id}.json`);

    if (!fs.existsSync(file)) {
      const profile = await getJSON(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loaderVersion}/profile/json`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(profile, null, 2));
    }
    return id;
  } catch (e) {
    const local = localFabric(root, mc); // sin conexión: se usa el Fabric que ya está descargado
    if (local) return local;
    throw e;
  }
}

/* ---------------- Instalaciones (las define el Gist) ---------------- */

async function fetchRemoteJSON() {
  let rawUrl = (config.modsUrl || "").trim();
  if (!rawUrl) throw new Error("No hay modsUrl en config.js");
  // Si es un enlace de Gist con hash de commit (/raw/<40-chars-hash>/archivo.json),
  // lo convertimos a /raw/archivo.json para que SIEMPRE descargue los cambios más recientes.
  rawUrl = rawUrl.replace(/(gist\.githubusercontent\.com\/[^/]+\/[^/]+\/raw\/)[a-f0-9]{40}\//i, "$1");

  const url = rawUrl + (rawUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent, "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} -> ${rawUrl}`);
  const text = await res.text();
  // Tolerar comas finales como ["mod1", "mod2",] para que no falle el JSON
  return JSON.parse(text.replace(/,\s*([\]}])/g, "$1"));
}

// Convierte un enlace de página de GitHub (/blob/...) en el enlace directo (raw) del archivo
function directUrl(url) {
  const u = String(url || "").trim().replace(/^http:/i, "https:");
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i.exec(u);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : u;
}

// "pack": enlace a un .zip con carpetas/archivos que se copian a la carpeta de la instalación (config, options.txt...)
function normalizePack(p) {
  if (!p) return null;
  const obj = typeof p === "string" ? { url: p } : p;
  if (!obj || typeof obj !== "object" || !obj.url) return null;
  const url = directUrl(obj.url);
  if (!/^https:\/\//i.test(url)) return null;
  return {
    url,
    version: obj.version != null ? String(obj.version) : "",
    once: Array.isArray(obj.once) ? obj.once.map((x) => String(x).replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "").toLowerCase()).filter(Boolean) : [],
  };
}

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
const cleanMods = (list) => (Array.isArray(list) ? list.map((s) => String(s).trim()).filter(Boolean) : []);

function defaultInstance(mods) {
  return {
    id: "default",
    name: (config.branding && config.branding.title) || "Minecraft",
    image: "",
    description: "",
    minecraft: config.minecraft,
    loader: String(config.loader || "fabric").toLowerCase(),
    java: null,
    pack: null,
    mods: mods || cleanMods(config.mods),
  };
}

// Acepta el formato nuevo ({ "instances": [...] }) y el viejo (["sodium", ...] o { "mods": [...] })
function normalizeInstances(data) {
  if (data && Array.isArray(data.instances)) {
    const seen = new Set();
    const out = [];
    for (const raw of data.instances) {
      if (!raw || typeof raw !== "object") continue;
      const id = slugify(raw.id || raw.name);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name: String(raw.name || id),
        image: raw.image ? directUrl(raw.image) : "",
        description: raw.description ? String(raw.description) : "",
        minecraft: String(raw.minecraft || config.minecraft),
        loader: String(raw.loader || config.loader || "fabric").toLowerCase(),
        java: Number(raw.java) > 0 ? Number(raw.java) : null,
        pack: normalizePack(raw.pack),
        mods: cleanMods(raw.mods),
      });
    }
    if (out.length) return out;
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.mods) ? data.mods : null;
  if (list && list.length) return [defaultInstance(cleanMods(list))];
  return null;
}

async function fetchInstances() {
  const found = normalizeInstances(await fetchRemoteJSON());
  if (!found) throw new Error("El archivo del Gist está vacío o no tiene un formato válido");
  return found;
}

// Si no hay Gist ni copia guardada: una sola instalación con lo que diga config.js
const fallbackInstances = () => [defaultInstance()];

/* ---------------- Mods (Modrinth) ---------------- */

async function resolveMods(slugs, mc, loader) {
  const found = new Map(); // project_id -> datos del mod
  const g = encodeURIComponent(JSON.stringify([mc]));
  const l = encodeURIComponent(JSON.stringify([loader]));

  async function add(idOrSlug, esDependencia, specificVersionId) {
    let cleanId = idOrSlug;
    let targetVer = specificVersionId || null;
    let pinned = false; // true cuando TÚ pides una versión concreta en el Gist

    // Soporte para especificar versión como "sodium@0.6.0" o "sodium:0.6.0"
    if (!targetVer && typeof idOrSlug === "string" && /[@:]/.test(idOrSlug)) {
      const parts = idOrSlug.split(/[@:]/);
      cleanId = parts[0].trim();
      targetVer = parts[1].trim();
      pinned = !!targetVer;
    }



    const project = await getJSON(`${MODRINTH}/project/${cleanId}`);
    if (found.has(project.id)) {
      if (!esDependencia) found.get(project.id).dependency = false; // lo pediste tú: no es solo librería
      return;
    }

    const versions = await getJSON(`${MODRINTH}/project/${project.id}/version?game_versions=${g}&loaders=${l}`);

    let v = null;
    if (targetVer) {
      v = versions.find((x) => x.id === targetVer || (x.version_number && x.version_number.includes(targetVer)));
    }
    if (!v && pinned) {
      const disp = versions.slice(0, 8).map((x) => x.version_number).join(", ") || "ninguna";
      throw new Error(`"${project.title}": no existe la versión "${targetVer}" para ${mc} + ${loader}. Versiones disponibles: ${disp}`);
    }
    if (!v) {
      v = ["release", "beta", "alpha"].map((t) => versions.find((x) => x.version_type === t)).find(Boolean);
    }
    if (!v) throw new Error(`"${project.title}" no tiene versión compatible para ${mc} + ${loader}`);

    const file = v.files.find((f) => f.primary) || v.files[0];
    found.set(project.id, {
      title: project.title,
      slug: project.slug,
      icon: project.icon_url || null,
      version: v.version_number,
      dependency: !!esDependencia,
      name: file.filename,
      url: file.url,
      sha1: file.hashes.sha1,
    });

    for (const d of v.dependencies) {
      if (d.dependency_type === "required" && d.project_id) {
        await add(d.project_id, true, d.version_id);
      }
    }
  }

  // Los mods con versión fija van primero: así, si otro mod los necesita como dependencia, se respeta tu versión
  const fijo = (x) => /[@:]/.test(String(x));
  for (const s of [...slugs.filter(fijo), ...slugs.filter((x) => !fijo(x))]) await add(s, false);
  return [...found.values()];
}

function sha1File(p) {
  return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
}

async function downloadVerified(url, dest, sha1) {
  if (fs.existsSync(dest) && sha1File(dest) === sha1) return false; // ya está bien
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash("sha1").update(buf).digest("hex");
  if (got !== sha1) throw new Error(`El archivo ${path.basename(dest)} llegó corrupto (hash distinto)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return true;
}

const manifestPath = (gameDir) => path.join(gameDir, "mods-manifest.json");

// Lista de mods que se ve al abrir una instalación
function readModsManifest(gameDir) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(gameDir), "utf8"));
  } catch {
    return null;
  }
}

// gameDir = carpeta de la instalación (aquí van sus mods, mundos y opciones)
async function syncMods(gameDir, inst, onStatus, onProgress) {
  const modsDir = path.join(gameDir, "mods");
  fs.mkdirSync(modsDir, { recursive: true });

  let list;
  try {
    list = await resolveMods(inst.mods, inst.minecraft, inst.loader);
  } catch (e) {
    const hayJars = fs.readdirSync(modsDir).some((f) => f.endsWith(".jar"));
    if (hayJars && /fetch failed|ENOTFOUND|ECONN|network/i.test(String(e.message + e.cause))) {
      onStatus("Sin conexión con Modrinth: se usan los mods ya instalados.");
      return;
    }
    throw e;
  }

  // En instalaciones del Gist se limpian los mods viejos; en instalaciones personalizadas se respetan los mods del usuario
  if (!inst.isCustom) {
    const wanted = new Set(list.map((m) => m.name));
    for (const f of fs.readdirSync(modsDir)) {
      if (f.endsWith(".jar") && !wanted.has(f)) fs.rmSync(path.join(modsDir, f));
    }
  }

  let hechos = 0;
  for (const m of list) {
    onStatus(`Mods: ${m.title}`);
    await downloadVerified(m.url, path.join(modsDir, m.name), m.sha1);
    hechos++;
    if (onProgress) onProgress(hechos / list.length);
  }

  fs.writeFileSync(
    manifestPath(gameDir),
    JSON.stringify(list.map(({ title, slug, version, dependency, name, icon }) => ({ title, slug, version, dependency, name, icon })), null, 2)
  );
}

/* ---------------- Paquete de archivos de la instalación (config, teclas, etc.) ---------------- */

const MAX_PACK_BYTES = 500 * 1024 * 1024;

// Lector de .zip mínimo (sin dependencias): admite archivos "stored" y "deflate"
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("el archivo no es un .zip válido");
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error("el .zip está dañado");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nlen);
    entries.push({ name, flags, method, csize, usize, lho });
    off += 46 + nlen + elen + clen;
  }
  return entries;
}

function zipData(buf, e) {
  if (e.flags & 1) throw new Error(`"${e.name}" está cifrado`);
  if (e.csize === 0xffffffff || e.usize === 0xffffffff) throw new Error("zip64 no está soportado");
  const lho = e.lho;
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error("el .zip está dañado");
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: e.usize + 1024 });
  throw new Error(`"${e.name}" usa una compresión no soportada (${e.method})`);
}

// Lee información de un mod .jar inspeccionando su fabric.mod.json interno
function readModJar(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const entries = readZip(buf);
    const fmj = entries.find((e) => e.name === "fabric.mod.json");
    if (fmj) {
      const json = JSON.parse(zipData(buf, fmj).toString("utf8"));
      let icon = null;
      if (json.icon) {
        const iconPath = String(json.icon).replace(/^\.?\//, "");
        const iconEntry = entries.find((e) => e.name === iconPath || e.name === "assets/" + json.id + "/" + iconPath);
        if (iconEntry) {
          const b = zipData(buf, iconEntry);
          icon = "data:image/png;base64," + b.toString("base64");
        }
      }
      return {
        id: json.id || path.basename(filePath, ".jar"),
        title: json.name || json.id || path.basename(filePath, ".jar"),
        version: json.version || "",
        description: json.description || "",
        icon,
        filename: path.basename(filePath),
      };
    }
  } catch {}
  const base = path.basename(filePath, ".jar");
  return { id: base, title: base, version: "", description: "", icon: null, filename: path.basename(filePath) };
}

// Extrae el zip en destDir. Los archivos de "once" solo se copian si todavía no existen.
function extractZip(buf, destDir, { once = [] } = {}) {
  const entries = readZip(buf);
  const base = path.resolve(destDir);
  const isOnce = (rel) => once.some((o) => rel === o || rel.startsWith(o + "/"));
  let written = 0, kept = 0, skipped = 0, bytes = 0;
  const top = new Set();

  for (const e of entries) {
    const rel = e.name.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
    if (!rel || rel.endsWith("/")) continue; // carpetas: se crean al escribir los archivos
    if (/^[a-z]:/i.test(rel) || rel.startsWith("/") || rel.split("/").includes("..")) {
      throw new Error(`el .zip trae una ruta no permitida: "${e.name}"`);
    }
    const low = rel.toLowerCase();
    // la carpeta mods la gestiona la lista de mods (borra los .jar que no estén en ella)
    if (low.startsWith("mods/") || low.startsWith("__macosx/") || low.endsWith(".ds_store") || low.endsWith("thumbs.db")) { skipped++; continue; }

    bytes += e.usize;
    if (bytes > MAX_PACK_BYTES) throw new Error("el .zip es demasiado grande (más de 500 MB)");

    const target = path.resolve(base, rel);
    if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`el .zip trae una ruta no permitida: "${e.name}"`);
    top.add(rel.split("/")[0]);

    if (isOnce(low) && fs.existsSync(target)) { kept++; continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zipData(buf, e));
    written++;
  }
  return { written, kept, skipped, top: [...top] };
}

// Descarga e instala el paquete de la instalación cuando es nuevo o cuando cambias su "version" en el Gist
async function syncPack(gameDir, inst, onStatus, onLog) {
  const pack = inst.pack;
  if (!pack) return;
  const stateFile = path.join(gameDir, "pack-state.json");
  const want = pack.version || pack.url;
  let state = null;
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  if (state && state.url === pack.url && state.version === want) return; // ya está instalado

  onStatus("Descargando archivos de la instalación...");
  let buf;
  try {
    const res = await fetch(pack.url, { headers, signal: AbortSignal.timeout(15 * 60 * 1000) }); // paquetes grandes: hasta 15 min
    if (!res.ok) throw new Error(`el servidor respondió ${res.status}`);
    // Se lee por partes para poder mostrar el porcentaje mientras baja
    const total = Number(res.headers.get("content-length")) || 0;
    const chunks = [];
    let got = 0;
    let last = -1;
    for await (const chunk of res.body) {
      chunks.push(chunk);
      got += chunk.length;
      if (total) {
        const p = Math.min(100, Math.floor((got * 100) / total));
        if (p !== last) { last = p; onStatus(`Descargando archivos de la instalación... ${p}%`); }
      }
    }
    buf = Buffer.concat(chunks);
  } catch (e) {
    if (state) {
      onLog(`Paquete de "${inst.name}": no se pudo actualizar (${e.message}); se usan los archivos que ya hay.`);
      return;
    }
    throw new Error(`No se pudieron descargar los archivos de "${inst.name}" (${e.message}). Revisa el enlace "pack" del Gist.`);
  }

  onStatus("Instalando archivos de la instalación...");
  let info;
  try {
    info = extractZip(buf, gameDir, { once: pack.once });
  } catch (e) {
    throw new Error(`El paquete de "${inst.name}" no se pudo instalar: ${e.message}`);
  }
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ url: pack.url, version: want }));
  onLog(`Paquete de "${inst.name}": ${info.written} archivos copiados` +
    (info.kept ? `, ${info.kept} conservados (ya existían)` : "") +
    (info.skipped ? `, ${info.skipped} ignorados` : "") +
    ` -> ${info.top.join(", ") || "(vacío)"}`);
  if (info.top.length === 1 && !["config", "resourcepacks", "shaderpacks", "saves", "defaultconfigs", "kubejs", "datapacks"].includes(info.top[0].toLowerCase()) && !/\.(txt|dat|json|toml|cfg|properties)$/i.test(info.top[0])) {
    onLog(`Aviso: el .zip tiene una sola carpeta ("${info.top[0]}"). Si es una carpeta de más, comprime su CONTENIDO y no la carpeta.`);
  }
}

/* ---------------- Lanzar el juego ---------------- */

// root = carpeta compartida (assets, librerías, versiones); gameDir = carpeta propia de la instalación
async function launch({ auth, javaPath, root, gameDir, minecraft, fabricId, ramMB, resWidth, resHeight, jvmArgs, onLog, onProgress, onReady, onClose }) {
  const client = new Client();
  let ready = false;
  const markReady = () => {
    if (!ready) {
      ready = true;
      onReady();
    }
  };

  client.on("debug", (m) => onLog(String(m)));
  client.on("data", (m) => {
    const txt = String(m);
    onLog(txt);
    if (/Setting user:|Backend library|LWJGL/.test(txt)) markReady(); // el juego ya está arrancando
  });
  client.on("progress", (e) => onProgress({ type: e.type, task: e.task, total: e.total }));
  client.on("close", (code) => {
    ready = true;
    onClose(code);
  });

  const launchOpts = {
    authorization: auth,
    root,
    javaPath,
    version: { number: minecraft, type: "release", custom: fabricId },
    memory: { min: `${Math.min(2048, ramMB)}M`, max: `${ramMB}M` },
  };

  // Cada instalación juega en su propia carpeta (mods, mundos, opciones...)
  if (gameDir && path.resolve(gameDir) !== path.resolve(root)) {
    fs.mkdirSync(gameDir, { recursive: true });
    launchOpts.overrides = { gameDirectory: gameDir, cwd: gameDir };
  }

  // Resolución de ventana
  if (resWidth && resHeight) {
    launchOpts.window = { width: resWidth, height: resHeight };
  }

  // Argumentos JVM extra
  if (jvmArgs && jvmArgs.trim()) {
    launchOpts.customArgs = jvmArgs.trim().split(/\s+/);
  }

  const proc = await client.launch(launchOpts);
  if (!proc) throw new Error("No se pudo iniciar Minecraft. Revisa el Registro.");

  setTimeout(markReady, 20000); // por si no aparece ninguna de las líneas anteriores
  return proc;
}

// Título e icono de varios mods de una sola vez (para la lista de mods, aunque aún no se hayan descargado)
const infoCache = new Map(); // slug -> { title, icon }
async function fetchProjectInfo(slugs) {
  const faltan = slugs.filter((s) => !infoCache.has(s));
  for (let i = 0; i < faltan.length; i += 40) {
    const ids = encodeURIComponent(JSON.stringify(faltan.slice(i, i + 40)));
    const lista = await getJSON(`${MODRINTH}/projects?ids=${ids}`);
    for (const p of lista) infoCache.set(p.slug, { title: p.title, icon: p.icon_url || null });
  }
  return infoCache;
}

module.exports = {
  loginMicrosoft,
  loginSaved,
  findJava,
  javaMajorFor,
  ensureFabric,
  fetchInstances,
  normalizeInstances,
  fallbackInstances,
  resolveMods,
  syncMods,
  syncPack,
  extractZip,
  directUrl,
  readModsManifest,
  fetchProjectInfo,
  launch,
  readModJar,
  slugify,
};
