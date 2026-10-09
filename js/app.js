import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { computeMask, maskBounds, buildLayers } from './converter.js';
import { buildModel, triangleCount } from './mesh.js';

const ACCEPTED = /\.(jpe?g|png|svg)$/i;
const ANALYSIS_SIZE = 1024;
const MAX_CANVAS = 4096;

const els = {
  dropzone: document.getElementById('dropzone'),
  input: document.getElementById('file-input'),
  list: document.getElementById('file-list'),
  form: document.getElementById('params'),
  preview: document.getElementById('preview2d'),
  viewer: document.getElementById('viewer3d'),
  status: document.getElementById('status'),
  download: document.getElementById('download'),
  downloadAll: document.getElementById('download-all'),
};

/** @type {{id:number, file:File, name:string, url:string, img:HTMLImageElement, w:number, h:number}[]} */
const molds = [];
let activeId = null;
let nextId = 1;
let current = null; // { moldId, layers, shape, group }
let zipping = false;

// ---------- Carga de archivos ----------

function baseName(name) {
  return name.replace(/\.[^.]+$/, '') || 'molde';
}

/** Asegura que el SVG tenga ancho y alto explícitos para poder dibujarlo en un canvas. */
async function svgToUrl(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('El SVG no es válido.');
  }
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const attr = (n) => {
    const v = svg.getAttribute(n);
    return v && !v.endsWith('%') ? parseFloat(v) : NaN;
  };
  let w = attr('width');
  let h = attr('height');
  if (!(w > 0 && h > 0)) {
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      w = vb[2];
      h = vb[3];
    } else {
      w = h = ANALYSIS_SIZE;
    }
  }
  // Escalar para que el lado mayor mida 2048 px y la rasterización sea nítida.
  const k = 2048 / Math.max(w, h);
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w * k));
  svg.setAttribute('height', String(h * k));
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  return URL.createObjectURL(blob);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = url;
  });
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => ACCEPTED.test(f.name) || /^image\/(jpeg|png|svg\+xml)$/.test(f.type));
  if (!files.length) {
    setStatus('Formato no admitido. Usa archivos JPEG, PNG o SVG.', true);
    return;
  }
  let lastId = null;
  for (const file of files) {
    try {
      const isSvg = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml';
      const url = isSvg ? await svgToUrl(file) : URL.createObjectURL(file);
      const img = await loadImage(url);
      const w = img.naturalWidth || ANALYSIS_SIZE;
      const h = img.naturalHeight || ANALYSIS_SIZE;
      const mold = { id: nextId++, file, name: baseName(file.name), url, img, w, h };
      molds.push(mold);
      lastId = mold.id;
    } catch (err) {
      setStatus(`${file.name}: ${err.message}`, true);
    }
  }
  renderList();
  if (lastId !== null) select(lastId);
}

function removeMold(id) {
  const i = molds.findIndex((m) => m.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(molds[i].url);
  molds.splice(i, 1);
  if (activeId === id) {
    activeId = null;
    if (molds.length) select(molds[Math.min(i, molds.length - 1)].id);
    else clearOutput();
  }
  renderList();
}

function renderList() {
  els.list.replaceChildren(
    ...molds.map((m) => {
      const li = document.createElement('li');
      li.className = m.id === activeId ? 'active' : '';
      li.title = m.file.name;
      const thumb = document.createElement('img');
      thumb.src = m.url;
      thumb.alt = '';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.file.name;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'remove';
      rm.textContent = '×';
      rm.setAttribute('aria-label', `Quitar ${m.file.name}`);
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        removeMold(m.id);
      });
      li.append(thumb, name, rm);
      li.addEventListener('click', () => select(m.id));
      return li;
    }),
  );
  els.downloadAll.disabled = zipping || molds.length < 1;
}

function select(id) {
  activeId = id;
  renderList();
  scheduleUpdate(0);
}

// ---------- Parámetros ----------

function readParams() {
  const f = new FormData(els.form);
  const num = (k) => parseFloat(f.get(k));
  return {
    mode: f.get('mode'),
    size: num('size'),
    height: num('height'),
    wall: num('wall'),
    flangeWidth: num('flangeWidth'),
    flangeHeight: num('flangeHeight'),
    detect: f.get('detect'),
    threshold: num('threshold'),
    invert: f.get('invert') === 'on',
    fillHoles: f.get('fillHoles') === 'on',
    minArea: num('minArea') || 0,
    quality: num('quality'),
  };
}

function validate(p) {
  if (!(p.size > 0)) return 'Indica un tamaño mayor que 0.';
  if (!(p.height > 0)) return 'Indica una altura mayor que 0.';
  if (p.mode === 'cutter' && !(p.wall > 0)) return 'Indica un grosor de pared mayor que 0.';
  return null;
}

