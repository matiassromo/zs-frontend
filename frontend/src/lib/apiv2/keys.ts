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
  };

  const dto = await http<any>(`/api/Keys/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  return normalize(dto);
}

function normalize(dto: any): Key {
  return {
    id: dto.id ?? dto.Id,
    available: dto.available ?? dto.Available ?? false,
    notes: dto.notes ?? dto.Notes ?? null,

    // guarda el guid si viene como string
    lastAssignedClient:
      dto.lastAssignedClient ??
      dto.LastAssignedClient ??
      dto.lastAssignedTo ??
      dto.LastAssignedTo ??
      null,
  };
}
