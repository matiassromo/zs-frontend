// src/app/pases/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  listAccessCards,
  createAccessCardForHolder,
  updateAccessCard,
  deleteAccessCard,
} from "@/lib/apiv2/accessCards";

import { listEntranceAccessCards } from "@/lib/apiv2/entranceAccessCards";

import type { AccessCard } from "@/types/accessCard";
import type { EntranceAccessCard } from "@/types/entranceAccessCard";

/* ---------------- helpers (igual estilo POS) ---------------- */

function norm(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function safeName(card: AccessCard) {
  const n = (card.holderName ?? "").trim();
  return n || "—";
}

function shortId(id: string) {
  return `#${id.slice(0, 8)}`;
}

// “Matias” -> si escribes "m" o "ma" o "mat" matchea por inicio de alguna palabra
function matchesPrefixAnyWord(fullName: string, q: string) {
  const nq = norm(q);
  if (!nq) return true;
  const words = norm(fullName).split(/\s+/).filter(Boolean);
  return words.some((w) => w.startsWith(nq));
}

function lastUseMs(hist: EntranceAccessCard[], cardId: string): number {
  const mine = hist.filter((x) => x.accessCardId === cardId && x.entranceDate);
  if (mine.length === 0) return 0;

  let max = 0;
  for (const x of mine) {
    const d = `${x.entranceDate ?? ""}T${x.entranceEntryTime ?? "00:00:00"}`;
    const t = new Date(d).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

function lastUseFromHist(hist: EntranceAccessCard[], cardId: string) {
  const mine = hist
    .filter((x) => x.accessCardId === cardId && x.entranceDate)
    .slice();

  if (mine.length === 0) return "—";

  mine.sort((a, b) => {
    const da = `${a.entranceDate ?? ""}T${a.entranceEntryTime ?? "00:00:00"}`;
    const db = `${b.entranceDate ?? ""}T${b.entranceEntryTime ?? "00:00:00"}`;
    return new Date(da).getTime() - new Date(db).getTime();
  });

  const last = mine[mine.length - 1];
  return new Date(
    `${last.entranceDate ?? ""}T${last.entranceEntryTime ?? "00:00:00"}`
  ).toLocaleString("es-EC");
}

/* ---------------- UI atoms (clone estilo POS) ---------------- */

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
  variant?: "neutral" | "success" | "warning";
}) {
  const cls =
    variant === "success"
      ? "bg-emerald-100 text-emerald-800"
      : variant === "warning"
      ? "bg-amber-100 text-amber-800"
      : "bg-neutral-100 text-neutral-800";
  return (
    <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium " + cls}>
      {children}
    </span>
  );
}

/* ---------------- page ---------------- */

export default function PasesPage() {
  const router = useRouter();

  const [items, setItems] = useState<AccessCard[]>([]);
  const [hist, setHist] = useState<EntranceAccessCard[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    const [cards, entries] = await Promise.all([
      listAccessCards(),
      listEntranceAccessCards(),
    ]);

    // ✅ orden: último uso (desc) y si no tiene uso, por id (desc) para que nuevas queden arriba
    const sorted = cards.slice().sort((a, b) => {
      const ta = lastUseMs(entries, a.id);
      const tb = lastUseMs(entries, b.id);
      if (ta !== tb) return tb - ta;
      return b.id.localeCompare(a.id);
    });

    setItems(sorted);
    setHist(entries);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim();
    if (!query) return items;

    const nq = norm(query);

    return items.filter((it) => {
      const holder = safeName(it);
      const idShort = it.id.slice(0, 8);
      const fullId = it.id;

      if (matchesPrefixAnyWord(holder, nq)) return true;
      if (norm(idShort).includes(nq)) return true;
      if (norm(fullId).includes(nq)) return true;

      return false;
    });
  }, [q, items]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((x) => (x.uses ?? 0) > 0).length;
    const finished = total - active;
    return { total, active, finished };
  }, [items]);


  async function onEdit(card: AccessCard) {
    const newName = prompt("Editar nombre del dueño:", card.holderName ?? "");
    if (newName == null) return;
    const holderName = newName.trim();
    if (!holderName) return;

    await updateAccessCard(card.id, {
      holderName,
      total: card.total,
      uses: card.uses,
      transactionId: card.transactionId ?? null,
    });

    await load();
  }

  async function onDelete(card: AccessCard) {
    const ok = confirm(`Eliminar tarjeta ${shortId(card.id)} de "${safeName(card)}"?`);
    if (!ok) return;
    await deleteAccessCard(card.id);
    await load();
  }

  return (
 <div className="p-6 space-y-4">
  {/* Panel acciones + búsqueda (sin títulos duplicados) */}
  <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
    <div className="p-4 grid gap-4">
      {/* acciones */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium text-neutral-500">Total</div>
            <div className="mt-1 text-2xl font-semibold text-neutral-900">{stats.total}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium text-neutral-500">Activas</div>
            <div className="mt-1 text-2xl font-semibold text-neutral-900">{stats.active}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium text-neutral-500">Finalizadas</div>
            <div className="mt-1 text-2xl font-semibold text-neutral-900">{stats.finished}</div>
          </div>
        </div>
      </div>

      {/* búsqueda */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <input
            className="w-full rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
            placeholder="Buscar por dueño o ID… (ej: M, Ma, Matias)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
    </div>
  </div>

  {/* Table card estilo POS */}
  <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
    <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
      <div className="font-semibold">Listado</div>
      {loading ? <span className="text-sm text-neutral-500">Cargando…</span> : null}
    </div>

    {!loading && (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-neutral-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="py-3 px-3">Dueño</th>
              <th className="py-3 px-3">Tarjeta</th>
              <th className="py-3 px-3">Pases usados</th>
              <th className="py-3 px-3">Último uso</th>
              <th className="py-3 px-3">Estado</th>
              <th className="py-3 px-3 text-right">Acciones</th>
            </tr>
          </thead>

          <tbody className="[&>tr]:border-t [&>tr]:border-neutral-200">
            {filtered.map((it) => {
              const remaining = it.uses ?? 0;
              const used = (it.total ?? 0) - remaining;

              const statusChip =
                remaining > 0 ? (
                  <Chip variant="success">Activa</Chip>
                ) : (
                  <Chip variant="neutral">Finalizada</Chip>
                );

              return (
                <tr
                  key={it.id}
                  className="hover:bg-neutral-50 cursor-pointer"
                  onClick={() => router.push(`/pases/${it.id}`)}
                >
                  <td className="py-3 px-3">
                    <div className="font-semibold text-neutral-900">{safeName(it)}</div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="font-semibold">{shortId(it.id)}</div>
                    <div className="text-xs text-neutral-500">{it.id}</div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="font-semibold">
                      {used} / {it.total}
                    </div>
                    <div className="text-xs text-neutral-500">Restantes: {remaining}</div>
                  </td>

                  <td className="py-3 px-3 whitespace-nowrap">
                    {lastUseFromHist(hist, it.id)}
                  </td>

                  <td className="py-3 px-3">{statusChip}</td>

                  <td className="py-3 px-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(it);
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(it);
                        }}
                        title="Eliminar"
                        className="inline-flex items-center justify-center rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 px-3 text-center text-neutral-500">
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )}

    {loading && <div className="p-4 text-sm text-neutral-500">Cargando…</div>}
  </div>
</div>

  );
}
