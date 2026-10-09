// Conversión de una imagen (ImageData) a polígonos en milímetros.
// Módulo sin dependencias del DOM para poder probarlo en Node.

/**
 * Indica si la imagen usa transparencia de forma significativa
 * (más del 1 % de los píxeles son semitransparentes).
 */
export function hasTransparency(imageData) {
  const { data } = imageData;
  const total = data.length / 4;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 200) count++;
  }
  return count > total * 0.01;
}

/**
 * Convierte la imagen en una máscara binaria (1 = figura).
 * mode: 'auto' | 'brightness' | 'alpha'
 */
export function computeMask(imageData, { threshold = 128, invert = false, mode = 'auto' } = {}) {
  const { data, width, height } = imageData;
  const useAlpha = mode === 'alpha' || (mode === 'auto' && hasTransparency(imageData));
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    let fg;
    if (useAlpha) {
      fg = a > 0.5;
    } else {
      // Luminancia compuesta sobre fondo blanco.
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      fg = a * lum + (1 - a) * 255 < threshold;
    }
    mask[p] = (invert ? !fg : fg) ? 1 : 0;
  }
  return { mask, usedAlpha: useAlpha };
}

/** Caja envolvente de los píxeles activos, o null si la máscara está vacía. */
export function maskBounds(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Rellena los huecos interiores: todo lo que no se alcanza desde el borde pasa a ser figura. */
export function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/**
 * Elimina las conexiones solo en diagonal (patrones "tablero de ajedrez" 2x2)
 * para que cada contorno sea un polígono simple.
 */
export function removeSaddles(mask, w, h) {
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        const a = mask[i], b = mask[i + 1], c = mask[i + w], d = mask[i + w + 1];
        if (a && d && !b && !c) { mask[i + 1] = 1; changed = true; }
        else if (b && c && !a && !d) { mask[i] = 1; changed = true; }
      }
    }
    if (!changed) break;
  }
  return mask;
}

const INF = 1e20;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Transformada de distancia euclídea exacta (Felzenszwalb & Huttenlocher).
 * Devuelve la distancia al cuadrado (en píxeles) al píxel de figura más cercano.
 */
export function distanceTransform(mask, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? 0 : INF;

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
  return grid;
}

/**
 * Traza los bordes entre píxeles como lazos cerrados (coordenadas de esquinas de píxel).
 * La figura queda siempre a la derecha del sentido de recorrido (en coordenadas de pantalla,
 * con Y hacia abajo).
 * Requiere una máscara sin "sillas" (ver removeSaddles).
 */
export function traceContours(mask, w, h) {
  const W = w + 1;
  const next = new Int32Array(W * (h + 1)).fill(-1);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const tl = y * W + x, tr = tl + 1, bl = tl + W, br = bl + 1;
      if (!at(x, y - 1)) next[tl] = tr;
      if (!at(x + 1, y)) next[tr] = br;
      if (!at(x, y + 1)) next[br] = bl;
      if (!at(x - 1, y)) next[bl] = tl;
    }
  }

  const loops = [];
  for (let start = 0; start < next.length; start++) {
    if (next[start] < 0) continue;
    const loop = [];
    let v = start;
    while (next[v] >= 0) {
      loop.push([v % W, Math.floor(v / W)]);
      const nv = next[v];
      next[v] = -1;
      v = nv;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

/** Suavizado laplaciano de un lazo cerrado (elimina el efecto escalera). */
export function smoothLoop(pts, iterations = 2) {
  let cur = pts;
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
      out[i] = [0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0], 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1]];
    }
    cur = out;
  }
  return cur;
}

function segDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

