// src/app/clientes/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Client } from "@/types/client";
import { listClients, deleteClient } from "@/lib/apiv2/clients";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

function PillButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }) {
  return (
    <button
      {...props}
      className={
        "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-50 " +
        className
      }
    >
      {children}
    </button>
  );
}

export default function ClientesPage() {
  const [items, setItems] = useState<Client[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const toast = (
    title: string,
    icon: "success" | "info" | "error" = "success",
    timer = 1800
  ) =>
    Swal.fire({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer,
      timerProgressBar: true,
      icon,
      title,
    });

  async function load() {
    try {
      setLoading(true);
      const data = await listClients(q);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    return { total: items.length };
  }, [items]);

  return (
  <div className="p-6 space-y-4">
    {/* Panel acciones + stats + búsqueda (SIN header duplicado) */}
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="p-4 grid gap-4">
        {/* acciones + stats */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-1 gap-3 w-full md:w-auto">
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="text-xs font-medium text-neutral-500">Total</div>
              <div className="mt-1 text-2xl font-semibold text-neutral-900">
                {stats.total}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-start md:justify-end">
            <Link
              href="/clientes/nuevo"
              className="inline-flex items-center justify-center rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            >
              + Nuevo cliente
            </Link>

            <PillButton
              onClick={load}
              type="button"
              className="border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50"
            >
              Recargar
            </PillButton>
          </div>
        </div>

        {/* búsqueda */}
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <input
              className="w-full rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
              placeholder="Buscar por nombre, cédula, email o teléfono…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load();
              }}
            />
            <div className="flex gap-2">
              <PillButton
                onClick={load}
                type="button"
                className="bg-neutral-900 text-white hover:bg-neutral-800"
              >
                Buscar
              </PillButton>
              <PillButton
                onClick={() => {
                  setQ("");
                  requestAnimationFrame(() => load());
                }}
                type="button"
                className="border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50"
              >
                Limpiar
              </PillButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Tabla estilo POS */}
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
        <div className="font-semibold">Listado</div>
        {loading ? <span className="text-sm text-neutral-500">Cargando…</span> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-neutral-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="py-3 px-3">Nombre</th>
              <th className="py-3 px-3">Cédula</th>
              <th className="py-3 px-3">Teléfono</th>
              <th className="py-3 px-3">Correo</th>
              <th className="py-3 px-3 text-right">Acciones</th>
            </tr>
          </thead>

          <tbody className="[&>tr]:border-t [&>tr]:border-neutral-200">
            {loading && (
              <tr>
                <td colSpan={5} className="py-10 px-3 text-neutral-500">
                  Cargando…
                </td>
              </tr>
            )}

            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 px-3 text-center text-neutral-500">
                  Sin resultados
                </td>
              </tr>
            )}

            {!loading &&
              items.map((c) => (
                <tr key={c.id} className="hover:bg-neutral-50">
                  <td className="py-3 px-3 font-semibold text-neutral-900">{c.name}</td>
                  <td className="py-3 px-3">{c.nationalId}</td>
                  <td className="py-3 px-3">{c.number}</td>
                  <td className="py-3 px-3">{c.email}</td>
                  <td className="py-3 px-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/clientes/${c.id}/editar`}
                        className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                      >
                        Editar
                      </Link>

                      <button
                        type="button"
                        onClick={async () => {
                          const res = await Swal.fire({
                            icon: "warning",
                            title: "¿Eliminar cliente?",
                            text: `Se eliminará a ${c.name}. Esta acción no se puede deshacer.`,
                            showCancelButton: true,
                            confirmButtonText: "Sí, eliminar",
                            cancelButtonText: "Cancelar",
                            confirmButtonColor: "#dc2626",
                            reverseButtons: true,
                            showLoaderOnConfirm: true,
                            allowOutsideClick: () => !Swal.isLoading(),
                            preConfirm: async () => {
                              try {
                                await deleteClient(c.id);
                              } catch (err: any) {
                                Swal.showValidationMessage(
                                  err?.message ?? "Error eliminando cliente"
                                );
                                throw err;
                              }
                            },
                          });

                          if (res.isConfirmed) {
                            await load();
                            toast("Cliente eliminado", "success");
                          }
                        }}
                        className="inline-flex items-center justify-center rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);



}
