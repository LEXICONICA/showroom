import { createInvoiceAndPayment, getSapIdentity, showroomDate } from "../../../lib/sap";
import { OperationTrace, saveOperation, type OperationStatus } from "../../../lib/operations";

type InvoiceBody = {
  lines?: Array<{ itemCode: string; quantity: number; name?: string; price?: number }>;
  payment?: { method?: "cash" | "card" | "mixed"; cashAmount?: number };
};

function identity() {
  try { return getSapIdentity(); } catch { return { caja: process.env.CAJA_ID || "CAJA01", cajaLabel: process.env.CAJA_ID || "CAJA01", usuario: process.env.SAP_USERNAME || "", companyDb: process.env.SAP_COMPANY_DB || "" }; }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as InvoiceBody;
  if (!body.lines?.length) return Response.json({ message: "La factura no contiene artículos" }, { status: 400 });
  if (!body.payment?.method) return Response.json({ message: "Seleccione una forma de pago" }, { status: 400 });

  const trace = new OperationTrace();
  let result: Awaited<ReturnType<typeof createInvoiceAndPayment>> | null = null;
  let failure: string | null = null;
  try {
    const lines = body.lines.map(({ itemCode, quantity }) => ({ itemCode, quantity }));
    result = await createInvoiceAndPayment(lines, { method: body.payment.method, cashAmount: body.payment.cashAmount }, trace);
  } catch (error) {
    failure = error instanceof Error ? error.message : "No fue posible crear la factura";
    if (!trace.steps.some((step) => step.status === "error")) trace.step("Operación", "error", failure);
  }

  const who = identity();
  const estado: OperationStatus = failure ? "fallida" : result?.payment ? "completada" : "factura_sin_pago";
  const operation = { id: trace.id, createdAt: trace.createdAt, caja: who.caja, cajaLabel: who.cajaLabel, usuario: who.usuario, companyDb: who.companyDb };
  let registroError: string | null = null;
  try {
    // El registro nunca debe impedir responder la venta: si falla, se informa aparte.
    await saveOperation({
      id: trace.id, createdAt: trace.createdAt, fecha: showroomDate(), caja: who.caja, usuario: who.usuario, companyDb: who.companyDb,
      metodo: body.payment.method, estado,
      total: result?.invoice?.DocTotal ?? null,
      efectivo: result && "cashAmount" in result ? result.cashAmount ?? null : null,
      tarjeta: result && "cardAmount" in result ? result.cardAmount ?? null : null,
      facturaDocEntry: result?.invoice?.DocEntry ?? null, facturaDocNum: result?.invoice?.DocNum ?? null,
      pagoDocEntry: result?.payment?.DocEntry ?? null, pagoDocNum: result?.payment?.DocNum ?? null,
      error: failure ?? result?.paymentError ?? null,
      lineas: body.lines, pasos: trace.steps,
    });
  } catch (error) {
    registroError = error instanceof Error ? error.message : "No fue posible guardar el registro";
    console.error("Registro de operaciones:", registroError);
  }

  if (failure) return Response.json({ message: failure, operation, registroError }, { status: 502 });
  return Response.json({ ...result, operation, registroError }, { status: result?.payment ? 201 : 409 });
}