function rdp(pts, first, last, eps2, keep) {
  const stack = [[first, last]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist2(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > eps2) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
}

/** Simplificación Ramer–Douglas–Peucker para un lazo cerrado. */
export function simplifyLoop(pts, eps) {
  const n = pts.length;
  if (n < 4) return pts;
  // Partir el lazo en el vértice más lejano al primero.
  let far = 0, farD = -1;
  for (let i = 1; i < n; i++) {
    const dx = pts[i][0] - pts[0][0], dy = pts[i][1] - pts[0][1];
    const d = dx * dx + dy * dy;
    if (d > farD) { farD = d; far = i; }
  }
  const closed = pts.concat([pts[0]]);
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const eps2 = eps * eps;
  rdp(closed, 0, far, eps2, keep);
  rdp(closed, far, n, eps2, keep);
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Convierte una máscara en polígonos con huecos, en milímetros.
 * transform: { res (px/mm), cx, cy } — centro en píxeles; el eje Y se invierte.
 * Devuelve [{ outer: [[x,y],...], holes: [[[x,y],...], ...] }]
 * con contornos exteriores en sentido antihorario y huecos en sentido horario.
 */
export function maskToPolygons(mask, w, h, { res, cx, cy, minAreaMM2 = 0, smooth = 2, tolerancePx = 0.35 }) {
  const m = removeSaddles(mask.slice(), w, h);
  const loops = traceContours(m, w, h);
  const minArea = minAreaMM2;
  const outers = [];
  const holes = [];
  for (const loop of loops) {
    let pts = smoothLoop(loop, smooth);
    pts = simplifyLoop(pts, tolerancePx);
    if (pts.length < 3) continue;
    // Al invertir el eje Y el recorrido pasa a ser horario para los contornos
    // exteriores; se invierte el orden para dejarlos antihorarios.
    pts = pts.map(([x, y]) => [(x - cx) / res, (cy - y) / res]).reverse();
    const area = signedArea(pts);
    if (Math.abs(area) < minArea || Math.abs(area) < 1e-6) continue;
    if (area > 0) outers.push({ outer: pts, area, holes: [] });
    else holes.push(pts);
  }
  // Asignar cada hueco al contorno exterior más pequeño que lo contiene.
  outers.sort((a, b) => a.area - b.area);
  for (const hole of holes) {
    const probe = hole[0];
    const parent = outers.find((o) => pointInPolygon(probe, o.outer));
    if (parent) parent.holes.push(hole);
  }
  return outers.map(({ outer, holes: hs }) => ({ outer, holes: hs }));
}

/**
 * Genera las capas a extruir a partir de la máscara de trabajo.
 * params (en mm): mode ('cutter' | 'solid'), height, wall, flangeWidth, flangeHeight,
 *                 fillHoles, minArea
 * res: píxeles por milímetro.
 * Devuelve { layers: [{ name, polygons, z0, z1 }], shape: polígonos de la figura }
 */
export function buildLayers(mask, w, h, res, params) {
  const {
    mode = 'cutter',
    height = 15,
    wall = 1.2,
    flangeWidth = 4,
    flangeHeight = 1.5,
    fillHoles: fill = true,
    minArea = 2,
  } = params;

  let shape = fill ? fillHoles(mask, w, h) : mask.slice();
  removeSaddles(shape, w, h);
  const transform = { res, cx: w / 2, cy: h / 2, minAreaMM2: minArea };
  const shapePolys = maskToPolygons(shape, w, h, transform);
  if (!shapePolys.length) return { layers: [], shape: [] };

  // Reconstruir la figura solo con los contornos que superaron el filtro de área,
  // para que las manchas pequeñas no generen paredes.
  shape = rasterizePolygons(shapePolys, w, h, transform);

  if (mode === 'solid') {
    return {
      layers: [{ name: 'figura', polygons: shapePolys, z0: 0, z1: height }],
      shape: shapePolys,
    };
  }

  const d2 = distanceTransform(shape, w, h);
  const ring = (radiusMM) => {
    const r2 = (radiusMM * res) ** 2;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = !shape[i] && d2[i] <= r2 ? 1 : 0;
    return out;
  };

  const layers = [];
  const hasFlange = flangeWidth > wall && flangeHeight > 0 && flangeHeight < height;
  const wallStart = hasFlange ? flangeHeight : 0;
  if (hasFlange) {
    layers.push({
      name: 'pestaña',
      polygons: maskToPolygons(ring(flangeWidth), w, h, { ...transform, minAreaMM2: 0 }),
      z0: 0,
      z1: flangeHeight,
    });
  }
  layers.push({
    name: 'pared',
    polygons: maskToPolygons(ring(wall), w, h, { ...transform, minAreaMM2: 0 }),
    z0: wallStart,
    z1: height,
  });
  return { layers, shape: shapePolys };
}

/** Rasteriza polígonos (con huecos) en una máscara, por regla par-impar sobre centros de píxel. */
export function rasterizePolygons(polys, w, h, { res, cx, cy }) {
  const out = new Uint8Array(w * h);
  const rings = [];
  for (const p of polys) {
    rings.push(p.outer, ...p.holes);
  }
  const px = rings.map((r) => r.map(([x, y]) => [x * res + cx, cy - y * res]));
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5;
    const xs = [];
    for (const r of px) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [x1, y1] = r[j], [x2, y2] = r[i];
        if ((y1 > sy) !== (y2 > sy)) xs.push(x1 + ((sy - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) out[y * w + x] = 1;
    }
  }
  return out;
}
