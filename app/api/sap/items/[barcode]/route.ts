import { findItemByBarcode } from "../../../../lib/sap";

export async function GET(_request: Request, context: { params: Promise<{ barcode: string }> }) {
  try {
    const { barcode } = await context.params;
    const item = await findItemByBarcode(decodeURIComponent(barcode));
    return item ? Response.json(item) : Response.json({ message: "Artículo no disponible en la bodega SHOWROOM" }, { status: 404 });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Error consultando SAP" }, { status: 502 });
  }
}
