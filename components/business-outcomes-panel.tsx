"use client";
import { useEffect, useState } from "react";
import type { summarizeBusinessOutcomes } from "@/lib/business-outcomes";
type Outcomes = ReturnType<typeof summarizeBusinessOutcomes>;
export function BusinessOutcomesPanel() {
  const [data, setData] = useState<Outcomes | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/business-outcomes", { signal: controller.signal, cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error("unavailable");
      const result = await r.json(); if (result.error) throw new Error("unavailable"); setData(result); setError(false);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [reload]);
  return <section className="mb-6 rounded-xl border p-5" aria-label="HighLevel contact outcomes">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">HighLevel contact outcomes</h2><button className="text-sm underline" onClick={() => setReload(r => r + 1)}>Refresh outcomes</button></div>
    <p className="mt-1 text-sm text-muted-foreground">Last 30 days. These figures use the actual UKTL process: contact creation, the <code>contacted</code> tag and the sales calendar. They stay separate from Meta Lead events, which can include repeat submissions by one person.</p>
    {error && <p role="alert" className="mt-3 text-sm">Could not refresh outcomes. {data ? "The previous result remains below; check its timestamp." : "Refresh to retry."}</p>}
    {!data && !error && <p className="mt-3 text-sm">Reading contacts, calendar and payments…</p>}
    {data && <><div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">{[["New CRM contacts",data.contactsCreated],["Tagged contacted",data.contactedNewContacts],["Booked people",data.uniqueBookers],["Booked appointments",data.appointments],["No shows",data.noShows]].map(([label,value]) => <div key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>
    <p className="mt-4 text-sm">Among {data.metaSourcedContacts} new CRM contacts carrying a Facebook/Instagram source: {data.metaContactsBooked} booked in this period and {data.metaContactsContacted} are tagged contacted, meaning sales contact happened.</p>
    {Object.entries(data.currencyGroups).map(([currency,g]) => <p key={currency} className="mt-3 text-sm"><strong>{new Intl.NumberFormat("en-GB",{style:"currency",currency}).format(g.net)} client receipts after refunds</strong> · {g.payments} successful payments · {new Intl.NumberFormat("en-GB",{style:"currency",currency}).format(g.refunded)} refunded · before fees.</p>)}
    <p className="mt-3 text-xs text-muted-foreground">Payments include existing clients and are not attributed ad revenue. Appointments use their scheduled date. A confirmed booking or contacted tag does not prove attendance; only an explicit <code>No Show</code> calendar status proves non-attendance. Qualification and ROAS remain unavailable because they are not consistently recorded.</p>
    <p className="mt-2 text-xs text-muted-foreground">Read at {new Date(data.checkedAt).toLocaleString("en-GB")} · refreshed on page load or with the button; this view is not a stored daily snapshot.</p></>}
  </section>;
}
