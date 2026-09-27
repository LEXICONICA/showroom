import { listSellableItems } from "../../../lib/sap";

export async function GET() {
  try { return Response.json({ items: await listSellableItems(8) }); }
  catch (error) { return Response.json({ items: [], message: error instanceof Error ? error.message : "No fue posible cargar artículos" }, { status: 502 }); }
}
