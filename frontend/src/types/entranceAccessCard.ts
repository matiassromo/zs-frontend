export interface EntranceAccessCard {
  id: string;
  accessCardId?: string;
  entranceDate?: string;
  entranceEntryTime?: string;
  entranceExitTime?: string | null;
  qty?: number; // ✅ NUEVO
}

export interface EntranceAccessCardRequestDto {
  accessCardId?: string;
  entranceDate?: string;
  entranceEntryTime?: string;
  entranceExitTime?: string | null;
  qty?: number; // ✅ NUEVO
}
