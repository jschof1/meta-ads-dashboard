import type { LeadEntry, LeadRegister } from "@/lib/lead-register";

export function leadEvidence(entry: LeadEntry, cutoff: number): "form" | "crm-lead" | null {
  if (entry.test) return null;
  if (entry.submissions.some((submission) => Date.parse(submission.at) >= cutoff)) return "form";
  if (Date.parse(entry.contactCreated) >= cutoff && entry.tags.some((tag) => tag.trim().toLowerCase() === "new lead")) return "crm-lead";
  return null;
}

export function leadRegisterChanges(previous: LeadRegister | null, current: LeadRegister) {
  if (!previous) return null;
  const previousSubmissions = new Set(previous.entries.flatMap((entry) => entry.submissions.map((submission) => submission.id)));
  const cutoff = Date.parse(current.checkedAt) - 30 * 86400000;
  const previousLeads = new Set(previous.entries.filter((entry) => leadEvidence(entry, cutoff)).map((entry) => entry.contactId));
  return {
    newFormSubmissions: current.entries.filter((entry) => !entry.test).flatMap((entry) => entry.submissions).filter((submission) => Date.parse(submission.at) >= cutoff && !previousSubmissions.has(submission.id)).length,
    newLeadContacts: current.entries.filter((entry) => leadEvidence(entry, cutoff) && !previousLeads.has(entry.contactId)).length,
  };
}
