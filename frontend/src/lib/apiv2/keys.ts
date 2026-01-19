// src/lib/apiv2/keys.ts
import type { Key, KeyRequestDto } from "@/types/key";
import { http } from "./http";

export async function listKeys(): Promise<Key[]> {
  const dtos = await http<any[]>(`/api/Keys`);
  return (dtos ?? []).map(normalize);
}

export async function getKeyById(id: string): Promise<Key | null> {
  try {
    const dto = await http<any>(`/api/Keys/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
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
    keyCode: dto.keyCode ?? dto.KeyCode ?? "",
    available: dto.available ?? dto.Available ?? false,
    notes: dto.notes ?? dto.Notes ?? null,
    lastAssignedTo: dto.lastAssignedTo ?? dto.LastAssignedTo ?? null,
    lastAssignedClient:
      dto.lastAssignedClient?.name ??
      dto.LastAssignedClient?.name ??
      null,
    lastAssignedAt: ensureTz(rawLastAssignedAt),
    transactionId: dto.transactionId ?? dto.TransactionId ?? null,
  };
}

/**
 * Assigns a key to a visitor/transaction
 */
export async function assignKey(
  id: string,
  params: { visitorName: string; transactionId?: string; notes?: string }
): Promise<Key> {
  return updateKey(id, {
    available: false,
    lastAssignedTo: params.transactionId ?? null,
    lastAssignedAt: new Date().toISOString(),
    notes: params.notes ?? `Assigned to ${params.visitorName}`,
  });
}

/**
 * Releases a key (marks as available)
 */
export async function releaseKey(id: string): Promise<Key> {
  return updateKey(id, {
    available: true,
    lastAssignedTo: null,
    notes: null,
  });
}

/**
 * Lists all available keys
 */
export async function listAvailableKeys(): Promise<Key[]> {
  const all = await listKeys();
  return all.filter(k => k.available);
}

/**
 * Lists keys by gender zone (H = first 16, M = rest)
 */
export async function listAvailableKeysByGender(gender: "H" | "M"): Promise<Key[]> {
  const all = await listKeys();
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));

  return sorted.filter((k, index) => {
    if (!k.available) return false;
    const keyGender = index < 16 ? "H" : "M";
    return keyGender === gender;
  });
}

export default {
  listKeys,
  getKeyById,
  updateKey,
  assignKey,
  releaseKey,
  listAvailableKeys,
  listAvailableKeysByGender,
};
