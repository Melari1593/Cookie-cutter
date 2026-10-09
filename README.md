# Lector NFC

Aplicación web progresiva (PWA) para **leer y escribir etiquetas NFC** desde el navegador del teléfono, usando la API [Web NFC](https://developer.mozilla.org/docs/Web/API/Web_NFC_API). No necesita compilación ni dependencias.

## Funciones

- **Lectura continua**: muestra el UID (número de serie) de la etiqueta y decodifica sus registros NDEF:
  texto (con idioma), URL, MIME (JSON con formato, texto, vCard), Smart Poster, registros externos/locales y datos binarios en hexadecimal.
- **Historial** de lecturas guardado en el dispositivo (hasta 100), con copiar al portapapeles y **exportación a JSON**.
- **Escritura** de etiquetas con texto, enlaces o JSON.
- Vibración al leer/grabar, modo claro/oscuro y funcionamiento sin conexión (service worker).

## Requisitos

- **Chrome para Android** 89 o superior, con NFC activado en el teléfono.
  (iOS/Safari y los navegadores de escritorio no soportan Web NFC; la app muestra un aviso.)
- La página debe servirse por **HTTPS** (o `localhost`).

## Uso

```bash
npm start      # sirve la app en http://localhost:8080
npm test       # pruebas de la lógica de decodificación (Node 18+)
```

Para probar en el teléfono, publica la carpeta en cualquier hosting estático con HTTPS
(GitHub Pages, Vercel, Netlify…) o usa la depuración remota de Chrome con
`chrome://inspect` → *Port forwarding* hacia `localhost:8080`.

## Estructura

| Archivo | Descripción |
| --- | --- |
| `index.html` | Interfaz (pestañas Leer / Escribir) |
| `styles.css` | Estilos, modo claro y oscuro |
| `js/app.js` | Escaneo, escritura, historial y renderizado |
| `js/ndef.js` | Decodificación de registros NDEF y construcción de mensajes (funciones puras) |
| `sw.js`, `manifest.webmanifest` | Instalación como app y modo sin conexión |
| `tests/` | Pruebas con `node:test` |
