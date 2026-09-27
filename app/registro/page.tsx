"use client";

import { useCallback, useEffect, useState } from "react";

type Estado = "completada" | "factura_sin_pago" | "fallida" | "rechazada_validacion";
type Step = { at: string; name: string; status: "ok" | "error"; detail: string; request?: unknown; response?: unknown };
type Summary = {
  id: string; createdAt: string; caja: string; usuario: string; companyDb: string; metodo: string | null; estado: Estado;
  total: number | null; efectivo: number | null; tarjeta: number | null;
  facturaDocEntry: number | null; facturaDocNum: number | null; pagoDocEntry: number | null; pagoDocNum: number | null;
  error: string | null; pasosCount: number; lineasCount: number;
};
type Detail = Omit<Summary, "pasosCount" | "lineasCount"> & { fecha: string; lineas: Array<{ itemCode: string; quantity: number; name?: string; price?: number }> | null; pasos: Step[] };

const money = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" });
const estadoLabel: Record<Estado, string> = {
  completada: "Completada",
  factura_sin_pago: "Factura sin pago",
  fallida: "Fallida",
  rechazada_validacion: "Rechazada en validación",
};
const metodoLabel: Record<string, string> = { cash: "Contado", card: "Tarjeta", mixed: "Ambos" };

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-NI", { timeZone: "America/Managua", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-NI", { timeZone: "America/Managua" });
}
function hoyManagua() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [value.year, value.month, value.day].join("-");
}

