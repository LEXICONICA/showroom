import { getSapIdentity, showroomDate } from "../../lib/sap";
import { listOperations } from "../../lib/operations";

export async function GET(request: Request) {
  try {
    const fecha = new URL(request.url).searchParams.get("fecha") || showroomDate();
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fecha)) return Response.json({ message: "Fecha inválida." }, { status: 400 });
    const who = getSapIdentity();
    return Response.json({ fecha, caja: who.caja, cajaLabel: who.cajaLabel, operaciones: await listOperations(fecha, who.caja) });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "No fue posible consultar el registro" }, { status: 500 });
  }
}
