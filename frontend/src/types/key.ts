export interface Key {
  id: string;
  available: boolean;
  notes: string | null;
  lastAssignedClient: string | null;

  // ✅ NUEVO
  lastAssignedAt?: string | null;
}

export interface KeyRequestDto {
  available?: boolean;
  notes?: string | null;
  lastAssignedTo?: string | null;

  // ✅ NUEVO
  lastAssignedAt?: string | null; // ISO
}
