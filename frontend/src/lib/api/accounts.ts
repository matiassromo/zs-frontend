// src/lib/api/accounts.ts
import { PosEntryType, SelectedKey } from "@/types/pos";
import { releaseLockerKeys } from "@/lib/lockerKeysSync"; // <- NUEVO



export type PosAccount = {
  id: string;
  status: "Abierta" | "Cerrada";
  openedAt: string;
  closedAt?: string | null;
  clientId: string;
  clientName: string;
  gender: "M" | "F";
  keys?: { items: SelectedKey[]; duration: "1H" | "8H" | "2M" };
  entryType: PosEntryType;
  requiresParking?: boolean;

  // ✅ personas persistidas (para Dashboard)
  peopleCount?: number;
  counts?: { A: number; N: number; TE: number; D: number; AC: number };
};

export type Charge = {
  id: string;
  kind: "Normal" | "Pase" | "Key";
  concept: string;
  qty: number;
  amount: number;
  total: number;
  status: "Pendiente" | "Pagado";
  createdAt: string;
};

export type Payment = {
  id: string;
  method: "Efectivo" | "Transferencia" | "Tarjeta";
  amount: number;
  note?: string;
  createdAt: string;
};

export type AccountSummary = {
  id: string;
  clientId: string;
  clientName: string;
  status: "Abierta" | "Cerrada";
  openedAt: string;
  closedAt?: string | null;
  totalCargos: number;
  totalPagos: number;
  saldo: number;

  // opcionales útiles para editar
  gender?: "M" | "F";
  entryType?: PosEntryType;
  requiresParking?: boolean;
  keys?: { items: SelectedKey[]; duration: "1H" | "8H" | "2M" };

  // opcional: si luego lo quieres mostrar en detalle
  peopleCount?: number;
  counts?: { A: number; N: number; TE: number; D: number; AC: number };
};

export type UpdateAccountInput = Partial<{
  clientId: string;
  clientName: string;
  entryType: "Normal" | "Tarjeta 10 pases";
  gender: "M" | "F";
  requiresParking: boolean;

  people: {
    adult: number;
    child: number;
    te: number;
    dis: number;
    ac: number;
  };

  keys: { gender: "H" | "M"; number: number }[];
}>;

type PassRecord = {
  id: string;
  holderName: string;
  remaining: number;
  active: boolean;
};

type Store = {
  day: string;
  accounts: PosAccount[];
  chargesByAccount: Record<string, Charge[]>;
  paymentsByAccount: Record<string, Payment[]>;
  passesByHolder: Record<string, PassRecord>;
};

const KEY = "ZS_POS_STORE_v3";

export const PRICES = {
  A: 7.0,
  N: 4.0,
  TE: 5.0,
  D: 5.0,
  AC: 1.0,
  PASS: 55.0,
  KEY_1H: 0.0,
  KEY_8H: 0.0,
  KEY_2M: 0.0,
};

/* ------------------ util ------------------ */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function nowISO() {
  return new Date().toISOString();
}
function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
function isSSR() {
  return typeof window === "undefined";
}
function normName(s: string) {
  return s.trim().toLowerCase();
}

