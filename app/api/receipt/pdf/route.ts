import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { getOperation } from "../../../lib/operations";
import { getReceiptData, type ReceiptData } from "../../../lib/sap";

// Helvetica estándar solo cubre Latin-1: se omiten los caracteres que el PDF no puede dibujar.
function pdfText(value: string) {
  return Array.from(value).filter((ch) => {
    const code = ch.codePointAt(0) || 0;
    return (code >= 32 && code <= 126) || (code >= 160 && code <= 255);
  }).join("");
}

function receiptDate(docDate: string, createdAt: string) {
  const date = docDate.slice(0, 10).split("-").reverse().join("/");
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Managua", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(createdAt));
  return date + " " + time;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { operationId?: string };
  if (!body.operationId) return Response.json({ message: "Indique la operación a imprimir." }, { status: 400 });
  try {
    const operation = await getOperation(body.operationId);
    if (!operation) return Response.json({ message: "Operación no encontrada en el registro." }, { status: 404 });
    if (!operation.facturaDocEntry) return Response.json({ message: "Esta operación no generó factura en SAP; no hay recibo que imprimir." }, { status: 409 });
    const data = await getReceiptData(operation.facturaDocEntry, operation.pagoDocEntry);
    const bytes = await buildReceipt(data, operation.caja, operation.createdAt);
    return new Response(bytes.slice().buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="recibo-comtech-${data.invoiceDocNum}-80mm.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "No fue posible generar el recibo" }, { status: 502 });
  }
}

async function buildReceipt(data: ReceiptData, caja: string, createdAt: string) {
  const width = 226.77;
  const height = 360 + data.lines.length * 44;
  const pdf = await PDFDocument.create();
  pdf.setTitle("Recibo SAP-" + data.invoiceDocNum);
  const page = pdf.addPage([width, height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.08, 0.11);
  const cajaLabel = caja.replace(/^CAJA([0-9]+)$/, "CAJA $1");
  const money = (value: number) => data.currency + " " + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let y = height - 24;
  const center = (value: string, size: number, font: PDFFont = regular) => {
    const text = pdfText(value);
    page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: ink });
  };
  const pair = (left: string, right: string, size = 8, font: PDFFont = regular) => {
    const text = pdfText(right);
    page.drawText(pdfText(left), { x: 12, y, size, font, color: ink });
    page.drawText(text, { x: width - 12 - font.widthOfTextAtSize(text, size), y, size, font, color: ink });
  };
  const rule = () => {
    page.drawLine({ start: { x: 12, y }, end: { x: width - 12, y }, thickness: 0.6, dashArray: [3, 2], color: rgb(0.25, 0.25, 0.25) });
    y -= 10;
  };

  page.drawRectangle({ x: 83, y: y - 2, width: 26, height: 12, color: rgb(0.95, 0.04, 0.08) });
  page.drawRectangle({ x: 112, y: y + 8, width: 32, height: 12, color: rgb(0.95, 0.04, 0.08) });
  y -= 18; center("COMTECH", 18, bold); y -= 14; center("SHOWROOM - " + cajaLabel, 8, bold); y -= 11; center("Managua, Nicaragua", 7); y -= 14; rule();
  pair("FACTURA RESERVA", "SAP-" + data.invoiceDocNum, 8, bold); y -= 11;
  pair("FECHA", receiptDate(data.docDate, createdAt)); y -= 11;
  pair("CLIENTE", data.cardCode); y -= 11;
  if (data.cardName) { pair("", data.cardName.slice(0, 34), 7); y -= 11; }
  pair("CAJA", cajaLabel); y -= 14; rule();
  if (data.cancelled) { center("*** FACTURA CANCELADA EN SAP ***", 8, bold); y -= 14; }

  pair("CANT. DESCRIPCION", "TOTAL", 7, bold); y -= 13;
  for (const line of data.lines) {
    const rows = [""];
    for (const word of pdfText(line.qty + " x " + line.name).split(" ")) {
      const current = rows[rows.length - 1];
      if ((current + " " + word).trim().length <= 30) rows[rows.length - 1] = (current + " " + word).trim();
      else if (rows.length < 3) rows.push(word);
    }
    pair(rows[0], money(line.total), 7.5);
    for (const extra of rows.slice(1)) { y -= 9; page.drawText(extra, { x: 20, y, size: 7, font: regular, color: ink }); }
    y -= 10;
    page.drawText(pdfText(line.code + " - " + money(line.unit) + " c/u").slice(0, 44), { x: 16, y, size: 6, font: regular, color: rgb(0.3, 0.3, 0.3) });
    y -= 13;
  }

  rule();
  pair("SUBTOTAL", money(data.subtotal)); y -= 11;
  pair("IVA " + Math.round(data.taxRate * 100) + "%", money(data.vat)); y -= 14;
  pair("TOTAL", money(data.total), 10, bold); y -= 17; rule();
  if (data.payment && !data.payment.cancelled) {
    const method = data.payment.cash > 0 && data.payment.card > 0 ? "CONTADO Y TARJETA" : data.payment.card > 0 ? "TARJETA" : "CONTADO";
    pair("FORMA DE PAGO", method); y -= 11;
    if (data.payment.cash > 0) { pair("EFECTIVO", money(data.payment.cash)); y -= 11; }
    if (data.payment.card > 0) { pair("TARJETA", money(data.payment.card)); y -= 11; }
    pair("PAGO SAP", String(data.payment.docNum)); y -= 15;
    center("*** PAGO REGISTRADO ***", 7, bold);
  } else {
    center(data.payment?.cancelled ? "*** PAGO CANCELADO EN SAP ***" : "*** PAGO PENDIENTE ***", 7, bold);
  }
  y -= 18; center("SAP-" + data.invoiceDocNum, 9, bold); y -= 16; rule();
  center("GRACIAS POR SU COMPRA", 9, bold); y -= 13; center("Presente este recibo y sus artículos al salir.", 6.5); y -= 17; center("COPIA CLIENTE - COMTECH", 6);
  return pdf.save();
}
