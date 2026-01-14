// src/lib/apiv2/keys.ts
import type { Key, KeyRequestDto } from "@/types/key";
import { http } from "./http";

export async function listKeys(): Promise<Key[]> {
  const dtos = await http<any[]>(`/api/Keys`);
  return (dtos ?? []).map(normalize);
}

export async function updateKey(id: string, input: KeyRequestDto): Promise<Key> {
  const payload = {
    Available: input.available,
    Notes: input.notes ?? null,
    LastAssignedTo: input.lastAssignedTo ?? null,

    // ✅ NUEVO
    LastAssignedAt: input.lastAssignedAt ?? null,
  };

  const dto = await http<any>(`/api/Keys/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  return normalize(dto);
}

function ensureTz(iso: any): string | null {
  const s = typeof iso === "string" ? iso : null;
  if (!s) return null;

  // si ya tiene Z o +hh:mm o -hh:mm, déjalo
  if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return s;

  // si no tiene timezone, asumimos UTC
  return `${s}Z`;
}

function normalize(dto: any): Key {
  const rawLastAssignedAt = dto.lastAssignedAt ?? dto.LastAssignedAt ?? null;

  return {
    id: dto.id ?? dto.Id,
    available: dto.available ?? dto.Available ?? false,
    notes: dto.notes ?? dto.Notes ?? null,
    lastAssignedClient:
      dto.lastAssignedClient?.name ??
      dto.LastAssignedClient?.name ??
      null,

    lastAssignedAt: ensureTz(rawLastAssignedAt), // ✅
  };
}


