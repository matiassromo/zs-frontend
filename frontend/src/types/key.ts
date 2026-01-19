export interface Key {
  id: string;
  keyCode: string;
  available: boolean;
  notes: string | null;
  lastAssignedTo?: string | null;
  lastAssignedClient: string | null;
  lastAssignedAt?: string | null;
}

export interface KeyRequestDto {
  available?: boolean;
  notes?: string | null;
  lastAssignedTo?: string | null;
  lastAssignedAt?: string | null; // ISO
}
