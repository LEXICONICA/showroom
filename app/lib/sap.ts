import type { OperationTrace } from "./operations";

type SapSession = { cookie: string };
type SaleLine = { itemCode: string; quantity: number };
export type PaymentMethod = "cash" | "card" | "mixed";
type PaymentSelection = { method: PaymentMethod; cashAmount?: number };

const WRITABLE_COMPANY_DB = "SBO_COMTECH_DEMO";
const SAP_REQUEST_TIMEOUT_MS = 15_000;
const SAP_SESSION_TTL_MS = 20 * 60_000;
const SAP_METADATA_TTL_MS = 5 * 60_000;

let sessionCache: { value: SapSession; expiresAt: number } | null = null;
let sessionRequest: Promise<SapSession> | null = null;
let priceListCache: { value: number; expiresAt: number } | null = null;
let priceListRequest: Promise<number> | null = null;
const currencyRateRequests = new Map<string, Promise<number>>();

export function showroomDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function assertValidSaleLines(lines: SaleLine[]) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) {
    throw new Error("La compra debe contener entre 1 y 50 artículos diferentes.");
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line || typeof line.itemCode !== "string" || !/^[\w .\-/]{1,100}$/u.test(line.itemCode)) {
      throw new Error("La compra contiene un código de artículo inválido.");
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw new Error(`La cantidad de ${line.itemCode} debe ser un entero entre 1 y 100.`);
    }
    if (seen.has(line.itemCode)) throw new Error(`El artículo ${line.itemCode} está duplicado en la solicitud.`);
    seen.add(line.itemCode);
  }
}

function config() {
  return {
    baseUrl: process.env.SAP_SERVICE_LAYER_URL?.replace(/\/$/, ""),
    companyDb: process.env.SAP_COMPANY_DB,
    userName: process.env.SAP_USERNAME,
    password: process.env.SAP_PASSWORD,
    customer: process.env.SAP_DEFAULT_CUSTOMER || "CN999990",
    priceList: Number(process.env.SAP_PRICE_LIST || 1),
    warehouse: process.env.SAP_DEFAULT_WAREHOUSE,
    documentCurrency: process.env.SAP_DOCUMENT_CURRENCY || "C$",
    invoiceSeries: process.env.SAP_INVOICE_SERIES ? Number(process.env.SAP_INVOICE_SERIES) : null,
    creditCardCode: Number(process.env.SAP_CREDIT_CARD_CODE || 2),
    creditCardAccount: process.env.SAP_CREDIT_CARD_ACCOUNT || "111-01-005",
    cashAccount: process.env.SAP_CASH_ACCOUNT || "111-01-001",
    paymentMethodCode: Number(process.env.SAP_PAYMENT_METHOD_CODE || 1),
    taxCode: process.env.SAP_TAX_CODE || "IVA",
    taxRate: Number(process.env.SAP_TAX_RATE || 0.15),
    cajaId: getCajaId(),
  };
}

// Identifica la caja en los pagos de SAP (Remarks y comprobante); el cierre de caja filtra por este valor.
export function getCajaId() {
  const value = (process.env.CAJA_ID || "CAJA01").trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(value)) throw new Error("CAJA_ID inválido: use solo letras y números, por ejemplo CAJA02.");
  return value;
}

// "CAJA02" -> "CAJA 02" para pantalla y recibo.
export function getCajaLabel() {
  return getCajaId().replace(/^CAJA(\d+)$/, "CAJA $1");
}

function assertDemoWriteTarget() {
  const sap = config();
  if (sap.companyDb !== WRITABLE_COMPANY_DB) {
    throw new Error(`Escritura bloqueada: esta aplicación solo puede facturar en ${WRITABLE_COMPANY_DB}.`);
  }
  if (process.env.SAP_ENABLE_POSTING !== "true") {
    throw new Error("Emisión real deshabilitada por configuración.");
  }
}

async function errorMessage(response: Response) {
  try {
    const payload = await response.json() as { error?: { message?: { value?: string } } };
    return payload.error?.message?.value || `SAP respondió ${response.status}`;
  } catch { return `SAP respondió ${response.status}`; }
}

type SapSeries = { Series: number; Name?: string; Locked?: string; NextNumber?: number | null; LastNumber?: number | null };
type InvoiceSeries = { series: number; name: string; nextNumber: number | null; remaining: number | null; source: "configurada" | "por defecto" };