function safeNum(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function emptyCounts() {
  return { A: 0, N: 0, TE: 0, D: 0, AC: 0 };
}

function inferCountsFromCharges(charges: Charge[]) {
  const c = emptyCounts();

  for (const ch of charges ?? []) {
    if (ch.kind !== "Normal") continue;
    const concept = String(ch.concept ?? "").toUpperCase();

    if (concept.includes("(A)")) c.A += safeNum(ch.qty);
    else if (concept.includes("(N)")) c.N += safeNum(ch.qty);
    else if (concept.includes("(TE)")) c.TE += safeNum(ch.qty);
    else if (concept.includes("(D)")) c.D += safeNum(ch.qty);
    else if (concept.includes("(AC)")) c.AC += safeNum(ch.qty);
  }

  const total = c.A + c.N + c.TE + c.D + c.AC;
  return { counts: c, peopleCount: total };
}

// ✅ migración: repara cuentas viejas que no guardaban peopleCount/counts
function migratePeopleFields(s: Store) {
  let changed = false;

  // asegura objetos base (por si existen stores viejos)
  if (!("chargesByAccount" in s)) (s as any).chargesByAccount = {};
  if (!("paymentsByAccount" in s)) (s as any).paymentsByAccount = {};
  if (!("passesByHolder" in s)) (s as any).passesByHolder = {};

  for (const a of s.accounts ?? []) {
    const pc = Number((a as any).peopleCount);
    const hasPeople = Number.isFinite(pc) && pc > 0;
    const hasCounts = !!(a as any).counts;

    if (hasPeople && hasCounts) continue;

    const charges = s.chargesByAccount[a.id] ?? [];
    const inf = inferCountsFromCharges(charges);

    // fallback para pases (si no hay cargos normales)
    const isPass =
      String((a as any).entryType ?? "").toLowerCase() === "pass" ||
      String((a as any).entryType ?? "").toLowerCase() === "tarjeta 10 pases";

    const finalPeople = inf.peopleCount > 0 ? inf.peopleCount : isPass ? 1 : 0;

    (a as any).peopleCount = finalPeople;
    (a as any).counts = inf.counts;

    changed = true;
  }

  return { changed, store: s };
}

/* ------------------ store ------------------ */
function freshStore(): Store {
  return {
    day: todayStr(),
    accounts: [],
    chargesByAccount: {},
    paymentsByAccount: {},
    passesByHolder: {},
  };
}

function save(s: Store) {
  if (!isSSR()) localStorage.setItem(KEY, JSON.stringify(s));
}

function load(): Store {
  if (isSSR()) return freshStore();

  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const init = freshStore();
    save(init);
    return init;
  }

  const s = JSON.parse(raw) as Store;

  if (s.day !== todayStr()) {
    const init = freshStore();
    save(init);
    return init;
  }

  // ✅ MIGRACIÓN (recalcula y persiste)
  const mig = migratePeopleFields(s);
  if (mig.changed) save(mig.store);

  return mig.store;
}

/* ------------------ API cuentas ------------------ */
export async function listAccountsToday(): Promise<PosAccount[]> {
  return load().accounts;
}

export async function getAccount(id: string): Promise<AccountSummary> {
  const s = load();
  const acc = s.accounts.find((a) => a.id === id);
  if (!acc) throw new Error("Cuenta no encontrada.");

  const charges = s.chargesByAccount[id] ?? [];
  const payments = s.paymentsByAccount[id] ?? [];
  const totalCargos = charges.reduce((ac, c) => ac + c.total, 0);
  const totalPagos = payments.reduce((ac, p) => ac + p.amount, 0);

  return {
    id,
    clientId: acc.clientId,
    clientName: acc.clientName,
    status: acc.status,
    openedAt: acc.openedAt,
    closedAt: acc.closedAt ?? null,
    totalCargos,
    totalPagos,
    saldo: totalCargos - totalPagos,

    gender: acc.gender,
    entryType: acc.entryType,
    requiresParking: acc.requiresParking ?? false,
    keys: acc.keys,

    peopleCount: acc.peopleCount,
    counts: acc.counts,
  };
}

export async function listCharges(id: string) {
  return load().chargesByAccount[id] ?? [];
}
export async function listPayments(id: string) {
  return load().paymentsByAccount[id] ?? [];
}

