// src/components/shell/Shell.tsx
"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

type HeaderInfo = { kicker: string; title: string; badge: string | null };

function getHeader(path: string): HeaderInfo {
  // más específicas primero
  if (path.startsWith("/facturacion/pos")) {
    return { kicker: "FACTURACIÓN", title: "Punto de Venta (POS)", badge: "Operación en curso" };
  }
  if (path.startsWith("/facturacion/caja-diaria")) {
    return { kicker: "FACTURACIÓN", title: "Caja Diaria", badge: null };
  }
  if (path.startsWith("/facturacion")) {
    return { kicker: "FACTURACIÓN", title: "Facturación", badge: null };
  }
  if (path.startsWith("/clientes")) {
    return { kicker: "CLIENTES", title: "Clientes", badge: null };
  }
  if (path.startsWith("/pases")) {
    return { kicker: "TARJETAS Y PASES", title: "Tarjetas 10 Pases", badge: null };
  }
  if (path.startsWith("/tarjetas-pases")) {
    return { kicker: "TARJETAS Y PASES", title: "Tarjetas y Pases", badge: null };
  }
  if (path.startsWith("/bar")) {
    return { kicker: "BAR", title: "Bar", badge: null };
  }
  if (path.startsWith("/parqueadero")) {
    return { kicker: "PARQUEADERO", title: "Parqueadero", badge: null };
  }
  if (path.startsWith("/llaves")) {
    return { kicker: "LLAVES", title: "Llaves", badge: null };
  }
  if (path.startsWith("/lockers")) {
    return { kicker: "LOCKERS", title: "Lockers", badge: null };
  }
  if (path.startsWith("/productos")) {
    return { kicker: "PRODUCTOS", title: "Productos", badge: null };
  }
  if (path.startsWith("/ingresos")) {
    return { kicker: "INGRESOS", title: "Ingresos", badge: null };
  }
  if (path.startsWith("/pagos")) {
    return { kicker: "PAGOS", title: "Pagos", badge: null };
  }
  if (path.startsWith("/transacciones")) {
    return { kicker: "TRANSACCIONES", title: "Transacciones", badge: null };
  }

  // dashboard (home)
  return { kicker: "DASHBOARD OPERATIVO", title: "Panel Zero Stress", badge: "Operación en curso" };
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hdr = useMemo(() => getHeader(pathname), [pathname]);

  return (
    <div className="min-h-dvh bg-neutral-100 text-neutral-900">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr]">
        <aside className="border-r border-neutral-200 bg-white">
          <Sidebar />
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {hdr.kicker}
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-semibold text-neutral-900 truncate">
                    {hdr.title}
                  </div>

                  {hdr.badge && (
                    <span className="shrink-0 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                      {hdr.badge}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="hidden sm:inline">Hoy</span>
                <span className="rounded-full border border-neutral-200 bg-white px-3 py-1">
                  {new Intl.DateTimeFormat("es-EC", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date())}
                </span>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 py-6 min-w-0">
            {children}
          </main>
        </section>
      </div>
    </div>
  );
}
