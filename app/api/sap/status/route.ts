import { getSapRuntimeStatus } from "../../../lib/sap";

export async function GET() {
  try { return Response.json(await getSapRuntimeStatus()); }
  catch (error) { return Response.json({ connected: false, message: error instanceof Error ? error.message : "No fue posible conectar" }, { status: 503 }); }
}
