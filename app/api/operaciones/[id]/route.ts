import { getOperation } from "../../../lib/operations";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const operation = await getOperation(id);
    return operation ? Response.json(operation) : Response.json({ message: "Operación no encontrada." }, { status: 404 });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "No fue posible consultar la operación" }, { status: 500 });
  }
}
