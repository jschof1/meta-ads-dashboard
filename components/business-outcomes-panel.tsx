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
  return <section className="mb-6 rounded-xl border p-5" aria-label="Business outcomes">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Enquiries, bookings and client payments</h2><button className="text-sm underline" onClick={() => setReload(r => r + 1)}>Refresh outcomes</button></div>
    <p className="mt-1 text-sm text-muted-foreground">Last 30 days · read directly from GoHighLevel and its connected Stripe transactions. This window is independent of the ad period selector.</p>
    {error && <p role="alert" className="mt-3 text-sm">Could not refresh outcomes. {data ? "The previous result remains below; check its timestamp." : "Refresh to retry."}</p>}
    {!data && !error && <p className="mt-3 text-sm">Reading contacts, calendar and payments…</p>}
    {data && <><div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">{[["New CRM contacts",data.contactsCreated],["New contacts tagged contacted",data.contactedNewContacts],["Sales appointments",data.appointments],["Unique people booked",data.uniqueBookers]].map(([label,value]) => <div key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>
    <p className="mt-4 text-sm">Among {data.metaSourcedContacts} new contacts with Facebook/Instagram attribution: {data.metaContactsBooked} booked in this period and {data.metaContactsContacted} are tagged contacted.</p>
    {Object.entries(data.currencyGroups).map(([currency,g]) => <p key={currency} className="mt-3 text-sm"><strong>{new Intl.NumberFormat("en-GB",{style:"currency",currency}).format(g.net)} client receipts after refunds</strong> · {g.payments} successful payments · {new Intl.NumberFormat("en-GB",{style:"currency",currency}).format(g.refunded)} refunded · before fees.</p>)}
    <p className="mt-3 text-xs text-muted-foreground">Payments include existing clients and are not attributed ad revenue. Appointments use their scheduled date; cancelled and no-show records remain in the booking total. A confirmed booking or contacted tag does not prove attendance. Qualification and ROAS remain unavailable.</p>
    <p className="mt-2 text-xs text-muted-foreground">Read at {new Date(data.checkedAt).toLocaleString("en-GB")} · refreshed on page load or with the button; this view is not a stored daily snapshot.</p></>}
  </section>;
}
