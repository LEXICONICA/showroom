import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type ReceiptLine = { code: string; name: string; qty: number; price: number };
const cash = (value: number) => `C$ ${value.toFixed(2)}`;

export async function POST(request: Request) {
  const body = await request.json() as { lines?: ReceiptLine[]; invoice?: string; authorization?: string };
  if (!body.lines?.length) return Response.json({ message: "El recibo no contiene artículos" }, { status: 400 });
  if (body.lines.length > 50 || body.lines.some((line) =>
    !line || typeof line.code !== "string" || line.code.length > 100 ||
    typeof line.name !== "string" || line.name.length > 200 ||
    !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 100 ||
    !Number.isFinite(line.price) || line.price < 0 || line.price > 1_000_000
  )) return Response.json({ message: "El recibo contiene datos inválidos" }, { status: 400 });
  const width = 226.77;
  const height = 300 + body.lines.length * 44;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([width, height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = height - 24;
  const center = (text: string, size: number, font = regular) => page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: rgb(0.05, 0.08, 0.11) });
  const pair = (left: string, right: string, size = 8, font = regular) => { page.drawText(left, { x: 12, y, size, font }); page.drawText(right, { x: width - 12 - font.widthOfTextAtSize(right, size), y, size, font }); };
  const rule = () => { page.drawLine({ start: { x: 12, y }, end: { x: width - 12, y }, thickness: .6, dashArray: [3, 2], color: rgb(.25, .25, .25) }); y -= 10; };
  page.drawRectangle({ x: 83, y: y - 2, width: 26, height: 12, color: rgb(.95, .04, .08) });
  page.drawRectangle({ x: 112, y: y + 8, width: 32, height: 12, color: rgb(.95, .04, .08) });
  y -= 18; center("COMTECH", 18, bold); y -= 14; center("SHOWROOM - CAJA RAPIDA", 8, bold); y -= 11; center("Managua, Nicaragua", 7); y -= 14; rule();
  pair("FACTURA RESERVA", body.invoice || "FAC-00018472", 8, bold); y -= 11; pair("CLIENTE", "CN999999"); y -= 11; pair("CAJA", "CAJA 01"); y -= 14; rule();
  pair("CANT. DESCRIPCION", "TOTAL", 7, bold); y -= 13;
  const subtotal = body.lines.reduce((sum, line) => sum + line.price * line.qty, 0) / 1.15;
  for (const line of body.lines) {
    const words = `${line.qty} x ${line.name}`.split(" ");
    const nameLines = words.reduce<string[]>((rows, word) => { const last = rows[rows.length - 1] || ""; if (`${last} ${word}`.trim().length <= 30) rows[rows.length - 1] = `${last} ${word}`.trim(); else if (rows.length < 2) rows.push(word); return rows; }, [""]);
    page.drawText(nameLines[0], { x: 12, y, size: 7.5, font: regular });
    const amount = cash(line.price * line.qty); page.drawText(amount, { x: width - 12 - regular.widthOfTextAtSize(amount, 7.5), y, size: 7.5, font: regular });
    if (nameLines[1]) { y -= 9; page.drawText(nameLines[1], { x: 20, y, size: 7, font: regular }); }
    y -= 10; page.drawText(`${line.code} - ${cash(line.price)} c/u`.slice(0, 42), { x: 16, y, size: 6, font: regular, color: rgb(.3, .3, .3) }); y -= 13;
  }
  rule(); pair("SUBTOTAL", cash(subtotal)); y -= 11; pair("IVA 15%", cash(subtotal * .15)); y -= 14; pair("TOTAL CORDOBAS", cash(subtotal * 1.15), 10, bold); y -= 17; rule();
  pair("PAGO", "TARJETA"); y -= 11; pair("AUT. POS", body.authorization || "846291"); y -= 15; center("*** TRANSACCION APROBADA ***", 7, bold); y -= 18; center(body.invoice || "FAC-00018472", 9, bold); y -= 16; rule();
  center("GRACIAS POR SU COMPRA", 9, bold); y -= 13; center("Presente este recibo y sus articulos al salir.", 6.5); y -= 17; center("COPIA CLIENTE - COMTECH", 6);
  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="recibo-comtech-80mm.pdf"` } });
}
