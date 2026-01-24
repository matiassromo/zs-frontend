// src/app/facturacion/pos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import CreateAccountModal from "@/components/pos/CreateAccountModal";
import AccountDetail from "@/components/pos/AccountDetail";

import { listAccountsToday, getAccount, type PosAccount, type AccountSummary } from "@/lib/apiv2/pos";

export default function PosPage() {
  const [openCreate, setOpenCreate] = useState(false);
  const [accounts, setAccounts] = useState<PosAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"open" | "closed">("open");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    const data = await listAccountsToday();
    setAccounts(data);
    setLoading(false);

    if (selectedId && !data.find((a) => a.id === selectedId)) {
      setSelectedId(null);
      setPreview(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedId) return setPreview(null);
      const detail = await getAccount(selectedId);
      setPreview(detail);
    })();
  }, [selectedId]);

  const openAccounts = useMemo(() => accounts.filter((a) => a.status === "Abierta"), [accounts]);
  const closedAccounts = useMemo(() => accounts.filter((a) => a.status === "Cerrada"), [accounts]);

  const list = tab === "open" ? openAccounts : closedAccounts;

  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase();
    if (!nq) return list;

    return list.filter((a) => {
      const id = String(a.id).toLowerCase();
      const name = (a.clientName ?? "").toLowerCase();
      const type = (a.entryType ?? "").toLowerCase();
      return id.includes(nq) || name.includes(nq) || type.includes(nq);
    });
  }, [list, q]);

  const selectedPreviewText = useMemo(() => {
    if (!preview) return null;
    const estado = preview.status;
    const opened = new Date(preview.openedAt).toLocaleString("es-EC");
    const saldo = `$${preview.saldo.toFixed(2)}`;
    return { estado, opened, saldo };
  }, [preview]);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-2 lg:px-4">
      {/* Header */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b bg-white/80 px-4 py-4 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>

            <p className="mt-1 text-xs md:text-sm text-neutral-500">
              Selecciona una cuenta para ver cargos, pagos y acciones.
            </p>
          </div>

          <div className="flex items-center gap-2">

            <button
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
              onClick={() => setOpenCreate(true)}
              type="button"
            >
              + Nueva entrada
            </button>
          </div>
        </div>

        {/* Mini info de selección */}
        {selectedId && selectedPreviewText && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">
              Seleccionada: <span className="font-semibold">#{selectedId}</span>
            </span>
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">
              Estado: <span className="font-semibold">{selectedPreviewText.estado}</span>
            </span>
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">
              Entrada: <span className="font-semibold">{selectedPreviewText.opened}</span>
            </span>
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">
              Saldo: <span className="font-semibold">{selectedPreviewText.saldo}</span>
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-neutral-500">Cargando…</div>
      ) : (
        <div className="grid gap-4">
          {/* Left rail */}
          <aside className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            {/* Tabs + search */}
            <div className="border-b p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 p-1">
                  <button
                    type="button"
                    onClick={() => setTab("open")}
                    className={
                      "rounded-full px-3 py-1.5 text-xs font-medium transition " +
                      (tab === "open"
                        ? "bg-white shadow-sm border border-neutral-200 text-neutral-900"
                        : "text-neutral-600 hover:text-neutral-900")
                    }
                  >
                    Abiertas ({openAccounts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("closed")}
                    className={
                      "rounded-full px-3 py-1.5 text-xs font-medium transition " +
                      (tab === "closed"
                        ? "bg-white shadow-sm border border-neutral-200 text-neutral-900"
                        : "text-neutral-600 hover:text-neutral-900")
                    }
                  >
                    Cerradas ({closedAccounts.length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setPreview(null);
                  }}
                  className="text-xs rounded-full border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
                >
                  Limpiar
                </button>
              </div>

              <div className="mt-3">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por #, nombre o tipo…"
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
                />
              </div>
            </div>

            {/* List */}
            <div className="max-h-[50vh] overflow-auto p-3">
              {filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-neutral-50 p-4 text-sm text-neutral-500">
                  No hay resultados para la búsqueda.
                </div>
              ) : (
                <div className="grid gap-2">
                  {filtered.map((acc) => {
                    const isSelected = selectedId === acc.id;

                    const timeLabel =
                      tab === "open"
                        ? new Date(acc.openedAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })
                        : acc.closedAt
                          ? new Date(acc.closedAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })
                          : "—";

                    const typeLabel = acc.entryType === "normal" ? "Normal" : "Tarjeta 10 pases";

                    return (
                      <button
                        key={acc.id}
                        onClick={() => setSelectedId(acc.id)}
                        type="button"
                        className={
                          "w-full text-left rounded-xl border p-3 transition shadow-sm " +
                          (isSelected ? "border-blue-400 bg-blue-50" : "border-neutral-200 bg-white hover:bg-neutral-50")
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-neutral-900">#{acc.id}</span>
                              <span className="truncate text-xs text-neutral-500">{acc.clientName}</span>
                            </div>

                            <div className="mt-1 flex flex-wrap gap-2">
                              <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-600">
                                {typeLabel}
                              </span>
                              <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-600">
                                {tab === "open" ? "Apertura" : "Cierre"}: {timeLabel}
                              </span>
                            </div>
                          </div>

                          <span
                            className={
                              "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium " +
                              (tab === "open" ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-700")
                            }
                          >
                            {tab === "open" ? "Abierta" : "Cerrada"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Detail BELOW */}
          <section className="min-w-0">
            {selectedId ? (
          <div className="p-0">
            <AccountDetail accountId={selectedId} onChanged={load} />
          </div>

            ) : (
              <div className="rounded-2xl border bg-white p-8 text-sm text-neutral-500 shadow-sm">
                <div className="text-base font-semibold text-neutral-900">Selecciona una cuenta</div>
                <div className="mt-1">
                  Usa la lista de arriba para abrir el detalle, registrar pagos, agregar cargos o imprimir comprobantes.
                </div>
              </div>
            )}
          </section>
        </div>

      )}

      {openCreate && (
        <CreateAccountModal onClose={() => setOpenCreate(false)} onCreated={load} />
      )}
    </div>
  );
}
