import type { AuctionDB, MasterBidder, MasterConsignor } from "@/lib/db";
import { newEntitySyncKey } from "@/lib/utils/clientSyncKey";
import { digitsOnly, normalizeEmail, optTrim } from "@/lib/directory/match";

export type MasterBidderFields = {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  mailingAddress?: string;
  resaleNumber?: string;
};

export type MasterConsignorFields = {
  name: string;
  email?: string;
  phone?: string;
  mailingAddress?: string;
  notes?: string;
  commissionRate?: number;
};

function samePhone(
  a: string | undefined,
  b: string | undefined
): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  return da.length >= 7 && da === db;
}

export async function findMasterBidder(
  db: AuctionDB,
  fields: Pick<MasterBidderFields, "email" | "phone">
): Promise<MasterBidder | undefined> {
  const email = normalizeEmail(fields.email);
  const all = await db.masterBidders.toArray();
  if (email) {
    const byEmail = all.find((m) => normalizeEmail(m.email) === email);
    if (byEmail) return byEmail;
  }
  if (digitsOnly(fields.phone).length >= 7) {
    return all.find((m) => samePhone(m.phone, fields.phone));
  }
  return undefined;
}

export async function findMasterConsignor(
  db: AuctionDB,
  fields: Pick<MasterConsignorFields, "email" | "phone">
): Promise<MasterConsignor | undefined> {
  const email = normalizeEmail(fields.email);
  const all = await db.masterConsignors.toArray();
  if (email) {
    const byEmail = all.find((m) => normalizeEmail(m.email) === email);
    if (byEmail) return byEmail;
  }
  if (digitsOnly(fields.phone).length >= 7) {
    return all.find((m) => samePhone(m.phone, fields.phone));
  }
  return undefined;
}

/** Find or create a master bidder. Does not overwrite existing master fields. */
export async function findOrCreateMasterBidder(
  db: AuctionDB,
  fields: MasterBidderFields,
  now: Date = new Date()
): Promise<MasterBidder> {
  const existing = await findMasterBidder(db, fields);
  if (existing) return existing;
  const row: MasterBidder = {
    syncKey: newEntitySyncKey(),
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    phone: optTrim(fields.phone),
    email: optTrim(fields.email),
    mailingAddress: optTrim(fields.mailingAddress),
    resaleNumber: optTrim(fields.resaleNumber),
    createdAt: now,
    updatedAt: now,
  };
  const id = (await db.masterBidders.add(row)) as number;
  return { ...row, id };
}

export async function findOrCreateMasterConsignor(
  db: AuctionDB,
  fields: MasterConsignorFields,
  now: Date = new Date()
): Promise<MasterConsignor> {
  const existing = await findMasterConsignor(db, fields);
  if (existing) return existing;
  const row: MasterConsignor = {
    syncKey: newEntitySyncKey(),
    name: fields.name.trim(),
    email: optTrim(fields.email),
    phone: optTrim(fields.phone),
    mailingAddress: optTrim(fields.mailingAddress),
    notes: optTrim(fields.notes),
    commissionRate: fields.commissionRate,
    createdAt: now,
    updatedAt: now,
  };
  const id = (await db.masterConsignors.add(row)) as number;
  return { ...row, id };
}

export async function updateMasterBidderFromEvent(
  db: AuctionDB,
  masterSyncKey: string,
  fields: MasterBidderFields,
  now: Date = new Date()
): Promise<boolean> {
  const row = await db.masterBidders.where("syncKey").equals(masterSyncKey).first();
  if (row?.id == null) return false;
  await db.masterBidders.update(row.id, {
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    phone: optTrim(fields.phone),
    email: optTrim(fields.email),
    mailingAddress: optTrim(fields.mailingAddress),
    resaleNumber: optTrim(fields.resaleNumber),
    updatedAt: now,
  });
  return true;
}

export async function updateMasterConsignorFromEvent(
  db: AuctionDB,
  masterSyncKey: string,
  fields: MasterConsignorFields,
  now: Date = new Date()
): Promise<boolean> {
  const row = await db.masterConsignors
    .where("syncKey")
    .equals(masterSyncKey)
    .first();
  if (row?.id == null) return false;
  const patch: Partial<MasterConsignor> = {
    name: fields.name.trim(),
    phone: optTrim(fields.phone),
    email: optTrim(fields.email),
    mailingAddress: optTrim(fields.mailingAddress),
    notes: optTrim(fields.notes),
    updatedAt: now,
  };
  if (fields.commissionRate !== undefined) {
    patch.commissionRate = fields.commissionRate;
  }
  await db.masterConsignors.update(row.id, patch);
  return true;
}

export async function findEventBidderByMaster(
  db: AuctionDB,
  eventId: number,
  masterSyncKey: string
) {
  return db.bidders
    .where("[eventId+masterSyncKey]")
    .equals([eventId, masterSyncKey])
    .first();
}

export async function findEventConsignorByMaster(
  db: AuctionDB,
  eventId: number,
  masterSyncKey: string
) {
  return db.consignors
    .where("[eventId+masterSyncKey]")
    .equals([eventId, masterSyncKey])
    .first();
}

export function masterBidderFieldsDiffer(
  master: MasterBidder,
  fields: MasterBidderFields
): boolean {
  return (
    master.firstName.trim() !== fields.firstName.trim() ||
    master.lastName.trim() !== fields.lastName.trim() ||
    (optTrim(master.phone) ?? "") !== (optTrim(fields.phone) ?? "") ||
    (optTrim(master.email) ?? "") !== (optTrim(fields.email) ?? "") ||
    (optTrim(master.mailingAddress) ?? "") !==
      (optTrim(fields.mailingAddress) ?? "") ||
    (optTrim(master.resaleNumber) ?? "") !== (optTrim(fields.resaleNumber) ?? "")
  );
}

export function masterConsignorFieldsDiffer(
  master: MasterConsignor,
  fields: MasterConsignorFields
): boolean {
  const masterPct = master.commissionRate;
  const fieldPct = fields.commissionRate;
  const commissionDiff =
    masterPct !== fieldPct &&
    !(masterPct == null && fieldPct == null);
  return (
    master.name.trim() !== fields.name.trim() ||
    (optTrim(master.phone) ?? "") !== (optTrim(fields.phone) ?? "") ||
    (optTrim(master.email) ?? "") !== (optTrim(fields.email) ?? "") ||
    (optTrim(master.mailingAddress) ?? "") !==
      (optTrim(fields.mailingAddress) ?? "") ||
    (optTrim(master.notes) ?? "") !== (optTrim(fields.notes) ?? "") ||
    commissionDiff
  );
}
