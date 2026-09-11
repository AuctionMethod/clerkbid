"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { useUserDb } from "@/components/providers/UserDbProvider";
import { useCurrentEvent } from "@/lib/hooks/useCurrentEvent";
import { useToast } from "@/components/providers/ToastProvider";
import { liveQueryGuard } from "@/lib/dexie/liveQueryGuard";
import { downloadCsv } from "@/lib/services/csvExporter";
import {
  filterMasterBidders,
  filterMasterConsignors,
  inCurrentEventOnly,
  searchMasterBidders,
  searchMasterConsignors,
  type DirectoryBidderFilter,
  type DirectoryConsignorFilter,
} from "@/lib/directory/search";
import { MasterBidderForm } from "@/components/directory/MasterBidderForm";
import { MasterConsignorForm } from "@/components/directory/MasterConsignorForm";
import { ResaleFlag } from "@/components/invoices/ResaleFlag";
import type { MasterBidder, MasterConsignor } from "@/lib/db";

type Tab = "bidders" | "consignors";

export default function DirectoryPage() {
  const { db, ready } = useUserDb();
  const { currentEventId, currentEvent } = useCurrentEvent();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("bidders");
  const [search, setSearch] = useState("");
  const [bidderFilter, setBidderFilter] = useState<DirectoryBidderFilter>("all");
  const [consignorFilter, setConsignorFilter] =
    useState<DirectoryConsignorFilter>("all");
  const [inEventOnly, setInEventOnly] = useState(false);
  const [bidderFormOpen, setBidderFormOpen] = useState(false);
  const [editingBidder, setEditingBidder] = useState<MasterBidder | null>(null);
  const [consignorFormOpen, setConsignorFormOpen] = useState(false);
  const [editingConsignor, setEditingConsignor] =
    useState<MasterConsignor | null>(null);

  const masters = useLiveQuery(
    async () =>
      liveQueryGuard(
        "directory.masters",
        async () => {
          if (!ready || !db) {
            return { bidders: [] as MasterBidder[], consignors: [] as MasterConsignor[] };
          }
          const [bidders, consignors] = await Promise.all([
            db.masterBidders.toArray(),
            db.masterConsignors.toArray(),
          ]);
          bidders.sort((a, b) =>
            `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
          );
          consignors.sort((a, b) => a.name.localeCompare(b.name));
          return { bidders, consignors };
        },
        { bidders: [], consignors: [] }
      ),
    [ready, db]
  );

  const eventLinks = useLiveQuery(
    async () =>
      liveQueryGuard(
        "directory.eventLinks",
        async () => {
          if (!ready || !db || currentEventId == null) {
            return { bidderKeys: [] as string[], consignorKeys: [] as string[] };
          }
          const [bidders, consignors] = await Promise.all([
            db.bidders.where("eventId").equals(currentEventId).toArray(),
            db.consignors.where("eventId").equals(currentEventId).toArray(),
          ]);
          return {
            bidderKeys: bidders
              .map((b) => b.masterSyncKey)
              .filter((k): k is string => Boolean(k)),
            consignorKeys: consignors
              .map((c) => c.masterSyncKey)
              .filter((k): k is string => Boolean(k)),
          };
        },
        { bidderKeys: [], consignorKeys: [] }
      ),
    [ready, db, currentEventId]
  );

  const bidderKeys = useMemo(
    () => new Set(eventLinks?.bidderKeys ?? []),
    [eventLinks]
  );
  const consignorKeys = useMemo(
    () => new Set(eventLinks?.consignorKeys ?? []),
    [eventLinks]
  );

  const bidderRows = useMemo(() => {
    let rows = searchMasterBidders(masters?.bidders ?? [], search);
    rows = filterMasterBidders(rows, bidderFilter);
    rows = inCurrentEventOnly(rows, bidderKeys, inEventOnly);
    return rows;
  }, [masters, search, bidderFilter, inEventOnly, bidderKeys]);

  const consignorRows = useMemo(() => {
    let rows = searchMasterConsignors(masters?.consignors ?? [], search);
    rows = filterMasterConsignors(rows, consignorFilter);
    rows = inCurrentEventOnly(rows, consignorKeys, inEventOnly);
    return rows;
  }, [masters, search, consignorFilter, inEventOnly, consignorKeys]);

  function exportBidders() {
    downloadCsv(
      "clerkbid-master-bidders.csv",
      [
        "firstName",
        "lastName",
        "email",
        "phone",
        "mailingAddress",
        "resaleNumber",
      ],
      bidderRows.map((b) => [
        b.firstName,
        b.lastName,
        b.email ?? "",
        b.phone ?? "",
        b.mailingAddress ?? "",
        b.resaleNumber ?? "",
      ])
    );
  }

  function exportConsignors() {
    downloadCsv(
      "clerkbid-master-consignors.csv",
      ["name", "email", "phone", "mailingAddress", "notes", "commission"],
      consignorRows.map((c) => [
        c.name,
        c.email ?? "",
        c.phone ?? "",
        c.mailingAddress ?? "",
        c.notes ?? "",
        c.commissionRate != null
          ? String(Math.round(c.commissionRate * 10000) / 100)
          : "",
      ])
    );
  }

  return (
    <div>
      <Header
        title="Directory"
        description="Master bidders and consignors across all events. Lookup from an event to assign a paddle or consignor number."
        actions={
          tab === "bidders" ? (
            <>
              <Button variant="secondary" type="button" onClick={exportBidders}>
                Export CSV
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setEditingBidder(null);
                  setBidderFormOpen(true);
                }}
              >
                Add bidder
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" type="button" onClick={exportConsignors}>
                Export CSV
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setEditingConsignor(null);
                  setConsignorFormOpen(true);
                }}
              >
                Add consignor
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={tab === "bidders" ? "primary" : "secondary"}
          type="button"
          onClick={() => {
            setTab("bidders");
            setSearch("");
          }}
        >
          Bidders
        </Button>
        <Button
          variant={tab === "consignors" ? "primary" : "secondary"}
          type="button"
          onClick={() => {
            setTab("consignors");
            setSearch("");
          }}
        >
          Consignors
        </Button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 max-w-md">
          <label htmlFor="directory-search" className="sr-only">
            Search directory
          </label>
          <input
            id="directory-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, or last 4 of phone"
            className="w-full rounded-lg border border-navy/15 bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-navy dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        {tab === "bidders" ? (
          <select
            aria-label="Filter bidders"
            className="rounded-lg border border-navy/15 bg-surface px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            value={bidderFilter}
            onChange={(e) =>
              setBidderFilter(e.target.value as DirectoryBidderFilter)
            }
          >
            <option value="all">All</option>
            <option value="hasResale">Has resale number</option>
            <option value="hasEmail">Has email</option>
          </select>
        ) : (
          <select
            aria-label="Filter consignors"
            className="rounded-lg border border-navy/15 bg-surface px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            value={consignorFilter}
            onChange={(e) =>
              setConsignorFilter(e.target.value as DirectoryConsignorFilter)
            }
          >
            <option value="all">All</option>
            <option value="hasEmail">Has email</option>
            <option value="hasAddress">Has address</option>
          </select>
        )}
        {currentEventId != null ? (
          <label className="flex items-center gap-2 text-sm text-ink dark:text-slate-200">
            <input
              type="checkbox"
              checked={inEventOnly}
              onChange={(e) => setInEventOnly(e.target.checked)}
            />
            On {currentEvent?.name ?? "this event"}
          </label>
        ) : null}
      </div>

      {tab === "bidders" ? (
        <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-navy/10 bg-surface dark:border-slate-700 dark:bg-slate-800/80">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Address</th>
                <th className="px-3 py-2 text-left">Resale</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/10 dark:divide-slate-700">
              {bidderRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted">
                    No master bidders match.
                  </td>
                </tr>
              ) : (
                bidderRows.map((b) => (
                  <tr key={b.syncKey}>
                    <td className="px-3 py-2">
                      {b.lastName}, {b.firstName}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted">
                      {b.phone ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted">{b.email ?? "—"}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-muted" title={b.mailingAddress}>
                      {b.mailingAddress?.trim()
                        ? b.mailingAddress.trim().split(/\r?\n/)[0]
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        <ResaleFlag resaleNumber={b.resaleNumber} />
                        {b.resaleNumber?.trim() ? b.resaleNumber : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        type="button"
                        className="!p-1.5"
                        aria-label={`Edit ${b.firstName} ${b.lastName}`}
                        onClick={() => {
                          setEditingBidder(b);
                          setBidderFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-navy/10 bg-surface dark:border-slate-700 dark:bg-slate-800/80">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Address</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/10 dark:divide-slate-700">
              {consignorRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted">
                    No master consignors match.
                  </td>
                </tr>
              ) : (
                consignorRows.map((c) => (
                  <tr key={c.syncKey}>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-muted">
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted">{c.email ?? "—"}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-muted" title={c.mailingAddress}>
                      {c.mailingAddress?.trim()
                        ? c.mailingAddress.trim().split(/\r?\n/)[0]
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        type="button"
                        className="!p-1.5"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => {
                          setEditingConsignor(c);
                          setConsignorFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <MasterBidderForm
        open={bidderFormOpen}
        editing={editingBidder}
        onClose={() => {
          setBidderFormOpen(false);
          setEditingBidder(null);
        }}
        onSaved={() =>
          showToast({ kind: "success", message: "Master bidder saved." })
        }
      />
      <MasterConsignorForm
        open={consignorFormOpen}
        editing={editingConsignor}
        onClose={() => {
          setConsignorFormOpen(false);
          setEditingConsignor(null);
        }}
        onSaved={() =>
          showToast({ kind: "success", message: "Master consignor saved." })
        }
      />
    </div>
  );
}