/* ------------------ editar cuenta ------------------ */
export async function updateAccount(
  accountId: string,
  input: Partial<
    Pick<
      PosAccount,
      "clientName" | "gender" | "entryType" | "requiresParking" | "keys" | "peopleCount" | "counts"
    >
  >
): Promise<PosAccount> {
  const s = load();
  const idx = s.accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) throw new Error("Cuenta no encontrada.");

  const current = s.accounts[idx];
  if (current.status !== "Abierta") throw new Error("Solo se puede editar una cuenta abierta.");

  const next: PosAccount = {
    ...current,
    ...input,
    clientName: input.clientName !== undefined ? input.clientName : current.clientName,
  };

  s.accounts[idx] = next;
    // ✅ Si llaves quedan vacías, borrar cargo Key del store
  // ✅ Si keys fue tocado y queda vacío, borrar cargo Key del store
  const keysTouched = Object.prototype.hasOwnProperty.call(input, "keys");
  const incomingKeys = (input as any).keys;

  const willHaveNoKeys =
    !incomingKeys ||
    !Array.isArray(incomingKeys.items) ||
    incomingKeys.items.length === 0;

  if (keysTouched && willHaveNoKeys) {
    const list = s.chargesByAccount[accountId] ?? [];
    s.chargesByAccount[accountId] = list.filter((c) => c.kind !== "Key");

    // ✅ también limpia las llaves en la cuenta
    (next as any).keys = undefined;
  }


  save(s);
  return next;
}

/* ------------------ Cargos / Pagos ------------------ */
export async function addCharge(
  accountId: string,
  input: { kind: "Normal" | "Pase" | "Key"; concept: string; qty: number; amount: number }
) {
  const s = load();
  const acc = s.accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("Cuenta no encontrada.");
  if (acc.status !== "Abierta") throw new Error("No se pueden agregar cargos a una cuenta cerrada.");

  const list = s.chargesByAccount[accountId] ?? [];
  const ch: Charge = {
    id: uid("ch"),
    kind: input.kind,
    concept: input.concept,
    qty: input.qty,
    amount: input.amount,
    total: +(input.qty * input.amount).toFixed(2),
    status: "Pendiente",
    createdAt: nowISO(),
  };
  s.chargesByAccount[accountId] = [ch, ...list];
  save(s);

  // ✅ si agregas cargos normales luego, re-sincroniza peopleCount/counts
  if (ch.kind === "Normal") {
    const inf = inferCountsFromCharges(s.chargesByAccount[accountId]);
    await updateAccount(accountId, { peopleCount: inf.peopleCount, counts: inf.counts });
  }

  return ch;
}

export async function addPayment(
  accountId: string,
  input: { method: "Efectivo" | "Transferencia" | "Tarjeta"; amount: number; note?: string }
) {
  const s = load();
  const acc = s.accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("Cuenta no encontrada.");
  if (acc.status !== "Abierta") throw new Error("No se pueden agregar pagos a una cuenta cerrada.");

  const list = s.paymentsByAccount[accountId] ?? [];
  const p: Payment = {
    id: uid("pm"),
    method: input.method,
    amount: input.amount,
    note: input.note,
    createdAt: nowISO(),
  };
  s.paymentsByAccount[accountId] = [p, ...list];
  save(s);
  return p;
}

export async function markChargePaid(accountId: string, chargeId: string) {
  const s = load();
  const list = s.chargesByAccount[accountId] ?? [];
  const i = list.findIndex((c) => c.id === chargeId);
  if (i >= 0) {
    list[i] = { ...list[i], status: "Pagado" };
    s.chargesByAccount[accountId] = list;
    save(s);
  }
}

