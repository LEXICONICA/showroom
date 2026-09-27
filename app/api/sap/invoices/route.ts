import { createInvoiceAndPayment } from "../../../lib/sap";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { lines?: Array<{ itemCode: string; quantity: number }>; payment?: { method?: "cash" | "card" | "mixed"; cashAmount?: number } };
    if (!body.lines?.length) return Response.json({ message: "La factura no contiene artículos" }, { status: 400 });
    if (!body.payment?.method) return Response.json({ message: "Seleccione una forma de pago" }, { status: 400 });
    const result = await createInvoiceAndPayment(body.lines, { method: body.payment.method, cashAmount: body.payment.cashAmount });
    return Response.json(result, { status: result.payment ? 201 : 409 });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "No fue posible crear la factura" }, { status: 502 });
  }
}
