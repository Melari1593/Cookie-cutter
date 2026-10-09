import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWriteMessage, describeReading, describeRecord, toHex } from "../js/ndef.js";

const enc = (s) => new DataView(new TextEncoder().encode(s).buffer);

test("toHex formatea bytes en mayúsculas", () => {
  assert.equal(toHex(new Uint8Array([0, 15, 255])), "00 0F FF");
});

test("describe un registro de texto", () => {
  const r = describeRecord({ recordType: "text", data: enc("Hola"), lang: "es", encoding: "utf-8" });
  assert.equal(r.label, "Texto");
  assert.equal(r.value, "Hola");
  assert.equal(r.lang, "es");
  assert.equal(r.size, 4);
});

test("describe un registro URL como enlace", () => {
  const r = describeRecord({ recordType: "url", data: enc("https://ejemplo.com") });
  assert.equal(r.value, "https://ejemplo.com");
  assert.equal(r.isLink, true);
});

test("formatea registros MIME JSON", () => {
  const r = describeRecord({ recordType: "mime", mediaType: "application/json", data: enc('{"a":1}') });
  assert.equal(r.value, '{\n  "a": 1\n}');
});

test("muestra datos binarios como hexadecimal", () => {
  const r = describeRecord({ recordType: "mime", mediaType: "application/octet-stream", data: new DataView(new Uint8Array([0, 1, 2]).buffer) });
  assert.equal(r.value, "00 01 02");
});

test("describe registros anidados de smart poster", () => {
  const r = describeRecord({
    recordType: "smart-poster",
    data: enc(""),
    toRecords: () => [
      { recordType: "url", data: enc("https://a.b") },
      { recordType: "text", data: enc("Título") },
    ],
  });
  assert.equal(r.children.length, 2);
  assert.equal(r.value, "https://a.b · Título");
});

test("describeReading crea una entrada de historial serializable", () => {
  const date = new Date("2026-01-01T00:00:00Z");
  const entry = describeReading(
    { serialNumber: "04:a2:b3", message: { records: [{ recordType: "empty" }] } },
    date,
  );
  assert.equal(entry.serialNumber, "04:a2:b3");
  assert.equal(entry.timestamp, date.toISOString());
  assert.equal(entry.records[0].label, "Vacío");
  assert.doesNotThrow(() => JSON.stringify(entry));
});

test("buildWriteMessage valida y construye mensajes", () => {
  assert.deepEqual(buildWriteMessage("text", " hola "), {
    records: [{ recordType: "text", data: "hola", lang: "es" }],
  });
  assert.equal(buildWriteMessage("url", "ejemplo.com").records[0].data, "https://ejemplo.com");
  assert.equal(buildWriteMessage("json", '{"a":1}').records[0].mediaType, "application/json");
  assert.throws(() => buildWriteMessage("text", "  "), /contenido/);
  assert.throws(() => buildWriteMessage("json", "{malo"), /JSON/);
});
