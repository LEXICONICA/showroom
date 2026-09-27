import { validateSaleLines } from "../../../lib/sap";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { lines?: Array<{ itemCode: string; quantity: number }> };
    if (!body.lines?.length) return Response.json({ valid: false, message: "La compra está vacía" }, { status: 400 });
    return Response.json(await validateSaleLines(body.lines));
  } catch (error) {
    return Response.json({ valid: false, message: error instanceof Error ? error.message : "No fue posible validar la compra" }, { status: 409 });
  }
}
