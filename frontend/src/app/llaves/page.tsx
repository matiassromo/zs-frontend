// src/app/llaves/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { listKeys, updateKey } from "@/lib/apiv2/keys";
import type { Key } from "@/types/key";
import type { LockerKey, LockerZone } from "@/types/lockerKey";
import { cn } from "@/lib/utils";
import Swal from "sweetalert2";

const SINCE_MAP_KEY = "zs:keys:sinceMap";

function readSinceMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(SINCE_MAP_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeSinceMap(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SINCE_MAP_KEY, JSON.stringify(map));
}

/* ---------------- UI atoms (POS) ---------------- */

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

function Chip({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: "neutral" | "blue" | "pink" | "success" | "danger";
}) {
  const cls =
    variant === "blue"
      ? "bg-sky-100 text-sky-800"
      : variant === "pink"
      ? "bg-pink-100 text-pink-800"
      : variant === "success"
      ? "bg-emerald-100 text-emerald-800"
      : variant === "danger"
      ? "bg-rose-100 text-rose-800"
      : "bg-neutral-100 text-neutral-800";
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold " +
        cls
      }
    >
      {children}
    </span>
  );
}

/* ---------------- page ---------------- */

export default function LlavesPage() {
  const [keys, setKeys] = useState<LockerKey[]>([]);
  const [loading, setLoading] = useState(true);

  // tick solo para timeFrom()
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function load(silent = false) {
    if (!silent) setLoading(true);

    try {
      const raw: Key[] = await listKeys();

      // OJO: NO ordenes por id (GUID). Si puedes, ordena por keyCode.
      const ordered = [...raw].sort((a, b) => a.id.localeCompare(b.id));

      const sinceMap = readSinceMap();
      let sinceMapChanged = false;

      const lockerKeys: LockerKey[] = ordered.map((k, index) => {
        const zone: LockerZone = index < 16 ? "Hombres" : "Mujeres";
        const indexInZone = zone === "Hombres" ? index + 1 : index - 16 + 1;
        const code = `${indexInZone}${zone === "Hombres" ? "H" : "M"}`;

        const client = k.lastAssignedClient ?? null;
        const rawNote: string | null = k.notes ?? null;

        // ✅ extrae Cuenta 017, etc.
        const m = rawNote?.match(/Cuenta\s*(\d+)/i);
        const accountId = m?.[1] ?? null;

        const cleanNote = rawNote
          ? rawNote
              .replace(/^Cuenta\s*\d+\s*-\s*/i, "")
              .replace(/^-\s*/i, "")
              .trim()
          : null;

        const assigned = client ? client : null;
        const sinceFromApi = k.lastAssignedAt ?? null;

        let since: string | null = null;

        if (!k.available) {
          if (typeof sinceFromApi === "string") {
            const d = new Date(sinceFromApi);
            since = isNaN(d.getTime()) ? null : d.toISOString();
          }

          if (!since) {
            const fp = `${assigned ?? ""}|${cleanNote ?? ""}`;
            const storedSince = sinceMap[k.id] ?? null;
            const fpKey = `__fp:${k.id}`;
            const prevFp = (sinceMap as any)[fpKey] as string | undefined;

            if (!storedSince || prevFp !== fp) {
              sinceMap[k.id] = new Date().toISOString();
              (sinceMap as any)[fpKey] = fp;
              sinceMapChanged = true;
            }

            since = sinceMap[k.id] ?? null;
          }
        } else {
          if (sinceMap[k.id]) {
            delete sinceMap[k.id];
            delete (sinceMap as any)[`__fp:${k.id}`];
            sinceMapChanged = true;
          }
          since = null;
        }

        return {
          id: k.id,
          code,
          zone,
          status: k.available ? "disponible" : "ocupada",
          assignedTo: assigned,
          since,
          accountId,
        };
      });

      if (sinceMapChanged) writeSinceMap(sinceMap);
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

  const hombres = useMemo(() => keys.filter((k) => k.zone === "Hombres"), [keys]);
  const mujeres = useMemo(() => keys.filter((k) => k.zone === "Mujeres"), [keys]);

  const libresH = hombres.filter((k) => k.status === "disponible").length;
  const libresM = mujeres.filter((k) => k.status === "disponible").length;

  async function doRelease(code: string) {
    const k = keys.find((x) => x.code === code);
    if (!k) return;

    await updateKey(k.id, {
      available: true,
      lastAssignedTo: null,
      notes: null,
      lastAssignedAt: null,
    });

    // ✅ avisa al POS
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("zs:keys-changed", {
          detail: { accountId: (k as any).accountId ?? null, code },
        })
      );

      // ✅ opcional: multi-tab
      try {
        new BroadcastChannel("zs:bus").postMessage({
          type: "keys-changed",
          accountId: (k as any).accountId ?? null,
          code,
        });
      } catch {}
    }

    load();
  }

  return (
    <div className="p-6 space-y-4">
      {/* Top row (sin títulos duplicados, estilo POS) */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Chip variant="neutral">32 lockers</Chip>
            <Chip variant="success">{libresH + libresM} disponibles</Chip>
            <Chip variant="blue">{libresH} H</Chip>
            <Chip variant="pink">{libresM} M</Chip>
            {loading ? <span className="text-sm text-neutral-500 ml-2">Cargando…</span> : null}
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="grid gap-4 md:grid-cols-2">
        <KeyPanel
          title="Llaves Vestidor Hombres (1H - 16H)"
          hint={`${libresH} llaves disponibles`}
          list={hombres}
          loading={loading}
          chip={<Chip variant="blue">Hombres</Chip>}
          onRelease={doRelease}
        />
        <KeyPanel
          title="Llaves Vestidor Mujeres (1M - 16M)"
          hint={`${libresM} llaves disponibles`}
          list={mujeres}
          loading={loading}
          chip={<Chip variant="pink">Mujeres</Chip>}
          onRelease={doRelease}
        />
      </div>

      {/* Table */}
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
  chip,
  onRelease,
}: {
  title: string;
  hint: string;
  list: LockerKey[];
  loading: boolean;
  chip: React.ReactNode;
  onRelease: (code: string) => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {chip}
            <div className="text-sm font-semibold text-neutral-900">{title}</div>
          </div>
          <div className="text-xs text-neutral-500 mt-1">{hint}</div>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-4 gap-3">
          {list
            .slice()
            .sort((a, b) => parseInt(a.code) - parseInt(b.code))
            .map((k) => (
              <KeyCard key={k.id} k={k} onRelease={onRelease} />
            ))}

          {loading && (
            <div className="col-span-4 text-sm text-neutral-500">Cargando…</div>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyCard({
  k,
  onRelease,
}: {
  k: LockerKey;
  onRelease: (code: string) => Promise<void>;
}) {
  const busy = k.status === "ocupada";

  return (
    <button
      type="button"
      disabled={!busy}
      onClick={async () => {
        if (!busy) return;

        const res = await Swal.fire({
          icon: "question",
          title: `¿Liberar ${k.code}?`,
          text: `Asignada a: ${k.assignedTo ?? "—"}`,
          showCancelButton: true,
          confirmButtonText: "Sí, liberar",
          cancelButtonText: "Cancelar",
        });

        if (!res.isConfirmed) return;

        await onRelease(k.code);

        await Swal.fire({
          icon: "success",
          title: "Llave liberada",
          timer: 900,
          showConfirmButton: false,
        });
      }}
      className={cn(
        "aspect-[1/1] rounded-xl border flex flex-col items-center justify-center gap-1 transition",
        busy
          ? "bg-rose-50 border-rose-200 hover:bg-rose-100 cursor-pointer"
          : "bg-emerald-50 border-emerald-200 cursor-default"
      )}
      title={busy ? `Click para liberar · ${k.assignedTo ?? ""}` : "Libre"}
    >
      <div className="text-lg font-semibold text-neutral-900">{k.code}</div>

      <span
        className={cn(
          "text-xs px-2 py-0.5 rounded-full font-semibold",
          busy ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
        )}
      >
        {busy ? "Ocupada" : "Libre"}
      </span>

      {busy && (
        <div className="text-[11px] text-neutral-500 line-clamp-1">
          {k.assignedTo}
        </div>
      )}
    </button>
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
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
        <div className="font-semibold">Control detallado</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead className="bg-neutral-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="py-3 px-3">Llave</th>
              <th className="py-3 px-3">Vestidor</th>
              <th className="py-3 px-3">Estado</th>
              <th className="py-3 px-3">Asignada a</th>
              <th className="py-3 px-3">Tiempo</th>
              <th className="py-3 px-3 text-right">Acción</th>
            </tr>
          </thead>

          <tbody className="[&>tr]:border-t [&>tr]:border-neutral-200">
            {sorted.map((k) => {
              const busy = k.status === "ocupada";
              return (
                <tr key={k.id} className="hover:bg-neutral-50">
                  <td className="py-3 px-3 font-semibold text-neutral-900">{k.code}</td>
                  <td className="py-3 px-3">
                    {k.zone === "Hombres" ? (
                      <Chip variant="blue">Hombres</Chip>
                    ) : (
                      <Chip variant="pink">Mujeres</Chip>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {busy ? <Chip variant="danger">Ocupada</Chip> : <Chip variant="success">Libre</Chip>}
                  </td>
                  <td className="py-3 px-3">{k.assignedTo ?? "-"}</td>
                  <td className="py-3 px-3">{k.since ? timeFrom(k.since) : "-"}</td>
                  <td className="py-3 px-3">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={!busy}
                        onClick={async () => {
                          if (!busy) return;
                          const res = await Swal.fire({
                            icon: "question",
                            title: `¿Liberar ${k.code}?`,
                            text: `Asignada a: ${k.assignedTo ?? "—"}`,
                            showCancelButton: true,
                            confirmButtonText: "Sí, liberar",
                            cancelButtonText: "Cancelar",
                          });
                          if (!res.isConfirmed) return;
                          await onRelease(k.code);
                          await Swal.fire({
                            icon: "success",
                            title: "Llave liberada",
                            timer: 900,
                            showConfirmButton: false,
                          });
                        }}
                        className={cn(
                          "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition",
                          busy
                            ? "bg-neutral-900 text-white hover:bg-neutral-800"
                            : "border border-neutral-200 bg-white text-neutral-400 cursor-not-allowed"
                        )}
                      >
                        Liberar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function timeFrom(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