export default function Registro() {
  const [fecha, setFecha] = useState(hoyManagua);
  const [cajaLabel, setCajaLabel] = useState("");
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(async (day: string) => {
    setRows(null); setListError(null);
    try {
      const response = await fetch("/api/operaciones?fecha=" + day, { cache: "no-store" });
      const data = await response.json() as { operaciones?: Summary[]; cajaLabel?: string; message?: string };
      if (!response.ok) throw new Error(data.message || "No fue posible cargar el registro");
      setRows(data.operaciones || []); setCajaLabel(data.cajaLabel || "");
    } catch (error) { setListError(error instanceof Error ? error.message : "No fue posible cargar el registro"); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id); setDetail(null); setDetailError(null);
    try {
      const response = await fetch("/api/operaciones/" + encodeURIComponent(id), { cache: "no-store" });
      const data = await response.json() as Detail & { message?: string };
      if (!response.ok) throw new Error(data.message || "No fue posible cargar la operación");
      setDetail(data);
      if (data.fecha) setFecha((current) => current === data.fecha ? current : data.fecha);
    } catch (error) { setDetailError(error instanceof Error ? error.message : "No fue posible cargar la operación"); }
  }, []);

  useEffect(() => { loadList(fecha); }, [fecha, loadList]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) loadDetail(id);
  }, [loadDetail]);

  function select(id: string) {
    window.history.replaceState(null, "", "/registro?id=" + encodeURIComponent(id));
    loadDetail(id);
  }

  const counts = (rows || []).reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.estado]: (acc[row.estado] || 0) + 1 }), {});

  return (
    <main className="log-page">
      <header>
        <div className="brand"><span className="brand-logo-wrap"><img src="/brand/comtech-logo.jpg" alt="COMTECH" /></span><div><strong>COMTECH</strong><small>REGISTRO DE OPERACIONES{cajaLabel ? " · " + cajaLabel : ""}</small></div></div>
        <div className="header-right"><label className="log-date">Fecha <input type="date" value={fecha} onChange={(event) => event.target.value && setFecha(event.target.value)} /></label><button className="closure-trigger" onClick={() => loadList(fecha)}>Actualizar</button></div>
      </header>

      <section className="log-layout">
        <div className="log-list">
          <div className="log-list-head">
            <b>{rows ? rows.length + " operaciones" : "Cargando…"}</b>
            <span>{Object.entries(counts).map(([estado, count]) => estadoLabel[estado as Estado] + ": " + count).join(" · ")}</span>
          </div>
          {listError ? <p className="payment-inline-error" role="alert">{listError}</p> : null}
          {rows && rows.length === 0 ? <p className="log-empty">No hay operaciones registradas este día en esta caja.</p> : null}
          {rows?.map((row) => (
            <button key={row.id} className={"log-row" + (selectedId === row.id ? " selected" : "")} onClick={() => select(row.id)}>
              <span className={"log-badge " + row.estado}>{estadoLabel[row.estado]}</span>
              <span className="log-row-main">
                <b>{hora(row.createdAt)} · {row.facturaDocNum ? "Factura " + row.facturaDocNum : "Sin factura"}{row.pagoDocNum ? " · Pago " + row.pagoDocNum : ""}</b>
                <small>{row.metodo ? metodoLabel[row.metodo] || row.metodo : "—"} · {row.lineasCount} artículo(s) · {row.usuario}</small>
                {row.error ? <em>{row.error}</em> : null}
              </span>
              <strong>{row.total != null ? money.format(row.total) : ""}</strong>
            </button>
          ))}
        </div>

        <div className="log-detail">
          {!selectedId ? <p className="log-empty">Selecciona una operación para ver paso a paso qué ocurrió.</p> : null}
          {detailError ? <p className="payment-inline-error" role="alert">{detailError}</p> : null}
          {selectedId && !detail && !detailError ? <div className="closure-loading"><div className="spinner" /><span>Cargando operación…</span></div> : null}
          {detail ? <>
            <p className="eyebrow">OPERACIÓN · {detail.caja}</p>
            <h2>{estadoLabel[detail.estado]}</h2>
            {detail.error ? <p className="payment-inline-error" role="alert">{detail.error}</p> : null}
            <dl className="sale-details">
              <div><dt>Fecha y hora</dt><dd>{fechaHora(detail.createdAt)}</dd></div>
              <div><dt>Factura SAP</dt><dd>{detail.facturaDocNum ?? "-"} <small>DocEntry {detail.facturaDocEntry ?? "-"}</small></dd></div>
              <div><dt>Pago SAP</dt><dd>{detail.pagoDocNum ?? "-"} <small>DocEntry {detail.pagoDocEntry ?? "-"}</small></dd></div>
              <div><dt>Forma de pago</dt><dd>{detail.metodo ? metodoLabel[detail.metodo] || detail.metodo : "-"}</dd></div>
              <div><dt>Total SAP</dt><dd>{detail.total != null ? money.format(detail.total) : "-"}</dd></div>
              {detail.efectivo ? <div><dt>Efectivo</dt><dd>{money.format(detail.efectivo)}</dd></div> : null}
              {detail.tarjeta ? <div><dt>Tarjeta</dt><dd>{money.format(detail.tarjeta)}</dd></div> : null}
              <div><dt>Usuario SAP</dt><dd>{detail.usuario}</dd></div>
              <div><dt>Base SAP</dt><dd>{detail.companyDb}</dd></div>
              <div><dt>ID de operación</dt><dd><small>{detail.id}</small></dd></div>
            </dl>

            {detail.lineas?.length ? <>
              <h3>Artículos</h3>
              <div className="log-lines">{detail.lineas.map((line) => <p key={line.itemCode}><span>{line.quantity} × {line.name || line.itemCode}<small>{line.itemCode}</small></span><b>{line.price != null ? money.format(line.price * line.quantity) : ""}</b></p>)}</div>
            </> : null}

            <h3>Paso a paso</h3>
            <ol className="log-steps">
              {detail.pasos.map((step, index) => (
                <li key={step.at + "-" + index} className={step.status}>
                  <div className="log-step-head"><i>{step.status === "ok" ? "✓" : "!"}</i><b>{step.name}</b><small>{hora(step.at)}</small></div>
                  <p>{step.detail}</p>
                  {step.request !== undefined ? <details><summary>Enviado a SAP</summary><pre>{JSON.stringify(step.request, null, 2)}</pre></details> : null}
                  {step.response !== undefined ? <details open={step.status === "error"}><summary>Respuesta de SAP</summary><pre>{JSON.stringify(step.response, null, 2)}</pre></details> : null}
                </li>
              ))}
            </ol>
          </> : null}
        </div>
      </section>
    </main>
  );
}
