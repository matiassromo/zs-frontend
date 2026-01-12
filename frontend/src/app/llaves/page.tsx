// src/app/llaves/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { listKeys, updateKey } from "@/lib/apiv2/keys";
import type { Key } from "@/types/key";
import type { LockerKey, LockerZone } from "@/types/lockerKey";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LlavesPage() {
  const [keys, setKeys] = useState<LockerKey[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(silent = false) {
    if (!silent) setLoading(true);

    try {
      const raw: Key[] = await listKeys();
      const ordered = [...raw].sort((a, b) => a.id.localeCompare(b.id));

      const lockerKeys: LockerKey[] = ordered.map((k, index) => {
        const zone: LockerZone = index < 16 ? "Hombres" : "Mujeres";
        const indexInZone = zone === "Hombres" ? index + 1 : index - 16 + 1;
        const code = `${indexInZone}${zone === "Hombres" ? "H" : "M"}`;

        const client = k.lastAssignedClient ?? null;
        const note = (k as any).notes ?? null;
        const assigned =
          client && note ? `${client} · ${note}` : client || null;

        return {
          id: k.id,
          code,
          zone,
          status: k.available ? "disponible" : "ocupada",
          assignedTo: assigned,
          since: null,
        };
      });

      setKeys(lockerKeys);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();

    const interval = setInterval(() => {
      load(true);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const hombres = useMemo(
    () => keys.filter((k) => k.zone === "Hombres"),
    [keys]
  );
  const mujeres = useMemo(
    () => keys.filter((k) => k.zone === "Mujeres"),
    [keys]
  );

  const libresH = hombres.filter((k) => k.status === "disponible").length;
  const libresM = mujeres.filter((k) => k.status === "disponible").length;

  async function doRelease(code: string) {
    const k = keys.find((x) => x.code === code);
    if (!k) return;

    await updateKey(k.id, {
      available: true,
      lastAssignedClient: null,
      notes: null,
    });

    load();
  }

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Gestión de Lockers</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            32 Lockers totales · {libresH + libresM} disponibles
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load()}
            disabled={loading}
          >
            Actualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <KeyPanel
          title="Llaves Vestidor Hombres (1H - 16H)"
          hint={`${libresH} llaves disponibles`}
          list={hombres}
          loading={loading}
          badgeClass="bg-blue-100 text-blue-700"
        />
        <KeyPanel
          title="Llaves Vestidor Mujeres (1M - 16M)"
          hint={`${libresM} llaves disponibles`}
          list={mujeres}
          loading={loading}
          badgeClass="bg-pink-100 text-pink-700"
        />
      </div>

      <KeyTable list={keys} onRelease={doRelease} />
    </div>
  );
}

/* ---------------- UI helpers ---------------- */

function KeyPanel({
  title,
  hint,
  list,
  loading,
  badgeClass,
}: {
  title: string;
  hint: string;
  list: LockerKey[];
  loading: boolean;
  badgeClass: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={cn("px-2 py-1 rounded-full text-xs", badgeClass)}>
            Vestidor
          </span>
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{hint}</p>

      <div className="grid grid-cols-4 gap-4">
        {list
          .sort((a, b) => parseInt(a.code) - parseInt(b.code))
          .map((k) => (
            <KeyCard key={k.id} k={k} />
          ))}
        {loading && (
          <div className="col-span-4 text-sm text-muted-foreground">
            Cargando…
          </div>
        )}
      </div>
    </div>
  );
}

function KeyCard({ k }: { k: LockerKey }) {
  const busy = k.status === "ocupada";
  return (
    <div
      className={cn(
        "aspect-[1/1] rounded-xl border flex flex-col items-center justify-center gap-1",
        busy
          ? "bg-red-50 border-red-200"
          : "bg-emerald-50 border-emerald-200"
      )}
      title={busy ? `Ocupada: ${k.assignedTo ?? ""}` : "Libre"}
    >
      <div className="text-lg font-semibold">{k.code}</div>
      <div
        className={cn(
          "text-xs px-2 py-0.5 rounded-full",
          busy ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
        )}
      >
        {busy ? "Ocupada" : "Libre"}
      </div>
      {busy && (
        <div className="text-[11px] text-muted-foreground line-clamp-1">
          {k.assignedTo}
        </div>
      )}
    </div>
  );
}

function KeyTable({
  list,
  onRelease,
}: {
  list: LockerKey[];
  onRelease: (code: string) => void;
}) {
  const sorted = useMemo(() => {
    const order = (z: LockerZone) => (z === "Hombres" ? 0 : 1);
    return [...list].sort((a, b) => {
      if (order(a.zone) !== order(b.zone)) return order(a.zone) - order(b.zone);
      const an = parseInt(a.code);
      const bn = parseInt(b.code);
      return an - bn;
    });
  }, [list]);

  return (
    <div className="rounded-2xl border bg-card">
      <div className="p-5">
        <h3 className="text-xl font-semibold">Control Detallado de Llaves</h3>
        <p className="text-sm text-muted-foreground">
          Estado actual de todas las llaves
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-t border-b bg-muted/40">
            <tr>
              <th className="text-left py-3 px-5">Número de Llave</th>
              <th className="text-left py-3 px-5">Vestidor</th>
              <th className="text-left py-3 px-5">Estado</th>
              <th className="text-left py-3 px-5">Asignada a</th>
              <th className="text-left py-3 px-5">Tiempo de Uso</th>
              <th className="py-3 px-5"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((k) => (
              <tr key={k.id} className="border-b">
                <td className="py-3 px-5 font-medium">{k.code}</td>
                <td className="py-3 px-5">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs",
                      k.zone === "Hombres"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-pink-100 text-pink-700"
                    )}
                  >
                    {k.zone}
                  </span>
                </td>
                <td className="py-3 px-5">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium",
                      k.status === "disponible"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700"
                    )}
                  >
                    {k.status === "disponible" ? "Disponible" : "Ocupada"}
                  </span>
                </td>
                <td className="py-3 px-5">{k.assignedTo ?? "-"}</td>
                <td className="py-3 px-5">
                  {k.since ? timeFrom(k.since) : "-"}
                </td>
                <td className="py-3 px-5 text-right">
                  {k.status === "ocupada" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRelease(k.code)}
                    >
                      Liberar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function timeFrom(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "Ahora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} h ${r} min`;
}
