---
version: alpha
name: "COMTECH Showroom Caja"
description: "Punto de venta asistido para escaneo, cobro, facturación SAP, impresión y entrega en mostrador."
colors:
  ink: "#0C1D2E"
  primary: "#F20D18"
  primary-dark: "#C80812"
  success: "#13835E"
  background: "#EEF3F6"
  surface: "#FFFFFF"
  border: "#DBE3E8"
  muted: "#687887"
  focus: "#56A8FF"
typography:
  sans:
    fontFamily: "Arial, Helvetica, sans-serif"
  receipt:
    fontFamily: "Courier New, monospace"
rounded:
  DEFAULT: "0.75rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1.375rem"
spacing:
  control-gap: "0.5rem"
  panel-gap: "1.5rem"
  page-max: "88.75rem"
components:
  scanner: {}
  sale-summary: {}
  payment-dialog: {}
  receipt: {}
---

# COMTECH Showroom Caja Design System

## Overview

### Creative North Star

La interfaz toma como referencia una caja de supermercado empresarial: lectura inmediata, totales dominantes, estados operativos inequívocos y una secuencia que la cajera puede completar sin apartar la vista del cliente.

### Product context and register

- **Audiencia y trabajo principal:** cajeras del showroom que escanean productos, cobran, facturan, imprimen y entregan.
- **Mercado e idioma:** operación COMTECH en Managua; interfaz en español de Nicaragua y moneda NIO.
- **Escena de uso:** computadora de caja, uso continuo, lector de código de barras, POS e impresora térmica.
- **Registro:** producto interno; la claridad operativa tiene prioridad sobre mensajes promocionales.
- **Firma memorable:** la barra blanca del lector, con borde y botón rojo COMTECH, funciona como estación activa de escaneo.
- **Restricción:** los pasos de pago, impresión y entrega nunca deben quedar implícitos ni reiniciarse por tiempo.
- **Anti-referencias:** no debe parecer autoservicio, tienda en línea ni landing page.
- **Propiedad de tokens:** este documento refleja las variables y reglas canónicas de `app/globals.css`; cualquier cambio durable debe actualizar ambos archivos.

## Colors

El rojo COMTECH identifica acciones primarias y marca; no se usa para estados exitosos. Verde indica éxito, azul el foco de teclado, y rojo oscuro los errores. Toda la interfaz usa superficies claras (encabezado, lector, resumen y diálogos); no hay bloques oscuros. El rojo se limita a acentos y acciones.

## Typography

Arial/Helvetica prioriza legibilidad y disponibilidad local. Los importes usan cifras grandes y firmes. La factura térmica conserva Courier New para alineación monoespaciada. Los controles se redactan como acciones de la cajera: “Cobrar”, “Imprimir” e “Iniciar nueva venta”.

## Layout

En escritorio, productos y escaneo ocupan el panel principal; el resumen y cobro permanecen a la derecha. Bajo 900 px los paneles se apilan sin ocultar acciones. La venta completada permanece visible hasta que la cajera inicia una nueva.

## Elevation & Depth

La jerarquía usa contraste tonal, bordes y sombras discretas. Los diálogos de pago se elevan sobre una capa translúcida suave; las filas de producto no deben parecer tarjetas promocionales.

## Shapes

Controles de 8–12 px de radio y contenedores principales de hasta 22 px. Los círculos se reservan para estados, pasos e identidad breve.

## Components

### Foundational visual states

Todo control tiene foco visible. Acciones imposibles permanecen deshabilitadas. Los estados SAP, pago rechazado, operación incompleta, venta completada e impresión pendiente usan texto además de color.

### Buttons and actions

La acción roja principal avanza la venta. Cancelar es secundaria y separada. Después del pago, “Imprimir factura” precede a “Iniciar nueva venta”; no existe reinicio automático.

### Navigation and data display

El total es el dato dominante del resumen. Cantidad, precio unitario y total por línea deben conservar alineación y no saltar durante actualizaciones.

### Forms and overlays

El campo de código de barras mantiene el foco entre escaneos. Los diálogos explican la acción de la cajera y conservan recuperación clara ante errores.

### Iconography

Iconos simples acompañan texto; ninguna acción crítica depende solo de un símbolo.

### Motion

Movimiento breve y funcional para procesamiento. Se evita cualquier cuenta regresiva que quite información operativa.

### Content and data visualization

Voz directa, interna y accionable. Se usa “venta”, “cajera”, “cliente”, “factura” y “entrega” de manera consistente.

## Do's and Don'ts

- **Do:** mantener visible la factura SAP hasta imprimir y entregar.
- **Do:** devolver el foco al lector al iniciar una nueva venta.
- **Don't:** hablarle al cliente como si controlara la pantalla.
- **Don't:** reiniciar o cerrar una venta completada automáticamente.