// Las facturas de reserva usan las series de facturas de clientes (objeto 13). Sin SAP_INVOICE_SERIES se usa
// la serie por defecto del usuario SAP, así la caja sigue el talonario que asigne el administrador.
async function resolveInvoiceSeries(session: SapSession): Promise<InvoiceSeries> {
  const sap = config();
  const headers = { Cookie: session.cookie, "Content-Type": "application/json" };
  const body = JSON.stringify({ DocumentTypeParams: { Document: "13", DocumentSubType: "--" } });
  const source = sap.invoiceSeries ? "configurada" : "por defecto";
  let series: SapSeries | undefined;
  if (sap.invoiceSeries) {
    const response = await sapFetch(`${sap.baseUrl}/SeriesService_GetDocumentSeries`, { method: "POST", headers, body, cache: "no-store" });
    if (!response.ok) throw new Error(`No fue posible consultar las series de factura en SAP: ${await errorMessage(response)}`);
    const data = await response.json() as SapSeries[] | { value?: SapSeries[] };
    series = (Array.isArray(data) ? data : data.value || []).find((row) => row.Series === sap.invoiceSeries);
    if (!series) throw new Error(`La serie ${sap.invoiceSeries} (SAP_INVOICE_SERIES) no existe para facturas de clientes en SAP. Quite SAP_INVOICE_SERIES para usar la serie por defecto del usuario.`);
  } else {
    const response = await sapFetch(`${sap.baseUrl}/SeriesService_GetDefaultSeries`, { method: "POST", headers, body, cache: "no-store" });
    if (!response.ok) throw new Error(`El usuario SAP ${sap.userName} no tiene serie por defecto para facturas de clientes: ${await errorMessage(response)}`);
    series = await response.json() as SapSeries;
  }
  const label = `${series.Series} (${series.Name || "sin nombre"})`;
  if (series.Locked === "tYES") throw new Error(`La serie ${label} está bloqueada en SAP.`);
  const next = series.NextNumber ?? null;
  const last = series.LastNumber ?? null;
  const remaining = next != null && last != null ? last - next + 1 : null;
  if (remaining != null && remaining <= 0) {
    const fix = source === "configurada"
      ? "Quite SAP_INVOICE_SERIES para usar la serie por defecto del usuario, o configure otra serie."
      : `Asigne en SAP una nueva serie por defecto de factura al usuario ${sap.userName}.`;
    throw new Error(`La serie ${label} está agotada: último número ${last}. ${fix}`);
  }
  return { series: series.Series, name: series.Name || "", nextNumber: next, remaining, source };
}

async function sapFetch(url: string, init: RequestInit = {}) {
  const proxy = process.env.SAP_LOCAL_PROXY_URL;
  const requestInit = { ...init, signal: init.signal ?? AbortSignal.timeout(SAP_REQUEST_TIMEOUT_MS) };
  if (!proxy) return fetch(url, requestInit);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  return fetch(`${proxy}/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, method: init.method || "GET", headers, body: init.body || undefined }),
    cache: "no-store",
    signal: requestInit.signal,
  });
}

export async function login(): Promise<SapSession> {
  if (sessionCache && sessionCache.expiresAt > Date.now()) return sessionCache.value;
  if (sessionRequest) return sessionRequest;

  sessionRequest = loginFresh();
  try {
    const session = await sessionRequest;
    sessionCache = { value: session, expiresAt: Date.now() + SAP_SESSION_TTL_MS };
    return session;
  } finally {
    sessionRequest = null;
  }
}

export async function getSapRuntimeStatus() {
  const sap = config();
  await login();
  return {
    connected: true,
    companyDb: sap.companyDb,
    writeEnabled: process.env.SAP_ENABLE_POSTING === "true" && sap.companyDb === WRITABLE_COMPANY_DB,
    documentType: "AR_RESERVE_INVOICE",
    cajaId: sap.cajaId,
    cajaLabel: getCajaLabel(),
  };
}

async function loginFresh(): Promise<SapSession> {
  const sap = config();
  if (!sap.baseUrl || !sap.companyDb || !sap.userName || !sap.password) throw new Error("Configuración SAP incompleta");
  const response = await sapFetch(`${sap.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: sap.companyDb, UserName: sap.userName, Password: sap.password }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const data = await response.json() as { SessionId: string };
  return { cookie: `B1SESSION=${data.SessionId}` };
}

// Tasa oficial de SAP (tabla ORTT) para la fecha del showroom, no la fecha UTC del servidor.
async function getSapCurrencyRate(currency: string, session: SapSession) {
  if (!currency || currency === "NIO" || currency === config().documentCurrency) return 1;
  const cacheKey = `${showroomDate()}:${currency}`;
  const pending = currencyRateRequests.get(cacheKey);
  if (pending) return pending;

  const request = fetchSapCurrencyRate(currency, session);
  currencyRateRequests.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    currencyRateRequests.delete(cacheKey);
    throw error;
  }
}