/* ------------------ editar/eliminar cargo (cuenta abierta) ------------------ */
export async function updateCharge(
  accountId: string,
  chargeId: string,
  input: Partial<Pick<Charge, "concept" | "qty" | "amount">>
): Promise<Charge> {
  const s = load();
  const acc = s.accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("Cuenta no encontrada.");
  if (acc.status !== "Abierta") throw new Error("Solo se puede editar una cuenta abierta.");

  const list = s.chargesByAccount[accountId] ?? [];
  const idx = list.findIndex((c) => c.id === chargeId);
  if (idx === -1) throw new Error("Cargo no encontrado.");

  const current = list[idx];
  if (current.status === "Pagado") throw new Error("No se puede editar un cargo pagado.");

  const nextQty = input.qty !== undefined ? input.qty : current.qty;
  const nextAmount = input.amount !== undefined ? input.amount : current.amount;

  const next: Charge = {
    ...current,
    ...input,
    qty: nextQty,
    amount: nextAmount,
    total: +(nextQty * nextAmount).toFixed(2),
  };

  list[idx] = next;
  s.chargesByAccount[accountId] = list;
  save(s);

  // ✅ re-sincroniza peopleCount/counts si es Normal
  if (next.kind === "Normal") {
    const inf = inferCountsFromCharges(s.chargesByAccount[accountId]);
    await updateAccount(accountId, { peopleCount: inf.peopleCount, counts: inf.counts });
  }

  return next;
}

export async function deleteCharge(accountId: string, chargeId: string) {
  const s = load();
  const acc = s.accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("Cuenta no encontrada.");
  if (acc.status !== "Abierta") throw new Error("Solo se puede editar una cuenta abierta.");

  const list = s.chargesByAccount[accountId] ?? [];
  const target = list.find((c) => c.id === chargeId);
  if (!target) return;

  if (target.status === "Pagado") throw new Error("No se puede eliminar un cargo pagado.");

  s.chargesByAccount[accountId] = list.filter((c) => c.id !== chargeId);
  save(s);

  if (target.kind === "Normal") {
    const inf = inferCountsFromCharges(s.chargesByAccount[accountId] ?? []);
    await updateAccount(accountId, { peopleCount: inf.peopleCount, counts: inf.counts });
  }
}


/* ------------------ llaves mutables en cuenta (local store) ------------------ */
export async function setAccountKeys(
  accountId: string,
  input: { items: SelectedKey[]; duration: "1H" | "8H" | "2M" } | undefined
) {
  return updateAccount(accountId, { keys: input });
}

/**
 * Cierra la cuenta: status = "Cerrada", marca closedAt y libera llaves en módulo Llaves.
 */
export async function closeAccount(id: string): Promise<PosAccount | undefined> {
  const s = load();
  const idx = s.accounts.findIndex((a) => a.id === id);
  if (idx === -1) return;

  const now = nowISO();
  const updated: PosAccount = {
    ...s.accounts[idx],
    status: "Cerrada",
    closedAt: now,
  };

  s.accounts[idx] = updated;
  save(s);

  if (updated.keys?.items?.length) {
    const codes = updated.keys.items.map((k) => `${k.number}${k.gender}`);
    await releaseLockerKeys(codes);
  }

  return updated;
}

/**
 * Imprime comprobante POS (solo cliente + cargos sin llaves + subtotal/total)
 */
