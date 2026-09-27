"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Product = { code: string; itemCode?: string; name: string; detail: string; price: number; stock: number; color: string; exchangeRate?: number };
type Line = Product & { qty: number };
type PaymentMethod = "cash" | "card" | "mixed";
type ClosureData = { date: string; companyDb: string; entries: Array<{ paymentDocNum: number; invoiceDocNum: number | null; method: PaymentMethod; cash: number; card: number; total: number }>; totals: { cash: number; card: number; total: number } };

type SaleOperation = { id?: string; createdAt?: string; cajaLabel?: string; usuario?: string; companyDb?: string; docTotal?: number; cashAmount?: number; cardAmount?: number };

const money = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" });

export default function Home() {
  const [lines, setLines] = useState<Line[]>([]);
  const [available, setAvailable] = useState<Product[]>([]);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("Listo para escanear");
  const [modal, setModal] = useState<"pay" | "processing" | "done" | "closure" | null>(null);
  const [step, setStep] = useState(0);
  const [sapState, setSapState] = useState<"checking" | "online" | "offline">("checking");
  const [invoice, setInvoice] = useState<{ DocEntry?: number; DocNum?: number } | null>(null);
  const [payment, setPayment] = useState<{ DocEntry?: number; DocNum?: number } | null>(null);
  const [operation, setOperation] = useState<SaleOperation | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [mixedCash, setMixedCash] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [closure, setClosure] = useState<ClosureData | null>(null);
  const [closureError, setClosureError] = useState<string | null>(null);
  const [cajaLabel, setCajaLabel] = useState("CAJA");
  const input = useRef<HTMLInputElement>(null);
  const printFrame = useRef<HTMLIFrameElement | null>(null);
  const lastSimulatedCode = useRef<string | null>(null);
  const total = useMemo(() => lines.reduce((sum, item) => sum + item.price * item.qty, 0), [lines]);

  useEffect(() => { input.current?.focus(); }, [modal]);
  useEffect(() => {
    const checkSap = () => fetch("/api/sap/status", { cache: "no-store" }).then(async (r) => {
      setSapState(r.ok ? "online" : "offline");
      const status = await r.json() as { cajaLabel?: string };
      if (status.cajaLabel) setCajaLabel(status.cajaLabel);
    }).catch(() => setSapState("offline"));
    checkSap();
    const timer = setInterval(checkSap, 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    fetch("/api/sap/items", { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { items?: Product[] };
      if (response.ok && data.items?.length) setAvailable(data.items.map((item, index) => ({ ...item, color: ["#f7dfe1", "#e0e8f1", "#eee4d8", "#e3ebe5"][index % 4] })));
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (modal !== "pay") return;
    const handlePaymentShortcut = (event: KeyboardEvent) => {
      const shortcuts: Partial<Record<string, PaymentMethod>> = { F1: "cash", F2: "card", F3: "mixed" };
      const method = shortcuts[event.key];
      if (!method) return;
      event.preventDefault();
      setPaymentMethod(method);
      setPaymentError(null);
    };
    window.addEventListener("keydown", handlePaymentShortcut);
    return () => window.removeEventListener("keydown", handlePaymentShortcut);
  }, [modal]);
  useEffect(() => {
    if (modal !== "processing") return;
    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const processSale = async () => {
      setStep(0); setPaymentError(null);
      await wait(650); if (cancelled) return;
      const documentLines = lines.map((line) => ({ itemCode: line.itemCode || line.code, quantity: line.qty, name: line.name, price: line.price }));
      try {
        const validationResponse = await fetch("/api/sap/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: documentLines }) });
        const validation = await validationResponse.json() as { valid?: boolean; message?: string; operation?: SaleOperation };
        if (validation.operation) setOperation(validation.operation);
        if (!validationResponse.ok || !validation.valid) throw new Error(validation.message || "La compra contiene artículos no válidos");
      } catch (error) {
        setPaymentError(error instanceof Error ? error.message : "No fue posible validar los artículos"); return;
      }
      if (cancelled) return; setStep(1);
      await wait(650); if (cancelled) return; setStep(2);
      try {
        const response = await fetch("/api/sap/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: documentLines, payment: { method: paymentMethod, ...(paymentMethod === "mixed" ? { cashAmount: Number(mixedCash) } : {}) }, customer: { name: customerName, taxId: customerTaxId } }) });
        const result = await response.json() as { invoice?: { DocEntry?: number; DocNum?: number; DocTotal?: number }; payment?: { DocEntry?: number; DocNum?: number } | null; paymentError?: string | null; message?: string; cashAmount?: number; cardAmount?: number; operation?: SaleOperation };
        setOperation(result.operation ? { ...result.operation, docTotal: result.invoice?.DocTotal, cashAmount: result.cashAmount, cardAmount: result.cardAmount } : null);
        if (!response.ok) {
          if (result.invoice) setInvoice(result.invoice);
          throw new Error(result.invoice ? `Factura de reserva SAP ${result.invoice.DocNum} creada, pero el pago no se aplicó: ${result.paymentError || "error de pago"}` : result.message || "SAP rechazó la factura de reserva");
        }
        if (cancelled) return; setInvoice(result.invoice || null); setPayment(result.payment || null); setStep(3);
        await wait(650); if (cancelled) return; setStep(4);
        await wait(450); if (!cancelled) setModal("done");
      } catch (error) { if (!cancelled) setPaymentError(error instanceof Error ? error.message : "No fue posible facturar"); }
    };
    processSale();
    return () => { cancelled = true; };
  }, [modal, lines, paymentMethod, mixedCash, customerName, customerTaxId]);
  async function scan(raw?: string) {
    const value = (raw ?? code).trim();
    if (!value) return;
    setNotice("Consultando artículo en SAP…");
    let product: Product | undefined;
    {
      try {
        const response = await fetch(`/api/sap/items/${encodeURIComponent(value)}`, { cache: "no-store" });
        const result = await response.json() as Product & { message?: string };
        if (!response.ok) throw new Error(result.message || "No fue posible consultar SAP");
        product = { ...result, color: "#d9eadc" };
        setSapState("online");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Código no encontrado");
        setSapState("offline"); setCode(""); input.current?.focus(); return;
      }
    }
    if (!product) return;
    setLines((current) => {
      const found = current.find((line) => line.code === product.code);
      return found
        ? current.map((line) => line.code === product.code ? { ...line, qty: Math.min(line.qty + 1, line.stock) } : line)
        : [...current, { ...product, qty: 1 }];
    });
    setNotice(`${product.name} agregado`);
    setCode("");
    setTimeout(() => setNotice("Listo para escanear"), 1800);
  }

  function changeQty(itemCode: string, delta: number) {
    setLines((current) => current.flatMap((line) => line.code !== itemCode ? [line] : line.qty + delta > 0 ? [{ ...line, qty: Math.min(line.qty + delta, line.stock) }] : []));
  }

  function simulateRandomScan() {
    if (!available.length) return;
    setLines((current) => {
      const codesInCart = new Set(current.map((line) => line.code));
      const notYetScanned = available.filter((item) => item.stock > 0 && !codesInCart.has(item.code));
      const different = available.filter((item) => item.stock > 0 && item.code !== lastSimulatedCode.current);
      const candidates = notYetScanned.length ? notYetScanned : different.length ? different : available.filter((item) => item.stock > 0);
      if (!candidates.length) return current;
      const item = candidates[Math.floor(Math.random() * candidates.length)];
      lastSimulatedCode.current = item.code;
      const found = current.find((line) => line.code === item.code);
      return found
        ? current.map((line) => line.code === item.code ? { ...line, qty: Math.min(line.qty + 1, line.stock) } : line)
        : [...current, { ...item, qty: 1 }];
    });
    setNotice("Producto disponible agregado desde SHOWROOM");
    setTimeout(() => setNotice("Listo para escanear"), 1800);
  }

  function reset() {
    if (printFrame.current) { printFrame.current.onload = null; printFrame.current.src = "about:blank"; }
    lastSimulatedCode.current = null;
    setLines([]); setCode(""); setModal(null); setInvoice(null); setPayment(null); setOperation(null); setReceiptError(null); setPaymentError(null); setPaymentMethod("card"); setMixedCash(""); setCustomerName(""); setCustomerTaxId(""); setStep(0); setPrinted(false); setNotice("Listo para escanear");
    setTimeout(() => input.current?.focus(), 0);
  }

  function beginPayment() {
    if (customerTaxId.trim() && !customerName.trim()) {
      setPaymentError("Escriba el nombre del cliente junto con el RUC o cédula.");
      return;
    }
    if (paymentMethod === "mixed") {
      const cash = Number(mixedCash);
      if (!Number.isFinite(cash) || cash <= 0 || cash >= total) {
        setPaymentError("El efectivo debe ser mayor que cero y menor que el total.");
        return;
      }
    }
    setModal("processing");
  }

  async function openClosure() {
    setClosure(null); setClosureError(null); setModal("closure");
    try {
      const response = await fetch("/api/sap/closure", { cache: "no-store" });
      const result = await response.json() as ClosureData & { message?: string };
      if (!response.ok) throw new Error(result.message || "No fue posible cargar el cierre");
      setClosure(result);
    } catch (error) { setClosureError(error instanceof Error ? error.message : "No fue posible cargar el cierre"); }
  }

  // El recibo se genera en el servidor con los datos de la factura y el pago en SAP.
  async function printReceiptPdf(invoiceData = invoice) {
    setReceiptError(null);
    if (!operation?.id) { setReceiptError("No hay una operación registrada para imprimir."); return; }
    const response = await fetch("/api/receipt/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operation.id }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { message?: string };
      setReceiptError(result.message || "No fue posible generar el recibo.");
      return;
    }
    setPrinted(true);
    const url = URL.createObjectURL(await response.blob());
    const download = document.createElement("a");
    download.href = url; download.download = `recibo-comtech-${invoiceData?.DocNum || "venta"}-80mm.pdf`;
    document.body.appendChild(download); download.click(); download.remove();
    const frame = printFrame.current;
    if (!frame) return;
    frame.onload = () => setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); }, 700);
    frame.src = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  return (
    <main>
      <header>
        <div className="brand"><span className="brand-logo-wrap"><img src="/brand/comtech-logo.jpg" alt="COMTECH" /></span><div><strong>COMTECH</strong><small>SHOWROOM · {cajaLabel}</small></div></div>
        <div className="header-right"><span className={`status ${sapState === "offline" ? "offline" : ""}`}><i /> {sapState === "online" ? "SAP conectado" : sapState === "offline" ? "SAP sin acceso" : "Verificando SAP"}</span><a className="closure-trigger" href="/registro" target="_blank" rel="noopener">Registro</a><button className="closure-trigger" onClick={openClosure}>Cierre de caja</button><button className="help" onClick={() => { setNotice("Escanea un producto; luego cobra, imprime y entrega."); input.current?.focus(); }}>? Ayuda</button></div>
      </header>

      <section className="workspace">
        <div className="sale">
          <div className="sale-head">
            <div><p className="eyebrow">PUNTO DE VENTA</p><h1>Venta en caja.</h1><p>Escanea los productos, cobra y entrega la factura al cliente.</p></div>
            <div className="customer"><span>◆</span><div><small>CLIENTE DE MOSTRADOR</small><b>Contado Showroom</b><em>CN999999 · Precio SAP</em></div></div>
          </div>

          <div className="scanner">
            <div className="scan-icon"><span /><span /><span /><span /></div>
            <div className="scan-copy"><b>{notice}</b><small>Lector de la cajera activo</small></div>
            <form noValidate onSubmit={(e) => { e.preventDefault(); scan(); }}><input ref={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de barras" aria-label="Código de barras" /><button>Agregar</button></form>
            <button className="demo" disabled={!available.length} onClick={simulateRandomScan}>{available.length ? "Simular escaneo aleatorio" : "Cargando SAP…"}</button>
          </div>

          <div className="items-title"><b>{lines.reduce((s, l) => s + l.qty, 0)} artículos</b><span>Precio incluye impuestos</span></div>
          <div className="items">
            {lines.length === 0 && <div className="empty"><span>⌁</span><b>Venta lista para comenzar</b><p>La cajera debe escanear el primer producto.</p></div>}
            {lines.map((item) => <article key={item.code}>
              <div className="thumb" style={{ background: item.color }}><span>{item.name.split(" ")[0].slice(0, 2).toUpperCase()}</span></div>
              <div className="item-info"><b>{item.name}</b><small>{item.detail}</small><em>SKU {item.code.slice(-6)}</em></div>
              <div className="quantity"><button onClick={() => changeQty(item.code, -1)}>−</button><strong>{item.qty}</strong><button onClick={() => changeQty(item.code, 1)}>+</button></div>
              <div className="price"><small>{money.format(item.price)} c/u</small><b>{money.format(item.price * item.qty)}</b></div>
              <button className="remove" onClick={() => setLines((x) => x.filter((l) => l.code !== item.code))}>×</button>
            </article>)}
          </div>
        </div>

        <aside>
          <div><p className="eyebrow">{cajaLabel}</p><h2>Resumen de venta</h2></div>
          <div className="summary-lines"><p><span>Subtotal</span><b>{money.format(total / 1.15)}</b></p><p><span>IVA (15%)</span><b>{money.format(total - total / 1.15)}</b></p></div>
          <div className="grand"><span>Total a pagar</span><b>{money.format(total)}</b><small>Tasa vigente de SAP</small></div>
          <button className="pay" disabled={!lines.length || lines.some((line) => !line.itemCode)} onClick={() => { setPaymentError(null); setModal("pay"); }}><span>Cobrar venta</span><i>→</i></button>
          <div className="card-only"><span>▣</span><p><b>Contado, tarjeta o ambos</b><small>La tarjeta se procesa en el POS físico</small></p></div>
          <button className="cancel-purchase" disabled={!lines.length} onClick={reset}>Cancelar venta</button>
          <div className="aside-foot"><span>🔒 Transacción segura</span><span>● Cajera en línea</span></div>
        </aside>
      </section>

      <footer><button onClick={reset}>Cancelar venta</button><p>Escaneo asistido · Cobro seguro · Facturación SAP</p><span>COMTECH · Showroom Managua</span></footer>

      {modal && <div className="overlay"><div className="modal">
        {modal === "pay" && <>
          <button className="modal-x" onClick={() => setModal(null)} aria-label="Cerrar cobro">×</button>
          <p className="eyebrow center">FORMA DE PAGO</p><h2>¿Cómo pagó el cliente?</h2><p className="muted">Realiza el cobro en caja o en el POS físico y registra aquí el medio utilizado.</p>
          <div className="charge"><span>Total a cobrar</span><b>{money.format(total)}</b></div>
          <div className="payment-methods" role="group" aria-label="Forma de pago">
            <button className={paymentMethod === "cash" ? "selected" : ""} onClick={() => { setPaymentMethod("cash"); setPaymentError(null); }}><kbd>F1</kbd><span>▤</span><b>Contado</b></button>
            <button className={paymentMethod === "card" ? "selected" : ""} onClick={() => { setPaymentMethod("card"); setPaymentError(null); }}><kbd>F2</kbd><span>▣</span><b>Tarjeta</b></button>
            <button className={paymentMethod === "mixed" ? "selected" : ""} onClick={() => { setPaymentMethod("mixed"); setPaymentError(null); }}><kbd>F3</kbd><span>◫</span><b>Ambos</b></button>
          </div>
          <details className="invoice-customer" open={Boolean(customerName || customerTaxId)}><summary>Factura a nombre del cliente (opcional)</summary><label htmlFor="customer-name">Nombre o razón social</label><input id="customer-name" value={customerName} maxLength={100} onChange={(event) => { setCustomerName(event.target.value); setPaymentError(null); }} placeholder="Ej.: BOXFUL TECHNOLOGIES NICARAGUA SA" /><label htmlFor="customer-tax">RUC o cédula</label><input id="customer-tax" value={customerTaxId} maxLength={32} onChange={(event) => { setCustomerTaxId(event.target.value.toUpperCase()); setPaymentError(null); }} placeholder="Ej.: J0310000478082" /><small>Se guarda solo en esta factura; no modifica el cliente de contado en SAP.</small></details>{paymentMethod === "mixed" ? <div className="mixed-payment"><label htmlFor="cash-amount">Monto recibido en efectivo</label><input id="cash-amount" inputMode="decimal" value={mixedCash} onChange={(event) => { setMixedCash(event.target.value); setPaymentError(null); }} placeholder="0.00" /><p><span>Tarjeta</span><b>{money.format(Math.max(0, total - (Number(mixedCash) || 0)))}</b></p></div> : null}
          {paymentError ? <p className="payment-inline-error" role="alert">{paymentError}</p> : null}
          <button className="pay confirm-payment" onClick={beginPayment}><span>Registrar {paymentMethod === "cash" ? "contado" : paymentMethod === "card" ? "tarjeta" : "pago combinado"}</span><i>→</i></button><button className="link" onClick={() => setModal(null)}>Volver a la venta</button><button className="cancel-modal" onClick={reset}>Cancelar venta</button>
        </>}
        {modal === "processing" && <><div className={paymentError ? "process-error" : "spinner"}>{paymentError ? "!" : ""}</div><p className="eyebrow center">{paymentError ? "OPERACIÓN INCOMPLETA" : "PROCESANDO VENTA"}</p><h2>{paymentError ? "SAP requiere atención" : "Espera la confirmación"}</h2>{paymentError ? <><p className="muted">{paymentError}</p>{operation?.id ? <a className="log-link" href={`/registro?id=${operation.id}`} target="_blank" rel="noopener">Ver detalle en el registro</a> : null}<button className="secondary-print" onClick={() => invoice ? reset() : setModal("pay")}>{invoice ? "Cerrar sin duplicar factura" : "Volver y revisar"}</button>{!invoice && <button className="cancel-modal" onClick={reset}>Cancelar venta</button>}</> : <div className="progress-list">{["Validando productos", "Creando factura de reserva en SAP", "Registrando el medio de pago", "Confirmando la operación"].map((label, i) => <p className={step > i ? "done" : step === i ? "active" : ""} key={label}><i>{step > i ? "✓" : i + 1}</i><span>{label}</span></p>)}</div>}</>}
        {modal === "done" && <><div className="success">✓</div><p className="eyebrow center">VENTA COMPLETADA</p><h2>Pago registrado</h2><div className="pos-voucher"><div><b>FORMA DE PAGO</b><span>{paymentMethod === "cash" ? "CONTADO" : paymentMethod === "card" ? "TARJETA" : "AMBOS"}</span></div><p><span>PAGO SAP {payment?.DocNum || "-"}</span><strong>{money.format(total)}</strong></p><small>REGISTRADO EN {operation?.companyDb || "SAP"}</small></div><dl className="sale-details"><div><dt>Factura SAP</dt><dd>{invoice?.DocNum ?? "-"} <small>DocEntry {invoice?.DocEntry ?? "-"}</small></dd></div><div><dt>Pago SAP</dt><dd>{payment?.DocNum ?? "-"} <small>DocEntry {payment?.DocEntry ?? "-"}</small></dd></div>{customerName.trim() ? <div><dt>Factura a nombre de</dt><dd>{customerName.trim()}{customerTaxId.trim() ? <small> RUC {customerTaxId.trim()}</small> : null}</dd></div> : null}<div><dt>Caja</dt><dd>{operation?.cajaLabel || cajaLabel}</dd></div><div><dt>Usuario SAP</dt><dd>{operation?.usuario || "-"}</dd></div><div><dt>Total SAP</dt><dd>{money.format(operation?.docTotal ?? total)}</dd></div>{operation?.cashAmount ? <div><dt>Efectivo</dt><dd>{money.format(operation.cashAmount)}</dd></div> : null}{operation?.cardAmount ? <div><dt>Tarjeta</dt><dd>{money.format(operation.cardAmount)}</dd></div> : null}<div><dt>Fecha y hora</dt><dd>{operation?.createdAt ? new Date(operation.createdAt).toLocaleString("es-NI", { timeZone: "America/Managua" }) : "-"}</dd></div></dl>{operation?.id ? <a className="log-link" href={`/registro?id=${operation.id}`} target="_blank" rel="noopener">Ver detalle en el registro</a> : null}<div className="receipt"><span>Factura de reserva SAP · SHOWROOM</span><b>{invoice?.DocNum ? `SAP-${invoice.DocNum}` : "FACTURA DE RESERVA"}</b><small>{printed ? "Factura enviada a impresión" : "Pendiente de imprimir y entregar"}</small></div><button className="pay print-action" onClick={() => printReceiptPdf()}><span>{printed ? "Imprimir nuevamente" : "Imprimir factura"}</span><i>▣</i></button>{receiptError ? <p className="payment-inline-error" role="alert">{receiptError}</p> : null}<p className="handoff-note">{printed ? "Entrega la factura y los productos al cliente." : "Imprime la factura antes de entregar los productos."}</p><button className="link" onClick={reset}>Iniciar nueva venta</button></>}
        {modal === "closure" && <><button className="modal-x" onClick={() => setModal(null)} aria-label="Cerrar cierre de caja">×</button><p className="eyebrow center">{cajaLabel} · HOY</p><h2>Cierre de caja</h2>{closureError ? <p className="payment-inline-error" role="alert">{closureError}</p> : !closure ? <div className="closure-loading"><div className="spinner" /><span>Consultando pagos en SAP…</span></div> : <><div className="closure-totals"><div><span>Contado</span><b>{money.format(closure.totals.cash)}</b></div><div><span>Tarjeta</span><b>{money.format(closure.totals.card)}</b></div><div className="closure-grand"><span>Total vendido</span><b>{money.format(closure.totals.total)}</b></div></div><div className="closure-meta"><span>{closure.entries.length} facturas</span><span>{closure.date}</span></div><div className="closure-list">{closure.entries.length ? closure.entries.map((entry) => <div key={entry.paymentDocNum}><span><b>Factura {entry.invoiceDocNum || "-"}</b><small>Pago SAP {entry.paymentDocNum} · {entry.method === "cash" ? "Contado" : entry.method === "card" ? "Tarjeta" : "Ambos"}</small></span><strong>{money.format(entry.total)}</strong></div>) : <p>No hay ventas registradas hoy en {cajaLabel}.</p>}</div></>}<button className="link" onClick={() => setModal(null)}>Volver a la caja</button></>}
      </div></div>}

      <iframe ref={printFrame} className="print-frame" title="Impresión automática del recibo" />

      <section className="thermal-receipt" aria-label="Factura térmica COMTECH de 80 milímetros">
        <img className="thermal-logo" src="/brand/comtech-logo.jpg" alt="" />
        <div className="thermal-brand">COMTECH</div>
        <div className="thermal-subtitle">SHOWROOM · CAJA RÁPIDA</div>
        <p>Managua, Nicaragua</p>
        <p>Documento de venta</p>
        <div className="thermal-rule" />
        <div className="thermal-pair"><span>FACTURA RESERVA</span><b>{invoice?.DocNum ? `SAP-${invoice.DocNum}` : "FACTURA SAP"}</b></div>
        <div className="thermal-pair"><span>FECHA</span><span>{operation?.createdAt ? new Date(operation.createdAt).toLocaleString("es-NI", { timeZone: "America/Managua" }) : "-"}</span></div>
        <div className="thermal-pair"><span>CAJA</span><span>{cajaLabel}</span></div>
        <div className="thermal-pair"><span>CLIENTE</span><span>{customerName.trim() || "CN999999"}</span></div>
        <div className="thermal-rule" />
        <div className="thermal-head"><span>CANT. DESCRIPCIÓN</span><span>TOTAL</span></div>
        {lines.map((item) => <div className="thermal-item" key={`receipt-${item.code}`}>
          <div><span>{item.qty} × {item.name}</span><small>{item.itemCode || item.code} · {money.format(item.price)} c/u</small></div>
          <b>{money.format(item.qty * item.price)}</b>
        </div>)}
        <div className="thermal-rule" />
        <div className="thermal-total"><span>SUBTOTAL</span><span>{money.format(total / 1.15)}</span></div>
        <div className="thermal-total"><span>IVA 15%</span><span>{money.format(total - total / 1.15)}</span></div>
        <div className="thermal-total thermal-grand"><span>TOTAL C$</span><b>{money.format(total)}</b></div>
        <div className="thermal-rule" />
        <div className="thermal-pair"><span>PAGO</span><span>{paymentMethod === "cash" ? "CONTADO" : paymentMethod === "card" ? "TARJETA" : "AMBOS"}</span></div>
        <div className="thermal-pair"><span>PAGO SAP</span><span>{payment?.DocNum || "-"}</span></div>
        <p className="thermal-center">*** TRANSACCIÓN APROBADA ***</p>
        <div className="thermal-barcode">|||| || | |||| | | ||| ||</div>
        <p className="thermal-center">{invoice?.DocNum ? `SAP-${invoice.DocNum}` : "FACTURA SAP"}</p>
        <div className="thermal-rule" />
        <p className="thermal-center thermal-thanks">¡GRACIAS POR SU COMPRA!</p>
        <p className="thermal-center">Factura entregada por la cajera con sus productos.</p>
        <p className="thermal-center thermal-copy">COPIA CLIENTE · COMTECH</p>
      </section>
    </main>
  );
}