// ---------- Conversión ----------

function drawToImageData(img, sx, sy, sw, sh, dw, dh, margin) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(dw) + 2 * margin;
  canvas.height = Math.round(dh) + 2 * margin;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, margin, margin, Math.round(dw), Math.round(dh));
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Convierte un molde en capas de polígonos (en mm) según los parámetros. */
function convert(mold, p) {
  const maskOpts = { threshold: p.threshold, invert: p.invert, mode: p.detect };

  // 1) Análisis a baja resolución para localizar la figura.
  const k = ANALYSIS_SIZE / Math.max(mold.w, mold.h);
  const aw = Math.max(1, Math.round(mold.w * k));
  const ah = Math.max(1, Math.round(mold.h * k));
  const analysis = drawToImageData(mold.img, 0, 0, mold.w, mold.h, aw, ah, 0);
  const { mask: aMask, usedAlpha } = computeMask(analysis, maskOpts);
  const box = maskBounds(aMask, aw, ah);
  if (!box) throw new Error('No se detectó ninguna figura. Ajusta el umbral o el método de detección.');

  // 2) Rasterizar solo la figura a la escala final (px/mm según la calidad).
  const pad = 1; // px de análisis alrededor de la caja
  const bx = Math.max(0, box.x - pad), by = Math.max(0, box.y - pad);
  const bw = Math.min(aw, box.x + box.w + pad) - bx;
  const bh = Math.min(ah, box.y + box.h + pad) - by;
  const extraMM = p.mode === 'cutter' ? Math.max(p.wall, p.flangeWidth) : 0;
  let res = p.quality;
  const fit = (r) => (p.size + 2 * extraMM) * r + 8 <= MAX_CANVAS;
  while (!fit(res) && res > 1) res -= 1;
  const scale = (p.size * res) / Math.max(box.w, box.h); // px de trabajo por px de análisis
  const margin = Math.ceil(extraMM * res) + 4;
  const work = drawToImageData(
    mold.img,
    bx / k, by / k, bw / k, bh / k,
    bw * scale, bh * scale,
    margin,
  );
  // El margen añadido es transparente: fijar el método detectado en el análisis.
  const { mask } = computeMask(work, { ...maskOpts, mode: usedAlpha ? 'alpha' : 'brightness' });
  const result = buildLayers(mask, work.width, work.height, res, p);
  if (!result.layers.length || !result.layers.some((l) => l.polygons.length)) {
    throw new Error('La figura es demasiado pequeña. Reduce "Ignorar manchas" o ajusta el umbral.');
  }
  return { ...result, usedAlpha };
}

const material = new THREE.MeshStandardMaterial({ color: 0xd9824a, roughness: 0.55, metalness: 0.05 });

let updateTimer = null;
function scheduleUpdate(delay = 200) {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(update, delay);
}

function update() {
  const mold = molds.find((m) => m.id === activeId);
  if (!mold) return;
  const p = readParams();
  const invalid = validate(p);
  if (invalid) {
    setStatus(invalid, true);
    return;
  }
  setStatus('Procesando…');
  // Ceder un fotograma para que el mensaje se pinte antes del cálculo.
  requestAnimationFrame(() => setTimeout(() => {
    // El molde pudo quitarse o cambiarse mientras se esperaba el fotograma.
    if (activeId !== mold.id) return;
    try {
      const t0 = performance.now();
      const result = convert(mold, p);
      const group = buildModel(result.layers, material);
      setModel(group);
      current = { moldId: mold.id, ...result, group };
      drawPreview(result);
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const tris = triangleCount(group);
      const ms = Math.round(performance.now() - t0);
      setStatus(
        `${mold.name}: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm · ` +
        `${tris.toLocaleString('es')} triángulos · ${result.usedAlpha ? 'transparencia' : 'zonas oscuras'} · ${ms} ms`,
      );
      els.download.disabled = false;
    } catch (err) {
      console.error(err);
      current = null;
      setModel(null);
      clearPreview();
      els.download.disabled = true;
      setStatus(err.message, true);
    }
  }, 0));
}

// ---------- Exportación ----------

const exporter = new STLExporter();

function modelToStl(group) {
  return new Blob([exporter.parse(group, { binary: true })], { type: 'model/stl' });
}

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

els.download.addEventListener('click', () => {
  if (!current) return;
  const mold = molds.find((m) => m.id === current.moldId);
  saveBlob(modelToStl(current.group), `${mold ? mold.name : 'molde'}.stl`);
});

