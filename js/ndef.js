// Decodificación de registros NDEF entregados por la API Web NFC.
// Funciones puras para poder probarlas fuera del navegador.

export function toBytes(data) {
  if (!data) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(0);
}

export function toHex(data, sep = " ") {
  return Array.from(toBytes(data), (b) => b.toString(16).padStart(2, "0"))
    .join(sep)
    .toUpperCase();
}

function decodeText(bytes, encoding = "utf-8") {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

// Convierte un NDEFRecord (o un objeto con la misma forma) en un objeto
// serializable con un resumen legible.
export function describeRecord(record) {
  const bytes = toBytes(record.data);
  const base = {
    recordType: record.recordType,
    mediaType: record.mediaType || null,
    id: record.id || null,
    size: bytes.length,
    hex: toHex(bytes),
  };

  switch (record.recordType) {
    case "text": {
      // Web NFC ya quita el byte de estado y el idioma del payload.
      const text = decodeText(bytes, record.encoding || "utf-8");
      return { ...base, label: "Texto", value: text, lang: record.lang || null };
    }
    case "url":
    case "absolute-url":
      return { ...base, label: "Enlace", value: decodeText(bytes), isLink: true };
    case "mime":
      return { ...base, label: `MIME (${record.mediaType})`, value: describeMime(record.mediaType, bytes) };
    case "smart-poster": {
      const children = safeToRecords(record).map(describeRecord);
      return { ...base, label: "Smart Poster", value: children.map((c) => c.value).join(" · "), children };
    }
    case "empty":
      return { ...base, label: "Vacío", value: "(registro vacío)" };
    case "unknown":
      return { ...base, label: "Desconocido", value: toHex(bytes) };
    default: {
      // Registros externos (dominio:tipo) o locales (:tipo).
      const children = safeToRecords(record).map(describeRecord);
      const value = children.length
        ? children.map((c) => c.value).join(" · ")
        : printableOrHex(bytes);
      const label = record.recordType?.startsWith(":") ? "Local" : "Externo";
      return { ...base, label: `${label} (${record.recordType})`, value, children: children.length ? children : undefined };
    }
  }
}

function describeMime(mediaType = "", bytes) {
  if (/json/.test(mediaType)) {
    try {
      return JSON.stringify(JSON.parse(decodeText(bytes)), null, 2);
    } catch {
      /* cae al texto plano */
    }
  }
  if (/^text\/|vcard|xml/.test(mediaType)) return decodeText(bytes);
  return printableOrHex(bytes);
}

function printableOrHex(bytes) {
  if (bytes.length === 0) return "(sin datos)";
  const text = decodeText(bytes);
  // Si casi todo es imprimible, se muestra como texto.
  const printable = [...text].filter((c) => c >= " " || c === "\n" || c === "\t").length;
  return printable / text.length > 0.9 && !text.includes("�") ? text : toHex(bytes);
}

function safeToRecords(record) {
  try {
    return typeof record.toRecords === "function" ? record.toRecords() || [] : [];
  } catch {
    return [];
  }
}

// Construye la entrada del historial a partir de un evento de lectura.
export function describeReading({ serialNumber, message }, date = new Date()) {
  const records = Array.from(message?.records ?? [], describeRecord);
  return {
    id: `${date.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: date.toISOString(),
    serialNumber: serialNumber || "(no disponible)",
    records,
  };
}

// Prepara los registros para NDEFReader.write() desde el formulario de escritura.
export function buildWriteMessage(type, value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error("Escribe un contenido para grabar en la etiqueta.");
  switch (type) {
    case "text":
      return { records: [{ recordType: "text", data: trimmed, lang: "es" }] };
    case "url": {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
      try {
        new URL(url);
      } catch {
        throw new Error("La URL no es válida.");
      }
      return { records: [{ recordType: "url", data: url }] };
    }
    case "json": {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error("El JSON no es válido.");
      }
      const data = new TextEncoder().encode(JSON.stringify(parsed));
      return { records: [{ recordType: "mime", mediaType: "application/json", data }] };
    }
    default:
      throw new Error(`Tipo de registro no soportado: ${type}`);
  }
}