async function fetchSapCurrencyRate(currency: string, session: SapSession) {
  const sap = config();
  const date = showroomDate();
  const response = await sapFetch(`${sap.baseUrl}/SBOBobService_GetCurrencyRate`, {
    method: "POST",
    headers: { Cookie: session.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ Currency: currency, Date: date }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`No se encontró la tasa ${currency}/NIO en SAP: ${await errorMessage(response)}`);
  const data = await response.json() as number | { value?: number };
  const rate = typeof data === "number" ? data : data.value;
  if (!rate || rate <= 0) throw new Error(`La tasa ${currency}/NIO de SAP no es válida`);
  return rate;
}

async function getSalesPriceList(session: SapSession) {
  if (priceListCache && priceListCache.expiresAt > Date.now()) return priceListCache.value;
  if (priceListRequest) return priceListRequest;

  priceListRequest = fetchSalesPriceList(session);
  try {
    const value = await priceListRequest;
    priceListCache = { value, expiresAt: Date.now() + SAP_METADATA_TTL_MS };
    return value;
  } finally {
    priceListRequest = null;
  }
}

async function fetchSalesPriceList(session: SapSession) {
  const sap = config();
  const response = await sapFetch(`${sap.baseUrl}/BusinessPartners('${sap.customer}')?$select=PriceListNum`, {
    headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store"
  });
  if (response.ok) {
    const partner = await response.json() as { PriceListNum?: number };
    if (Number.isInteger(partner.PriceListNum)) return partner.PriceListNum as number;
  }
  if (process.env.SAP_ENABLE_POSTING !== "true" && Number.isInteger(sap.priceList) && sap.priceList > 0) return sap.priceList;
  throw new Error(`El cliente ${sap.customer} no existe o no tiene lista de precios en SAP.`);
}

export async function findItemByBarcode(barcode: string) {
  const sap = config();
  const session = await login();
  const safe = barcode.replace(/'/g, "''");
  const select = "ItemCode,ItemName,BarCode,SalesUnit,SalesUnitLength,ManageSerialNumbers,ItemWarehouseInfoCollection";
  const url = `${sap.baseUrl}/Items?$select=${select}&$filter=BarCode eq '${encodeURIComponent(safe)}'`;
  const response = await sapFetch(url, { headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  const data = await response.json() as { value?: Array<Record<string, unknown>> };
  let item = data.value?.[0];
  if (!item) {
    const direct = await sapFetch(`${sap.baseUrl}/Items('${encodeURIComponent(safe)}')?$select=${select}`, { headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store" });
    if (direct.ok) item = await direct.json() as Record<string, unknown>;
  }
  if (!item) return null;

  const warehouseRows = item.ItemWarehouseInfoCollection as Array<{ WarehouseCode: string; InStock: number; Committed: number }> | undefined;
  const showroom = warehouseRows?.find((row) => row.WarehouseCode === sap.warehouse);
  let availableStock = showroom ? showroom.InStock - showroom.Committed : 0;
  if (!showroom || availableStock <= 0) return null;
  if (item.ManageSerialNumbers === "tYES") {
    const itemParam = encodeURIComponent(`'${String(item.ItemCode).replace(/'/g, "''")}'`);
    const warehouseParam = encodeURIComponent(`'${(sap.warehouse || "").replace(/'/g, "''")}'`);
    const serialResponse = await sapFetch(`${sap.baseUrl}/SQLQueries('showroom_serials_v1')/List?itemCode=${itemParam}&warehouse=${warehouseParam}`, {
      headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store"
    });
    if (!serialResponse.ok) throw new Error(await errorMessage(serialResponse));
    const serials = await serialResponse.json() as { value?: unknown[] };
    availableStock = Math.min(availableStock, serials.value?.length || 0);
    if (availableStock <= 0) return null;
  }

  // SAP calcula el precio de acuerdo con el cliente y su lista asignada.
  const priceListNum = await getSalesPriceList(session);
  const itemCode = String(item.ItemCode).replace(/'/g, "''");
  const priceUrl = `${sap.baseUrl}/Items('${encodeURIComponent(itemCode)}')?$select=ItemPrices`;
  const itemPriceResponse = await sapFetch(priceUrl, { headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store" });
  if (!itemPriceResponse.ok) throw new Error(await errorMessage(itemPriceResponse));
  const priced = await itemPriceResponse.json() as { ItemPrices?: Array<{ PriceList: number; Price: number; Currency: string }> };
  const price = priced.ItemPrices?.find((p) => p.PriceList === priceListNum);
  if (!price) throw new Error(`El artículo no tiene precio en la lista asignada al cliente ${sap.customer}`);
  const exchangeRate = await getSapCurrencyRate(price.Currency, session);
  return {
    code: barcode,
    itemCode: item.ItemCode,
    name: item.ItemName,
    detail: `${item.SalesUnit || "Unidad"} · SAP`,
    price: Math.round(price.Price * exchangeRate * (1 + sap.taxRate) * 100) / 100,
    currency: "NIO",
    sourceCurrency: price.Currency,
    sourcePrice: price.Price,
    exchangeRate,
    stock: availableStock,
    warehouse: sap.warehouse,
  };
}

export async function listSellableItems(limit = 6) {
  const sap = config();
  const session = await login();
  const priceListNum = await getSalesPriceList(session);
  type SapItem = { ItemCode: string; ItemName: string; BarCode: string; ManageSerialNumbers?: string; ItemPrices?: Array<{ PriceList: number; Price: number; Currency: string }>; ItemWarehouseInfoCollection?: Array<{ WarehouseCode: string; InStock: number; Committed: number }> };
  const query = `$select=ItemCode,ItemName,BarCode,ManageSerialNumbers,ItemPrices,ItemWarehouseInfoCollection&$filter=SalesItem eq 'tYES' and Frozen eq 'tNO'&$top=100`;
  let nextUrl: string | null = `${sap.baseUrl}/Items?${query}`;
  const candidates: Array<{ item: SapItem; warehouse: { WarehouseCode: string; InStock: number; Committed: number } }> = [];
  for (let page = 0; nextUrl && page < 20 && candidates.length < limit * 4; page += 1) {
    const response = await sapFetch(nextUrl, { headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response));
    const data = await response.json() as { value?: SapItem[]; "odata.nextLink"?: string; "@odata.nextLink"?: string };
    for (const item of data.value || []) {
      const warehouse = item.ItemWarehouseInfoCollection?.find((row) => row.WarehouseCode === sap.warehouse);
      if (warehouse && warehouse.InStock - warehouse.Committed > 0) candidates.push({ item, warehouse });
    }
    const next = data["odata.nextLink"] || data["@odata.nextLink"];
    nextUrl = next ? (next.startsWith("http") ? next : `${sap.baseUrl}/${next.replace(/^\//, "")}`) : null;
  }
  const items = candidates.slice(0, limit * 4);
  return Promise.all(items.map(async ({ item, warehouse }) => {
    const price = item.ItemPrices?.find((p) => p.PriceList === priceListNum);
    if (!price) return null;
    let availableStock = (warehouse?.InStock || 0) - (warehouse?.Committed || 0);
    if (item.ManageSerialNumbers === "tYES") {
      const itemParam = encodeURIComponent(`'${item.ItemCode.replace(/'/g, "''")}'`);
      const warehouseParam = encodeURIComponent(`'${(sap.warehouse || "").replace(/'/g, "''")}'`);
      const serialResponse = await sapFetch(`${sap.baseUrl}/SQLQueries('showroom_serials_v1')/List?itemCode=${itemParam}&warehouse=${warehouseParam}`, {
        headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store"
      });
      if (!serialResponse.ok) return null;
      const serials = await serialResponse.json() as { value?: unknown[] };
      availableStock = Math.min(availableStock, serials.value?.length || 0);
      if (availableStock <= 0) return null;
    }
    const exchangeRate = await getSapCurrencyRate(price.Currency, session);
    return { code: item.BarCode || item.ItemCode, itemCode: item.ItemCode, name: item.ItemName, detail: item.BarCode ? "Código de barras SAP" : "Código de artículo SAP", price: Math.round(price.Price * exchangeRate * (1 + sap.taxRate) * 100) / 100, currency: "NIO", exchangeRate, stock: availableStock, warehouse: sap.warehouse };
  })).then((result) => result.filter(Boolean).slice(0, limit));
}

export async function createInvoice(lines: SaleLine[], existingSession?: SapSession, trace?: OperationTrace) {
  assertValidSaleLines(lines);
  assertDemoWriteTarget();
  const sap = config();
  const session = existingSession ?? await login();
  let invoiceSeries: InvoiceSeries;
  try {
    invoiceSeries = await resolveInvoiceSeries(session);
    const left = invoiceSeries.remaining == null ? "sin límite de numeración" : `quedan ${invoiceSeries.remaining} números`;
    const warning = invoiceSeries.remaining != null && invoiceSeries.remaining <= 20 ? " Quedan pocos números: avise al administrador de SAP." : "";
    trace?.step("Serie de factura", "ok", `Serie ${invoiceSeries.series} (${invoiceSeries.name}), ${invoiceSeries.source}; próximo número ${invoiceSeries.nextNumber ?? "-"}, ${left}.${warning}`);
  } catch (error) {
    trace?.step("Serie de factura", "error", error instanceof Error ? error.message : String(error));
    throw error;
  }
  const documentLines = await Promise.all(lines.map(async (line) => {
    const code = line.itemCode.replace(/'/g, "''");
    const itemResponse = await sapFetch(`${sap.baseUrl}/Items('${encodeURIComponent(code)}')?$select=ItemCode,ManageSerialNumbers`, {
      headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store"
    });
    if (!itemResponse.ok) throw new Error(await errorMessage(itemResponse));
    const item = await itemResponse.json() as { ManageSerialNumbers?: string };
    let SerialNumbers: Array<Record<string, string | number>> | undefined;

    if (item.ManageSerialNumbers === "tYES") {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new Error(`La cantidad del artículo serializado ${line.itemCode} debe ser un número entero.`);
      }
      const itemParam = encodeURIComponent(`'${line.itemCode.replace(/'/g, "''")}'`);
      const warehouseParam = encodeURIComponent(`'${(sap.warehouse || "").replace(/'/g, "''")}'`);
      const serialResponse = await sapFetch(`${sap.baseUrl}/SQLQueries('showroom_serials_v1')/List?itemCode=${itemParam}&warehouse=${warehouseParam}`, {
        headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store"
      });
      if (!serialResponse.ok) throw new Error(`No fue posible consultar las series disponibles de ${line.itemCode}: ${await errorMessage(serialResponse)}`);
      const result = await serialResponse.json() as { value?: Array<{ DistNumber: string; MnfSerial?: string; SysNumber: number }> };
      const available = result.value || [];
      if (available.length < line.quantity) {
        throw new Error(`No hay suficientes números de serie disponibles para ${line.itemCode} en SHOWROOM. Disponibles: ${available.length}.`);
      }
      SerialNumbers = available.slice(0, line.quantity).map((serial) => ({
        InternalSerialNumber: serial.DistNumber,
        ManufacturerSerialNumber: serial.MnfSerial || serial.DistNumber,
        SystemSerialNumber: serial.SysNumber,
        Quantity: 1,
      }));
    }

    return {
      ItemCode: line.itemCode,
      Quantity: line.quantity,
      TaxCode: sap.taxCode,
      ...(sap.warehouse ? { WarehouseCode: sap.warehouse } : {}),
      ...(SerialNumbers ? { SerialNumbers } : {}),
    };
  }));
  const invoicePayload = {
    CardCode: sap.customer,
    DocCurrency: sap.documentCurrency,
    Series: invoiceSeries.series,
    ReserveInvoice: "tYES",
    DocumentLines: documentLines,
    Comments: `Factura de reserva · ${getCajaLabel()} Showroom · pago confirmado por POS`,
  };
  const response = await sapFetch(`${sap.baseUrl}/Invoices`, {
    method: "POST",
    headers: { Cookie: session.cookie, "Content-Type": "application/json" },
    body: JSON.stringify(invoicePayload),
  });
  if (!response.ok) {
    const message = await errorMessage(response);
    trace?.step("Factura de reserva", "error", `SAP rechazó la factura (HTTP ${response.status}): ${message}`, { request: invoicePayload, response: { status: response.status, message } });
    throw new Error(message);
  }
  const invoice = await response.json() as { DocEntry: number; DocNum: number; DocTotal: number; DocCurrency: string };
  trace?.step("Factura de reserva", "ok", `Factura de reserva SAP ${invoice.DocNum} creada (DocEntry ${invoice.DocEntry}).`, {
    request: invoicePayload,
    response: { status: response.status, DocEntry: invoice.DocEntry, DocNum: invoice.DocNum, DocTotal: invoice.DocTotal, DocCurrency: invoice.DocCurrency },
  });
  return invoice;
}

export async function validateSaleLines(lines: SaleLine[], existingSession?: SapSession) {
  assertValidSaleLines(lines);
  const sap = config();
  const session = existingSession ?? await login();
  await Promise.all(lines.map(async (line) => {
    const code = line.itemCode.replace(/'/g, "''");
    const response = await sapFetch(`${sap.baseUrl}/Items('${encodeURIComponent(code)}')?$select=ItemCode,ItemName,Frozen,Valid,ManageSerialNumbers,ItemWarehouseInfoCollection`, {
      headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store"
    });
    if (!response.ok) throw new Error(`El artículo ${line.itemCode} ya no existe o no está disponible en SAP. Escanéelo nuevamente.`);
    const item = await response.json() as { ItemName?: string; Frozen?: string; Valid?: string; ManageSerialNumbers?: string; ItemWarehouseInfoCollection?: Array<{ WarehouseCode: string; InStock: number; Committed: number }> };
    if (item.Frozen === "tYES" || item.Valid === "tNO") throw new Error(`El artículo ${line.itemCode} está inactivo en SAP.`);
    const warehouse = item.ItemWarehouseInfoCollection?.find((row) => row.WarehouseCode === sap.warehouse);
    if (!warehouse) throw new Error(`El artículo ${line.itemCode} no está configurado en la bodega SHOWROOM.`);
    const available = warehouse.InStock - warehouse.Committed;
    if (available < line.quantity) throw new Error(`Existencia insuficiente de ${item.ItemName || line.itemCode} en SHOWROOM. Disponible: ${available}.`);
    if (item.ManageSerialNumbers === "tYES") {
      const itemParam = encodeURIComponent(`'${line.itemCode.replace(/'/g, "''")}'`);
      const warehouseParam = encodeURIComponent(`'${(sap.warehouse || "").replace(/'/g, "''")}'`);
      const serialResponse = await sapFetch(`${sap.baseUrl}/SQLQueries('showroom_serials_v1')/List?itemCode=${itemParam}&warehouse=${warehouseParam}`, {
        headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store"
      });
      if (!serialResponse.ok) throw new Error(`No fue posible validar las series de ${line.itemCode}: ${await errorMessage(serialResponse)}`);
      const serials = await serialResponse.json() as { value?: unknown[] };
      if ((serials.value?.length || 0) < line.quantity) {
        throw new Error(`No hay suficientes números de serie disponibles para ${item.ItemName || line.itemCode} en SHOWROOM.`);
      }
    }
  }));
  return { valid: true };
}

export async function createInvoiceAndPayment(lines: SaleLine[], paymentSelection: PaymentSelection, trace?: OperationTrace) {
  assertValidSaleLines(lines);
  assertDemoWriteTarget();
  if (!paymentSelection || !["cash", "card", "mixed"].includes(paymentSelection.method)) {
    throw new Error("Seleccione contado, tarjeta o ambos como forma de pago.");
  }
  if (paymentSelection.method === "mixed" && (!Number.isFinite(paymentSelection.cashAmount) || (paymentSelection.cashAmount || 0) <= 0)) {
    throw new Error("Ingrese un monto válido recibido en efectivo para el pago combinado.");
  }
  const sap = config();
  const session = await login();
  try {
    await validateSaleLines(lines, session);
    trace?.step("Validación de artículos", "ok", `${lines.length} artículo(s) con existencia en ${sap.warehouse}.`, { request: lines });
  } catch (error) {
    trace?.step("Validación de artículos", "error", error instanceof Error ? error.message : String(error), { request: lines });
    throw error;
  }
  let invoice: { DocEntry: number; DocNum: number; DocTotal: number; DocCurrency: string };
  try {
    invoice = await createInvoice(lines, session, trace);
  } catch (error) {
    if (!trace?.steps.some((step) => step.status === "error")) trace?.step("Factura de reserva", "error", error instanceof Error ? error.message : String(error));
    throw error;
  }
  const invoiceSummary = { DocEntry: invoice.DocEntry, DocNum: invoice.DocNum, DocTotal: invoice.DocTotal, DocCurrency: invoice.DocCurrency };
  const today = showroomDate();
  const voucher = `${sap.cajaId}-${invoice.DocNum}`;
  const cashAmount = paymentSelection.method === "cash"
    ? invoice.DocTotal
    : paymentSelection.method === "mixed"
      ? Math.round((paymentSelection.cashAmount || 0) * 100) / 100
      : 0;
  if (paymentSelection.method === "mixed" && cashAmount >= invoice.DocTotal) {
    trace?.step("Pago recibido", "error", "En pago combinado, el efectivo debe ser menor que el total de la factura.");
    return { invoice: invoiceSummary, payment: null, paymentError: "En pago combinado, el efectivo debe ser menor que el total de la factura." };
  }
  const cardAmount = Math.round((invoice.DocTotal - cashAmount) * 100) / 100;
  const methodCode = paymentSelection.method === "cash" ? "CASH" : paymentSelection.method === "card" ? "CARD" : "MIXED";
  const paymentCreditCards = cardAmount > 0 ? [{
    LineNum: 0, CreditCard: sap.creditCardCode, CreditAcct: sap.creditCardAccount,
    CreditCardNumber: "0000", CardValidUntil: "2030-12-31", VoucherNum: voucher,
    PaymentMethodCode: sap.paymentMethodCode, NumOfPayments: 1, FirstPaymentDue: today,
    FirstPaymentSum: cardAmount, AdditionalPaymentSum: 0, CreditSum: cardAmount,
    CreditCur: sap.documentCurrency, CreditRate: 0, NumOfCreditPayments: 1,
    CreditType: "cr_Regular", SplitPayments: "tNO"
  }] : undefined;
  const paymentPayload = {
    DocType: "rCustomer",
    CardCode: sap.customer,
    DocCurrency: sap.documentCurrency,
    Remarks: `${sap.cajaId}|${methodCode}|INV:${invoice.DocNum}`,
    PaymentInvoices: [{ DocEntry: invoice.DocEntry, InvoiceType: "it_Invoice", SumApplied: invoice.DocTotal }],
    ...(cashAmount > 0 ? { CashAccount: sap.cashAccount, CashSum: cashAmount } : {}),
    ...(paymentCreditCards ? { PaymentCreditCards: paymentCreditCards } : {}),
  };
  const response = await sapFetch(`${sap.baseUrl}/IncomingPayments`, {
    method: "POST",
    headers: { Cookie: session.cookie, "Content-Type": "application/json" },
    body: JSON.stringify(paymentPayload),
  });
  if (!response.ok) {
    const message = await errorMessage(response);
    trace?.step("Pago recibido", "error", `SAP rechazó el pago (HTTP ${response.status}): ${message}`, { request: paymentPayload, response: { status: response.status, message } });
    return { invoice: invoiceSummary, payment: null, paymentError: message, paymentMethod: paymentSelection.method, cashAmount, cardAmount };
  }
  const payment = await response.json() as { DocEntry: number; DocNum: number };
  trace?.step("Pago recibido", "ok", `Pago recibido SAP ${payment.DocNum} aplicado a la factura ${invoice.DocNum}.`, {
    request: paymentPayload,
    response: { status: response.status, DocEntry: payment.DocEntry, DocNum: payment.DocNum },
  });
  return { invoice: invoiceSummary, payment: { DocEntry: payment.DocEntry, DocNum: payment.DocNum }, paymentError: null, paymentMethod: paymentSelection.method, cashAmount, cardAmount };
}

export async function getCashClosure(date = showroomDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Fecha de cierre inválida.");
  const sap = config();
  if (sap.companyDb !== WRITABLE_COMPANY_DB) throw new Error(`El cierre solo está habilitado para ${WRITABLE_COMPANY_DB}.`);
  const session = await login();
  const query = `$select=DocEntry,DocNum,DocDate,CashSum,PaymentCreditCards,Remarks,Cancelled&$filter=DocDate eq '${date}'&$top=500`;
  const response = await sapFetch(`${sap.baseUrl}/IncomingPayments?${query}`, { headers: { Cookie: session.cookie, Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  const data = await response.json() as { value?: Array<{ DocEntry: number; DocNum: number; DocDate: string; CashSum?: number; Remarks?: string; Cancelled?: string; PaymentCreditCards?: Array<{ CreditSum?: number }> }> };
  const entries = (data.value || []).filter((row) => row.Remarks?.startsWith(`${sap.cajaId}|`) && row.Cancelled !== "tYES").map((row) => {
    const [, methodCode, invoiceMarker] = (row.Remarks || "").split("|");
    const cash = Number(row.CashSum || 0);
    const card = (row.PaymentCreditCards || []).reduce((sum, item) => sum + Number(item.CreditSum || 0), 0);
    return { paymentDocEntry: row.DocEntry, paymentDocNum: row.DocNum, invoiceDocNum: Number(invoiceMarker?.replace("INV:", "")) || null, method: methodCode === "CASH" ? "cash" : methodCode === "CARD" ? "card" : "mixed", cash, card, total: Math.round((cash + card) * 100) / 100 };
  });
  return {
    date,
    companyDb: sap.companyDb,
    cajaId: sap.cajaId,
    entries,
    totals: entries.reduce((sum, row) => ({ cash: sum.cash + row.cash, card: sum.card + row.card, total: sum.total + row.total }), { cash: 0, card: 0, total: 0 }),
  };
}

// Datos de la caja y el usuario SAP para registrar y mostrar cada operación.
export function getSapIdentity() {
  const sap = config();
  return { caja: sap.cajaId, cajaLabel: getCajaLabel(), usuario: sap.userName || "", companyDb: sap.companyDb || "" };
}

export type ReceiptData = {
  invoiceDocNum: number;
  docDate: string;
  cardCode: string;
  cardName: string;
  currency: string;
  subtotal: number;
  vat: number;
  total: number;
  taxRate: number;
  cancelled: boolean;
  lines: Array<{ code: string; name: string; qty: number; unit: number; total: number }>;
  payment: { docNum: number; cash: number; card: number; cancelled: boolean } | null;
};

// El recibo se arma con lo que SAP registró (no con lo que envió el navegador).
export async function getReceiptData(invoiceDocEntry: number, paymentDocEntry: number | null): Promise<ReceiptData> {
  const sap = config();
  const session = await login();
  const headers = { Cookie: session.cookie, Accept: "application/json" };
  const invoiceResponse = await sapFetch(`${sap.baseUrl}/Invoices(${invoiceDocEntry})?$select=DocNum,DocDate,CardCode,CardName,DocCurrency,DocTotal,VatSum,Cancelled,DocumentLines`, { headers, cache: "no-store" });
  if (!invoiceResponse.ok) throw new Error(`No fue posible leer la factura ${invoiceDocEntry} en SAP: ${await errorMessage(invoiceResponse)}`);
  const invoice = await invoiceResponse.json() as {
    DocNum: number; DocDate: string; CardCode: string; CardName?: string; DocCurrency: string; DocTotal: number; VatSum: number; Cancelled?: string;
    DocumentLines?: Array<{ ItemCode: string; ItemDescription?: string; Quantity: number; LineTotal?: number; TaxTotal?: number }>;
  };
  let payment: ReceiptData["payment"] = null;
  if (paymentDocEntry) {
    const paymentResponse = await sapFetch(`${sap.baseUrl}/IncomingPayments(${paymentDocEntry})?$select=DocNum,CashSum,Cancelled,PaymentCreditCards`, { headers, cache: "no-store" });
    if (!paymentResponse.ok) throw new Error(`No fue posible leer el pago ${paymentDocEntry} en SAP: ${await errorMessage(paymentResponse)}`);
    const data = await paymentResponse.json() as { DocNum: number; CashSum?: number; Cancelled?: string; PaymentCreditCards?: Array<{ CreditSum?: number }> };
    payment = {
      docNum: data.DocNum,
      cash: Number(data.CashSum || 0),
      card: (data.PaymentCreditCards || []).reduce((sum, row) => sum + Number(row.CreditSum || 0), 0),
      cancelled: data.Cancelled === "tYES",
    };
  }
  return {
    invoiceDocNum: invoice.DocNum,
    docDate: invoice.DocDate,
    cardCode: invoice.CardCode,
    cardName: invoice.CardName || "",
    currency: invoice.DocCurrency,
    subtotal: Math.round((invoice.DocTotal - invoice.VatSum) * 100) / 100,
    vat: invoice.VatSum,
    total: invoice.DocTotal,
    taxRate: sap.taxRate,
    cancelled: invoice.Cancelled === "tYES",
    // LineTotal y TaxTotal vienen en la moneda del documento (C$); PriceAfterVAT/GrossTotal pueden venir en la moneda del artículo.
    lines: (invoice.DocumentLines || []).map((line) => {
      const total = Math.round((Number(line.LineTotal || 0) + Number(line.TaxTotal || 0)) * 100) / 100;
      return { code: line.ItemCode, name: line.ItemDescription || line.ItemCode, qty: line.Quantity, unit: line.Quantity ? Math.round((total / line.Quantity) * 100) / 100 : total, total };
    }),
    payment,
  };
}
