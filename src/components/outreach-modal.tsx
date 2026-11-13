"use client";

import { useState } from "react";
import { Modal, api, btnGhost, btnPrimary, inputCls } from "@/components/records";

export const OUTCOME_OPTIONS = ["Reached - Completed", "Reached - Callback Requested", "Reached - Declined", "No Answer", "Left Voicemail", "Wrong Number", "Disconnected", "Language Barrier"];
const CHANNELS = ["Phone", "SMS", "Email", "Voicemail", "Home Visit", "Mail", "Clinic Visit"];
const NEXT = ["Call Again", "Send Letter", "Schedule Appointment", "Refer to Provider", "Refer to Community Resource", "Close Case", "None"];
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Quick "I called the member" form. Saves an engagement-log entry and updates the case's attempts and engagement status. */
export function OutreachModal({ caseId, caseName, onClose, onSaved }: { caseId: string; caseName: string; onClose: () => void; onSaved: (status: string) => void }) {
  const [f, setF] = useState({ channel: "Phone", outcome: "", nextStep: "", followUpDate: "", notes: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.outcome) return setErr("Choose what happened");
    setBusy(true); setErr("");
    const r = await api<{ engagementStatus: string }>(`/api/cases/${caseId}/outreach`, "POST", f);
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    onSaved(r.data.engagementStatus);
  }

  return (
    <Modal title="Log outreach" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="truncate text-gray-500" title={caseName}>{caseName}</p>
        <div className="grid grid-cols-2 gap-3">
          <label><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">How</span>
            <select className={inputCls} value={f.channel} onChange={(e) => set("channel", e.target.value)}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">What happened *</span>
            <select className={inputCls} value={f.outcome} onChange={(e) => set("outcome", e.target.value)}><option value="">Choose…</option>{OUTCOME_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Next step</span>
            <select className={inputCls} value={f.nextStep} onChange={(e) => set("nextStep", e.target.value)}><option value="">—</option>{NEXT.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Follow up on</span>
            <input type="date" className={inputCls} value={f.followUpDate} min={day(0)} onChange={(e) => set("followUpDate", e.target.value)} /></label>
        </div>
        <div className="flex gap-2 text-xs">
          {[1, 3, 7].map((n) => <button key={n} type="button" className="rounded-full bg-gray-100 px-3 py-1 font-medium hover:bg-gray-200" onClick={() => set("followUpDate", day(n))}>in {n} day{n > 1 ? "s" : ""}</button>)}
        </div>
        <label className="block"><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Notes</span>
          <textarea className={`${inputCls} !h-24 py-2`} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="What was discussed, barriers, what the member needs" /></label>
        {err && <p className="rounded-xl bg-red-50 px-4 py-2 font-medium text-red-600">{err}</p>}
        <div className="flex justify-end gap-2"><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save outreach"}</button></div>
      </div>
    </Modal>
  );
}