els.downloadAll.addEventListener('click', async () => {
  if (zipping || !molds.length) return;
  const p = readParams();
  const invalid = validate(p);
  if (invalid) return setStatus(invalid, true);
  if (typeof JSZip === 'undefined') return setStatus('No se pudo cargar la librería ZIP.', true);
  zipping = true;
  els.downloadAll.disabled = true;
  // Copia de la lista: el usuario puede añadir o quitar moldes mientras se genera.
  const batch = [...molds];
  const zip = new JSZip();
  const used = new Set();
  const failed = [];
  for (const [i, mold] of batch.entries()) {
    setStatus(`Generando ${i + 1} de ${batch.length}: ${mold.name}…`);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const group = buildModel(convert(mold, p).layers, material);
      let name = `${mold.name}.stl`;
      for (let n = 2; used.has(name); n++) name = `${mold.name}-${n}.stl`;
      used.add(name);
      zip.file(name, exporter.parse(group, { binary: true }).buffer);
      group.traverse((o) => o.isMesh && o.geometry.dispose());
    } catch (err) {
      failed.push(`${mold.name} (${err.message})`);
    }
  }
  try {
    if (used.size) saveBlob(await zip.generateAsync({ type: 'blob' }), 'moldes-stl.zip');
  } finally {
    zipping = false;
    els.downloadAll.disabled = molds.length < 1;
  }
  setStatus(
    failed.length ? `No se pudieron convertir: ${failed.join('; ')}` : `${used.size} archivo(s) STL exportados.`,
    failed.length > 0,
  );
});

// ---------- Vista previa 2D ----------

function polyPath(polygons) {
  const path = new Path2D();
  for (const { outer, holes } of polygons) {
    for (const ring of [outer, ...holes]) {
      ring.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      path.closePath();
    }
  }
  return path;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawPreview({ layers, shape }) {
  const canvas = els.preview;
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of layers) {
    for (const p of l.polygons) {
      for (const [x, y] of p.outer) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const s = (canvas.width * 0.9) / span;
  ctx.setTransform(s, 0, 0, -s, canvas.width / 2 - s * (minX + maxX) / 2, canvas.height / 2 + s * (minY + maxY) / 2);

  const colors = { 'pestaña': cssVar('--flange'), pared: cssVar('--accent'), figura: cssVar('--accent') };
  if (layers[0].name !== 'figura') {
    ctx.fillStyle = cssVar('--shape');
    ctx.fill(polyPath(shape), 'evenodd');
  }
  for (const l of layers) {
    ctx.fillStyle = colors[l.name] || cssVar('--accent');
    ctx.fill(polyPath(l.polygons), 'evenodd');
  }
}

function clearPreview() {
  const ctx = els.preview.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, els.preview.width, els.preview.height);
}

// ---------- Visor 3D ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
els.viewer.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(90, -120, 110);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(60, -80, 150);
scene.add(sun);
const grid = new THREE.GridHelper(200, 20, 0x9a8f84, 0xc8bfb4);
grid.rotation.x = Math.PI / 2;
grid.material.transparent = true;
grid.material.opacity = 0.5;
scene.add(grid);

let model = null;
function setModel(group) {
  if (model) {
    scene.remove(model);
    model.traverse((o) => o.isMesh && o.geometry.dispose());
  }
  model = group;
  if (!group) return;
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 50;
  controls.target.copy(center);
  const dir = new THREE.Vector3(0.45, -0.6, 0.65).normalize();
  camera.position.copy(center).addScaledVector(dir, radius * 2.6);
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  grid.scale.setScalar(Math.max(1, Math.ceil(radius / 50)));
}

function resize() {
  const w = els.viewer.clientWidth;
  const h = els.viewer.clientHeight || w;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  resize();
  if (current) drawPreview(current);
}).observe(els.viewer);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---------- Estado y eventos ----------

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function clearOutput() {
  clearTimeout(updateTimer);
  current = null;
  setModel(null);
  clearPreview();
  els.download.disabled = true;
  setStatus('Sube un molde para empezar.');
}

function syncModeUi() {
  els.form.classList.toggle('solid', readParams().mode === 'solid');
  els.form.elements.thresholdOut.value = els.form.elements.threshold.value;
}

els.form.addEventListener('input', () => {
  syncModeUi();
  scheduleUpdate();
});
els.form.addEventListener('submit', (e) => e.preventDefault());

els.input.addEventListener('change', () => {
  addFiles(els.input.files);
  els.input.value = '';
});
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.input.click();
  }
});
for (const type of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  });
}
for (const type of ['dragleave', 'drop']) {
  els.dropzone.addEventListener(type, () => els.dropzone.classList.remove('dragover'));
}
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});
// Evitar que soltar un archivo fuera de la zona abra la imagen en el navegador.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

syncModeUi();
