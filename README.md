# Cookie-cutter

Página web para convertir moldes en **JPEG, PNG o SVG** en archivos **STL** listos para imprimir en 3D, ya sea como cortador de galletas o como figura sólida.

Todo el proceso se hace en el navegador: las imágenes no se suben a ningún servidor.

## Uso

1. Abre `index.html` desde un servidor web estático (por ejemplo GitHub Pages, o en local con `python3 -m http.server` y luego `http://localhost:8000`).
   > Abrir el archivo directamente con `file://` no funciona porque los módulos de JavaScript necesitan un servidor.
2. Arrastra uno o varios moldes a la zona de carga (o haz clic para elegirlos).
3. Ajusta los parámetros y revisa el contorno detectado y la vista 3D.
4. Pulsa **Descargar STL** para el molde seleccionado o **Descargar todos (.zip)** para todos a la vez.

## Parámetros

| Parámetro | Descripción |
|---|---|
| Tipo de modelo | *Cortador de galletas* (pared alrededor de la figura con pestaña de apoyo) o *Figura sólida* (extrusión de la figura). |
| Tamaño de la figura | Medida en mm del lado mayor de la figura. La pared y la pestaña se añaden por fuera. |
| Altura | Altura total del modelo en mm. |
| Grosor de pared | Grosor del filo del cortador en mm. |
| Ancho / altura de pestaña | Base ancha para apoyar el cortador. Un ancho menor o igual al grosor de pared la desactiva. |
| Método de detección | *Automático* usa la transparencia si la imagen la tiene y, si no, las zonas oscuras. |
| Umbral / Invertir | Controlan qué zonas cuentan como figura cuando se detecta por brillo. |
| Usar solo la silueta exterior | Rellena los huecos interiores; útil para dibujos de contorno. |
| Ignorar manchas | Descarta trozos sueltos más pequeños que el área indicada. |
| Calidad | Resolución (píxeles por mm) usada para trazar el contorno. |

## Cómo funciona

1. La imagen se rasteriza en un `canvas` y se convierte en una máscara binaria (por brillo o por transparencia).
2. La figura se reescala al tamaño pedido y, para el cortador, se calculan la pared y la pestaña con una transformada de distancia euclídea.
3. Los contornos se trazan, se suavizan y se simplifican para obtener polígonos con huecos.
4. Los polígonos se extruyen con [three.js](https://threejs.org/) y se exportan como STL binario.

## Estructura

- `index.html` — interfaz.
- `css/styles.css` — estilos (con modo oscuro).
- `js/converter.js` — imagen → polígonos en mm (sin dependencias del navegador).
- `js/mesh.js` — polígonos → mallas 3D.
- `js/app.js` — carga de archivos, parámetros, vista previa y exportación.