export function printAccountReceipt(accountId: string) {
  if (isSSR()) return;

  const s = load();
  const acc = s.accounts.find((a) => a.id === accountId);
  if (!acc) {
    alert("Cuenta no encontrada para imprimir.");
    return;
  }

  const charges = s.chargesByAccount[accountId] ?? [];
  const payments = s.paymentsByAccount[accountId] ?? [];

  // ✅ quitar llaves del recibo
  const printableCharges = charges.filter((c) => c.kind !== "Key");

  // ✅ subtotal = cargos sin llaves
  const subtotal = printableCharges.reduce((ac, c) => ac + c.total, 0);

  // ✅ total = pagos consolidados (sin detallar método)
  const total = payments.reduce((ac, p) => ac + p.amount, 0);

  const win = window.open("", "_blank", "width=320,height=600");
  if (!win) return;

  function cleanConcept(v: string) {
    return String(v ?? "")
      .replace(/^bar:\s*/i, "") // quita "Bar: "
      .replace(/\s*\(\s*[AN]\s*\)\s*$/i, "") // quita "(A)" o "(N)" al final
      .trim();
  }

  const chargesRows = printableCharges
    .map(
      (c) => `
      <tr>
        <td class="concept">${escapeHtml(cleanConcept(c.concept))}</td>
        <td class="right">${c.qty}</td>
        <td class="right">$${c.total.toFixed(2)}</td>
      </tr>`
    )
    .join("");

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Comprobante</title>
  <style>
    @page { margin: 8mm; }
    html, body { margin:0; padding:0; background:#fff; color:#111; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; font-size: 11px; }
    .ticket { width: 320px; margin: 0 auto; }
    .center { text-align: center; }
    .right { text-align: right; }
    .muted { color:#555; }
    .bold { font-weight: 700; }
    .line { border-top: 1px dashed #111; margin: 8px 0; }
    .block { margin: 6px 0; }
    .logo { display:block; margin: 0 auto 6px auto; width: 210px; max-width: 100%; }
    .title { font-size: 14px; font-weight: 800; letter-spacing: .4px; }
    .subtitle { font-size: 11px; }
    .meta { margin-top: 6px; }
    .row { display:flex; gap:10px; justify-content: space-between; }
    .row > div:first-child { color:#333; }
    table { width:100%; border-collapse: collapse; }
    th, td { padding: 3px 0; vertical-align: top; }
    thead th { font-size: 10px; color:#444; font-weight: 700; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    tbody td { font-size: 11px; }
    .col-cant { width: 44px; }
    .col-total { width: 70px; }
    .concept { padding-right: 6px; }
    .totals .row { margin: 2px 0; }
    .grand { font-size: 12px; }
    .footer { margin-top: 10px; }
    .small { font-size: 10px; }
    @media print { .no-print { display:none; } }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <img class="logo" src="/logo-zero-stress.png" alt="Piscina Zero Stress" />
      <div class="title">PISCINA ZERO STRESS</div>
      <div class="subtitle muted">Comprobante de consumo</div>
    </div>

    <div class="line"></div>

    <div class="meta">
      <div class="row"><div>Cliente:</div><div class="bold">${escapeHtml(acc.clientName)}</div></div>
    </div>

    <div class="line"></div>

    <table>
      <thead>
        <tr>
          <th>Concepto</th>
          <th class="right col-cant">Cant</th>
          <th class="right col-total">Total</th>
        </tr>
      </thead>
      <tbody>
        ${printableCharges.length ? chargesRows : `<tr><td colspan="3" class="muted">Sin cargos</td></tr>`}
      </tbody>
    </table>

    <div class="line"></div>

    <div class="totals">
      <div class="row grand"><div class="bold">Total:</div><div class="bold">$${total.toFixed(2)}</div></div>
    </div>

    <div class="line"></div>

    <div class="center footer">
      <div class="bold">¡Gracias por su visita!</div>
      <div class="small muted">Conserve este comprobante</div>
    </div>

    <div class="no-print small muted center" style="margin-top:10px;">
      Si no se abre impresión automática, presione Ctrl+P
    </div>
  </div>

  <script>
    (function(){
      const img = document.querySelector('img.logo');
      let done = false;
      function go(){
        if (done) return;
        done = true;
        setTimeout(() => { window.print(); }, 50);
        window.onafterprint = function(){ window.close(); };
      }
      if (!img) return go();
      if (img.complete) return go();
      img.onload = go;
      img.onerror = go;
      setTimeout(go, 700);
    })();
  </script>
</body>
</html>
  `;

  win.document.open();
  win.document.write(html);
  win.document.close();

  function escapeHtml(v: string) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

/* ------------------ PASES (mock local) ------------------ */
export async function findPassByHolder(holderName: string) {
  const s = load();
  const rec = s.passesByHolder[normName(holderName)];
  return rec ?? null;
}

export async function createPassForHolder(holderName: string) {
  const s = load();
  const key = normName(holderName);
  const existing = s.passesByHolder[key];
  if (existing?.active) return existing;

  const rec: PassRecord = {
    id: uid("pass"),
    holderName,
    remaining: 10,
    active: true,
  };
  s.passesByHolder[key] = rec;
  save(s);
  return rec;
}

export async function consumePass(holderName: string, uses: number) {
  const s = load();
  const key = normName(holderName);
  const rec = s.passesByHolder[key];
  if (!rec || !rec.active) throw new Error("Pase no encontrado o inactivo.");
  if (rec.remaining < uses) throw new Error("Pase sin usos suficientes.");
  rec.remaining -= uses;
  save(s);
  return rec.remaining;
}

/* ------------------ Abrir cuenta ------------------ */
export async function openAccount(input: {
  clientId: string;
  clientName: string;
  gender: "M" | "F";
  entryType: PosEntryType;
  counts?: { A: number; N: number; TE: number; D: number; AC: number };
  peopleCount: number;
  keys?: { items: SelectedKey[]; duration: "1H" | "8H" | "2M" };
  createPassIfMissing?: boolean;
  requiresParking?: boolean;
}) {
  const s = load();
  const id = nextAccountId(s.accounts);

  const account: PosAccount = {
    id,
    status: "Abierta",
    openedAt: nowISO(),
    closedAt: null,
    clientId: input.clientId,
    clientName: input.clientName,
    gender: input.gender,
    keys: input.keys,
    entryType: input.entryType,
    requiresParking: input.requiresParking ?? false,

    // ✅ GUARDA PERSONAS (esto arregla Dashboard)
    peopleCount: safeNum(input.peopleCount),
    counts: input.counts,
  };

  s.accounts = [account, ...s.accounts];

  const charges: Charge[] = [];

  if (input.entryType === "normal" && input.counts) {
    addChargeIf(charges, "Normal", "Adulto (A)", input.counts.A, PRICES.A);
    addChargeIf(charges, "Normal", "Niño (N)", input.counts.N, PRICES.N);
    addChargeIf(charges, "Normal", "Tercera edad (TE)", input.counts.TE, PRICES.TE);
    addChargeIf(charges, "Normal", "Discapacidad (D)", input.counts.D, PRICES.D);
    addChargeIf(charges, "Normal", "Acompañante (AC)", input.counts.AC, PRICES.AC);
  }

  if (input.entryType === "pass") {
    const found = await findPassByHolder(input.clientName);
    if (!found) {
      if (input.createPassIfMissing) {
        await createPassForHolder(input.clientName);
        addChargeIf(charges, "Pase", "Tarjeta 10 pases", 1, PRICES.PASS);
      } else {
        throw new Error("No existe pase para este titular.");
      }
    }
  }

  if (input.keys?.items?.length) {
    const dur = input.keys.duration;
    const tag = input.keys.items.map((k) => `${k.number}${k.gender}`).join(", ");
    const price = dur === "1H" ? PRICES.KEY_1H : dur === "8H" ? PRICES.KEY_8H : PRICES.KEY_2M;
    addChargeIf(charges, "Key", `Llaves ${tag} (${dur})`, 1, price);
  }

  s.chargesByAccount[id] = [...(s.chargesByAccount[id] ?? []), ...charges];
  save(s);
  return account;
}

/* ---------- helpers ---------- */
function addChargeIf(list: Charge[], kind: Charge["kind"], label: string, qty: number, price: number) {
  if (!qty) return;
  list.push({
    id: uid("ch"),
    kind,
    concept: label,
    qty,
    amount: price,
    total: +(qty * price).toFixed(2),
    status: "Pendiente",
    createdAt: nowISO(),
  });
}

function nextAccountId(existing: PosAccount[]) {
  const nums = existing.map((a) => parseInt(a.id, 10)).filter((n) => !Number.isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return next.toString().padStart(3, "0");
}
