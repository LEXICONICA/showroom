import { getCashClosure } from "../../../lib/sap";

export async function GET(request: Request) {
  try {
    const date = new URL(request.url).searchParams.get("date") || undefined;
    return Response.json(await getCashClosure(date));
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "No fue posible consultar el cierre" }, { status: 502 });
  }
}
