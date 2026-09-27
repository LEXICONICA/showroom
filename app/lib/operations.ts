import { sql } from "drizzle-orm";
import { getDb } from "../../db";

export type OperationStatus = "completada" | "factura_sin_pago" | "fallida" | "rechazada_validacion";
export type StepStatus = "ok" | "error";
export type OperationStep = {
  at: string;
  name: string;
  status: StepStatus;
  detail: string;
  request?: unknown;
  response?: unknown;
};

export type OperationRecord = {
  id: string;
  createdAt: string;
  fecha: string;
  caja: string;
  usuario: string;
  companyDb: string;
  metodo: string | null;
  estado: OperationStatus;
  total: number | null;
  efectivo: number | null;
  tarjeta: number | null;
  facturaDocEntry: number | null;
  facturaDocNum: number | null;
  pagoDocEntry: number | null;
  pagoDocNum: number | null;
  error: string | null;
  lineas: unknown;
  pasos: OperationStep[];
};

type Row = {
  id: string; created_at: string; fecha: string; caja: string; usuario: string; company_db: string;
  metodo: string | null; estado: OperationStatus; total: number | null; efectivo: number | null; tarjeta: number | null;
  factura_docentry: number | null; factura_docnum: number | null; pago_docentry: number | null; pago_docnum: number | null;
  error: string | null; lineas: string | null; pasos: string | null;
};

// Acumula los pasos de un cobro; se guarda una sola fila al terminar, haya éxito o error.
export class OperationTrace {
  readonly id = crypto.randomUUID();
  readonly createdAt = new Date().toISOString();
  readonly steps: OperationStep[] = [];

  step(name: string, status: StepStatus, detail: string, extra: { request?: unknown; response?: unknown } = {}) {
    this.steps.push({ at: new Date().toISOString(), name, status, detail, ...extra });
  }
}

let tableReady: Promise<unknown> | null = null;

// La tabla se crea al primer uso para no depender de migraciones en cada caja.
function ensureTable() {
  tableReady ??= getDb().run(sql`CREATE TABLE IF NOT EXISTS operaciones (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    fecha TEXT NOT NULL,
    caja TEXT NOT NULL,
    usuario TEXT NOT NULL,
    company_db TEXT NOT NULL,
    metodo TEXT,
    estado TEXT NOT NULL,
    total REAL,
    efectivo REAL,
    tarjeta REAL,
    factura_docentry INTEGER,
    factura_docnum INTEGER,
    pago_docentry INTEGER,
    pago_docnum INTEGER,
    error TEXT,
    lineas TEXT,
    pasos TEXT
  )`).then(() => getDb().run(sql`CREATE INDEX IF NOT EXISTS operaciones_fecha_caja ON operaciones (fecha, caja)`))
    .catch((error) => { tableReady = null; throw error; });
  return tableReady;
}

export async function saveOperation(record: Omit<OperationRecord, "pasos"> & { pasos: OperationStep[] }) {
  await ensureTable();
  await getDb().run(sql`INSERT INTO operaciones (
    id, created_at, fecha, caja, usuario, company_db, metodo, estado, total, efectivo, tarjeta,
    factura_docentry, factura_docnum, pago_docentry, pago_docnum, error, lineas, pasos
  ) VALUES (
    ${record.id}, ${record.createdAt}, ${record.fecha}, ${record.caja}, ${record.usuario}, ${record.companyDb},
    ${record.metodo}, ${record.estado}, ${record.total}, ${record.efectivo}, ${record.tarjeta},
    ${record.facturaDocEntry}, ${record.facturaDocNum}, ${record.pagoDocEntry}, ${record.pagoDocNum},
    ${record.error}, ${JSON.stringify(record.lineas ?? null)}, ${JSON.stringify(record.pasos)}
  )`);
}

function toRecord(row: Row): OperationRecord {
  return {
    id: row.id, createdAt: row.created_at, fecha: row.fecha, caja: row.caja, usuario: row.usuario, companyDb: row.company_db,
    metodo: row.metodo, estado: row.estado, total: row.total, efectivo: row.efectivo, tarjeta: row.tarjeta,
    facturaDocEntry: row.factura_docentry, facturaDocNum: row.factura_docnum, pagoDocEntry: row.pago_docentry, pagoDocNum: row.pago_docnum,
    error: row.error, lineas: row.lineas ? JSON.parse(row.lineas) : null, pasos: row.pasos ? JSON.parse(row.pasos) : [],
  };
}

export async function listOperations(fecha: string, caja: string) {
  await ensureTable();
  const rows = await getDb().all<Row>(sql`SELECT * FROM operaciones WHERE fecha = ${fecha} AND caja = ${caja} ORDER BY created_at DESC LIMIT 500`);
  return rows.map(toRecord).map(({ pasos, lineas, ...summary }) => ({ ...summary, pasosCount: pasos.length, lineasCount: Array.isArray(lineas) ? lineas.length : 0 }));
}

export async function getOperation(id: string) {
  await ensureTable();
  const row = await getDb().get<Row>(sql`SELECT * FROM operaciones WHERE id = ${id}`);
  return row ? toRecord(row) : null;
}
