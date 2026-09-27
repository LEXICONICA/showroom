import { getSapIdentity, showroomDate, validateSaleLines } from "../../../lib/sap";
import { OperationTrace, saveOperation } from "../../../lib/operations";

type ValidateBody = { lines?: Array<{ itemCode: string; quantity: number; name?: string; price?: number }> };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as ValidateBody;
  if (!body.lines?.length) return Response.json({ valid: false, message: "La compra está vacía" }, { status: 400 });
  try {
    return Response.json(await validateSaleLines(body.lines.map(({ itemCode, quantity }) => ({ itemCode, quantity }))));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible validar la compra";
    // Las ventas rechazadas antes de facturar también quedan en el registro.
    const trace = new OperationTrace();
    trace.step("Validación de artículos", "error", message, { request: body.lines });
    let operation: { id: string; createdAt: string } | null = null;
    try {
      const who = getSapIdentity();
      await saveOperation({
        id: trace.id, createdAt: trace.createdAt, fecha: showroomDate(), caja: who.caja, usuario: who.usuario, companyDb: who.companyDb,
        metodo: null, estado: "rechazada_validacion", total: null, efectivo: null, tarjeta: null,
        facturaDocEntry: null, facturaDocNum: null, pagoDocEntry: null, pagoDocNum: null,
        error: message, lineas: body.lines, pasos: trace.steps,
      });
      operation = { id: trace.id, createdAt: trace.createdAt };
    } catch (registroError) {
      console.error("Registro de operaciones:", registroError instanceof Error ? registroError.message : registroError);
    }
    return Response.json({ valid: false, message, operation }, { status: 409 });
  }
}
