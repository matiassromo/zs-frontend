// src/lib/lockerKeysSync.ts
"use client";

import { listKeys, updateKey } from "@/lib/apiv2/keys";
import type { Key } from "@/types/key";
import type { LockerZone } from "@/types/lockerKey";

const SYNC_EVENT = "zs:sync";
const SYNC_TS_KEY = "zs:sync:ts";

function emitZsSync() {
  if (typeof window === "undefined") return;

  // mismo tab
  window.dispatchEvent(new Event(SYNC_EVENT));

  // otros tabs/ventanas
  try {
    window.localStorage.setItem(SYNC_TS_KEY, String(Date.now()));
  } catch {}
}

function buildCodeFromIndex(index: number): { code: string; zone: LockerZone } {
  const zone: LockerZone = index < 16 ? "Hombres" : "Mujeres";
  const indexInZone = zone === "Hombres" ? index + 1 : index - 16 + 1;
  const code = `${indexInZone}${zone === "Hombres" ? "H" : "M"}`;
  return { code, zone };
}

// Mapea códigos "16M", "1H" -> ids reales de Key en el backend
async function getKeyIdsByCodes(codes: string[]): Promise<string[]> {
  const raw: Key[] = await listKeys();
  const ordered = [...raw].sort((a, b) => a.id.localeCompare(b.id));

  const mapCodeToId: Record<string, string> = {};
  ordered.forEach((k, index) => {
    const { code } = buildCodeFromIndex(index);
    mapCodeToId[code] = k.id;
  });

  return codes.map((c) => mapCodeToId[c]).filter((id): id is string => !!id);
}

// Marcar llaves como ocupadas desde el POS
export async function occupyLockerKeys(codes: string[], clientName: string) {
  const ids = await getKeyIdsByCodes(codes);

  await Promise.all(
    ids.map((id) =>
      updateKey(id, {
        available: false,
        lastAssignedTo: clientName, // ✅ CORRECTO
        notes: null,
      })
    )
  );


  // 🔥 refrescar sidebar/dashboard
  emitZsSync();
}

// Marcar llaves como libres (devolver llaves)
export async function releaseLockerKeys(codes: string[]) {
  const ids = await getKeyIdsByCodes(codes);

  await Promise.all(
    ids.map((id) =>
      updateKey(id, {
        available: true,
        lastAssignedTo: null, // ✅ CORRECTO
        notes: null,
      })
    )
  );


  // 🔥 refrescar sidebar/dashboard
  emitZsSync();
}

// Útil si en /llaves liberas con updateKey directo
export function notifyKeysChanged() {
  emitZsSync();
}
