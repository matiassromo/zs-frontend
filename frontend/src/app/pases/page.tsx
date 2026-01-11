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

function safeName(card: AccessCard) {
  const n = (card.holderName ?? "").trim();
  return n || "—";
}

function shortId(id: string) {
  return `#${id.slice(0, 8)}`;
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
  ).toLocaleString();
}

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
    setItems(cards);
    setHist(entries);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;

    return items.filter((it) => {
      const idShort = it.id.slice(0, 8).toLowerCase();
      const fullId = it.id.toLowerCase();
      const holder = (it.holderName ?? "").toLowerCase();
      return (
        holder.includes(query) ||
        idShort.includes(query) ||
        fullId.includes(query) ||
        `${it.uses}/${it.total}`.includes(query)
      );
    });
  }, [q, items]);

  async function onCreate() {
    const holderName = prompt("Nombre del dueño de la tarjeta:");
    if (!holderName?.trim()) return;

    await createAccessCardForHolder(holderName.trim(), 10);
    await load();
  }

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
      <div className="flex items-center justify-between">

        <button className="btn" onClick={onCreate} type="button">
          + Crear tarjeta
        </button>
      </div>

      <div className="flex gap-3">
        <input
          className="input"
          placeholder="Buscar por dueño o ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" onClick={load} type="button">
          Recargar
        </button>
      </div>

      {loading && <div>Cargando…</div>}

      {!loading && (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                <th>Dueño</th>
                <th>Tarjeta</th>
                <th>Pases usados</th>
                <th>Último uso</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>

            <tbody className="[&>tr]:border-t">
              {filtered.map((it) => {
                const remaining = it.uses;
                const used = it.total - it.uses;

                return (
                  <tr
                    key={it.id}
                    className="hover:bg-neutral-50 cursor-pointer"
                    onClick={() => router.push(`/pases/${it.id}`)}
                  >
                    <td className="px-3 py-3">
                      <div className="font-medium">{safeName(it)}</div>
                    </td>

                    <td className="px-3 py-3">
                      <div className="font-medium">{shortId(it.id)}</div>
                      <div className="text-xs opacity-60">{it.id}</div>
                    </td>

                    <td className="px-3 py-3">
                      {used} / {it.total}
                    </td>

                    <td className="px-3 py-3">
                      {lastUseFromHist(hist, it.id)}
                    </td>

                    <td className="px-3 py-3">
                      <span className="badge">
                        {remaining > 0 ? "Activa" : "Finalizada"}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          className="btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(it);
                          }}
                          type="button"
                        >
                          Editar
                        </button>

                        <button
                          className="btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(it);
                          }}
                          type="button"
                          title="Eliminar"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center opacity-60">
                    Sin resultados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
