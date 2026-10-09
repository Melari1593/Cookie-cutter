import { buildWriteMessage, describeReading } from "./ndef.js";

const STORAGE_KEY = "nfc-reader:history";
const MAX_HISTORY = 100;

const $ = (id) => document.getElementById(id);
const els = {
  banner: $("support-banner"),
  scanner: $("scanner"),
  scanBtn: $("scan-btn"),
  scanStatus: $("scan-status"),
  history: $("history"),
  historyCount: $("history-count"),
  emptyHistory: $("empty-history"),
  exportBtn: $("export-btn"),
  clearBtn: $("clear-btn"),
  writeForm: $("write-form"),
  writeType: $("write-type"),
  writeValue: $("write-value"),
  writeBtn: $("write-btn"),
  writeStatus: $("write-status"),
  template: $("entry-template"),
};

const supported = "NDEFReader" in window;
let history = loadHistory();
let scanController = null;

// ---------- Soporte ----------

if (!supported) {
  els.banner.hidden = false;
  els.banner.textContent = window.isSecureContext
    ? "Este navegador no soporta Web NFC. Usa Chrome en Android (versión 89 o superior) con NFC activado."
    : "Web NFC requiere una conexión segura (HTTPS). Abre la app desde una URL https:// o desde localhost.";
  els.scanBtn.disabled = true;
  els.writeBtn.disabled = true;
}

// ---------- Pestañas ----------

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      $(t.getAttribute("aria-controls")).hidden = !selected;
    }
  });
}

// ---------- Lectura ----------

function setScanState(state, message, kind = "") {
  els.scanner.dataset.state = state;
  els.scanStatus.textContent = message;
  els.scanStatus.className = `status ${kind}`;
}

async function startScan() {
  scanController = new AbortController();
  const reader = new NDEFReader();

  reader.addEventListener("reading", (event) => {
    const entry = describeReading(event);
    addToHistory(entry);
    navigator.vibrate?.(80);
    const n = entry.records.length;
    setScanState("success", `Etiqueta leída · ${n} registro${n === 1 ? "" : "s"}. Puedes acercar otra.`, "ok");
    setTimeout(() => {
      if (scanController) els.scanner.dataset.state = "scanning";
    }, 600);
  }, { signal: scanController.signal });

  reader.addEventListener("readingerror", () => {
    setScanState("error", "No se pudo leer la etiqueta. Prueba de nuevo o usa otra etiqueta compatible con NDEF.", "error");
  }, { signal: scanController.signal });

  try {
    await reader.scan({ signal: scanController.signal });
    setScanState("scanning", "Escaneando… acerca una etiqueta NFC.");
    els.scanBtn.textContent = "Detener lectura";
  } catch (err) {
    scanController = null;
    setScanState("error", explainError(err), "error");
  }
}

function stopScan() {
  scanController?.abort();
  scanController = null;
  els.scanBtn.textContent = "Iniciar lectura";
  setScanState("idle", "Lectura detenida.");
}

els.scanBtn.addEventListener("click", () => (scanController ? stopScan() : startScan()));

function explainError(err) {
  switch (err?.name) {
    case "NotAllowedError":
      return "Permiso denegado. Permite el acceso a NFC en la configuración del sitio.";
    case "NotSupportedError":
      return "El dispositivo no tiene NFC o está desactivado. Actívalo en los ajustes del sistema.";
    case "NotReadableError":
      return "No se pudo acceder al lector NFC. Cierra otras apps que lo estén usando.";
    case "NetworkError":
      return "Se perdió la conexión con la etiqueta. Mantén el teléfono quieto más tiempo.";
    case "AbortError":
      return "Operación cancelada.";
    default:
      return `Error: ${err?.message || err}`;
  }
}

// ---------- Historial ----------

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* sin almacenamiento disponible: el historial vive solo en memoria */
  }
}

function addToHistory(entry) {
  history = [entry, ...history].slice(0, MAX_HISTORY);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  els.history.replaceChildren(...history.map(renderEntry));
  els.historyCount.textContent = history.length;
  els.emptyHistory.hidden = history.length > 0;
  els.exportBtn.disabled = els.clearBtn.disabled = history.length === 0;
}

function renderEntry(entry) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.querySelector(".serial").textContent = `UID ${entry.serialNumber}`;
  const time = node.querySelector("time");
  time.dateTime = entry.timestamp;
  time.textContent = new Date(entry.timestamp).toLocaleString("es");

  const list = node.querySelector(".records");
  if (entry.records.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Etiqueta sin registros NDEF (vacía o sin formatear).";
    list.append(li);
  } else {
    list.append(...entry.records.map(renderRecord));
  }

  node.querySelector(".copy-btn").addEventListener("click", async (e) => {
    const text = [entry.serialNumber, ...entry.records.map((r) => r.value)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = "¡Copiado!";
    } catch {
      e.target.textContent = "Sin acceso";
    }
    setTimeout(() => (e.target.textContent = "Copiar"), 1500);
  });
  return node;
}

function renderRecord(record) {
  const li = document.createElement("li");
  li.className = "record";

  const type = document.createElement("div");
  type.className = "record-type";
  type.textContent = record.lang ? `${record.label} · ${record.lang}` : record.label;

  const value = document.createElement("p");
  value.className = "record-value";
  if (record.isLink && /^https?:\/\//i.test(record.value)) {
    const a = document.createElement("a");
    a.href = record.value;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = record.value;
    value.append(a);
  } else {
    value.textContent = record.value;
  }

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Datos crudos · ${record.size} bytes`;
  const code = document.createElement("code");
  code.textContent = record.hex || "(vacío)";
  details.append(summary, code);

  li.append(type, value, details);
  return li;
}

els.clearBtn.addEventListener("click", () => {
  if (!confirm("¿Borrar todo el historial de lecturas?")) return;
  history = [];
  saveHistory();
  renderHistory();
});

els.exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lecturas-nfc-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Escritura ----------

const PLACEHOLDERS = {
  text: "Hola desde mi etiqueta NFC",
  url: "https://ejemplo.com",
  json: '{"id": 42, "nombre": "Llavero"}',
};
els.writeType.addEventListener("change", () => {
  els.writeValue.placeholder = PLACEHOLDERS[els.writeType.value];
});

els.writeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supported) return;

  let message;
  try {
    message = buildWriteMessage(els.writeType.value, els.writeValue.value);
  } catch (err) {
    setWriteStatus(err.message, "error");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  els.writeBtn.disabled = true;
  setWriteStatus("Acerca la etiqueta para grabarla…");
  try {
    await new NDEFReader().write(message, { signal: controller.signal });
    navigator.vibrate?.([60, 40, 60]);
    setWriteStatus("¡Etiqueta grabada correctamente!", "ok");
  } catch (err) {
    setWriteStatus(
      err?.name === "AbortError" ? "Tiempo agotado: no se detectó ninguna etiqueta." : explainError(err),
      "error",
    );
  } finally {
    clearTimeout(timeout);
    els.writeBtn.disabled = false;
  }
});

function setWriteStatus(message, kind = "") {
  els.writeStatus.textContent = message;
  els.writeStatus.className = `status ${kind}`;
}

// ---------- Inicio ----------

renderHistory();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
