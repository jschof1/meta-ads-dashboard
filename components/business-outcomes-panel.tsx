"use client";
import { useEffect, useState } from "react";
import { summarizeLeadRegisterOutcomes, type LeadRegister, type LeadRegisterOutcomes } from "@/lib/lead-register";
export function BusinessOutcomesPanel() {
  const [data, setData] = useState<LeadRegisterOutcomes | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/lead-register", { signal: controller.signal, cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error("unavailable");
      const result = await r.json() as { data?: LeadRegister | null }; if (!result.data) throw new Error("unavailable"); setData(summarizeLeadRegisterOutcomes(result.data)); setError(false);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [reload]);
  return <section className="mb-6 rounded-xl border p-5" aria-label="HighLevel contact outcomes">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">HighLevel contact outcomes</h2><button className="text-sm underline" onClick={() => setReload(r => r + 1)}>Refresh outcomes</button></div>
    <p className="mt-1 text-sm text-muted-foreground">Last 30 days. These figures use the actual UKTL process: contact creation, the <code>contacted</code> tag and the sales calendar. They stay separate from Meta Lead events, which can include repeat submissions by one person.</p>
    {error && <p role="alert" className="mt-3 text-sm">Could not refresh outcomes. {data ? "The previous result remains below; check its timestamp." : "Refresh to retry."}</p>}
    {!data && !error && <p className="mt-3 text-sm">Reading contacts, calendar and payments…</p>}
    {data && <><div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">{[["People enquiring",data.peopleEnquiring],["Tagged contacted",data.contactedNewContacts],["Booked people",data.uniqueBookers],["Booked appointments",data.appointments],["No shows",data.noShows]].map(([label,value]) => <div key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>
    <p className="mt-4 text-sm">{data.formSubmissions} form submissions from {data.peopleEnquiring} people. {data.contactsCreated} new CRM contacts were created in the same window.</p>
    <p className="mt-4 text-sm">Among {data.metaSourcedContacts} new CRM contacts carrying a Facebook/Instagram source: {data.metaContactsBooked} booked in this period and {data.metaContactsContacted} are tagged contacted, meaning sales contact happened.</p>
    <p className="mt-3 text-xs text-muted-foreground">Appointments use their scheduled date. A confirmed booking or contacted tag does not prove attendance; only an explicit <code>No Show</code> calendar status proves non-attendance. Qualification, ROAS and client receipts are kept out of this outcome view because they are not consistently matched to these people.</p>
    <p className="mt-2 text-xs text-muted-foreground">Saved at {new Date(data.checkedAt).toLocaleString("en-GB")} · this preserves the most recent complete HighLevel read if a live provider call is slow.</p></>}
  </section>;
}
