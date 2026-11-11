import { useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling";
import "../styles/AcademicWorkspace.css";

export const READINESS_MESSAGES = {
  no_connection: "Connect with a professor at your institution and wait for acceptance.",
  choose_provider: "Choose a connected professor to provide your record for the source semester.",
  provider_disconnected: "Your academic provider is no longer connected. Reconnect before running a forecast.",
  awaiting_upload: "Awaiting your professor's CSV upload for this semester.",
  profile_incomplete: "Complete your personal information below to enable forecasting.",
  ready: "Your academic record and personal information are ready for forecasting.",
};
const FIELDS = [
  ["educationalSpecialNeeds", "Educational support needs"],
  ["tuitionFeeStatus", "Tuition fees up to date"],
  ["scholarshipStatus", "Active scholarship"],
];
const emptyProfile = { educationalSpecialNeeds: "", tuitionFeeStatus: "", scholarshipStatus: "" };
const asForm = profile => Object.fromEntries(FIELDS.map(([key]) => [key, typeof profile?.[key] === "boolean" ? String(profile[key]) : ""]));

export default function StudentDataForm({ onSaveRecord }) {
  const { apiFetch } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [form, setForm] = useState(emptyProfile);
  const [period, setPeriod] = useState({ academicYear: "", semester: "1", professorId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = useRef(false);
  const ingest = data => {
    setWorkspace(data);
    if (!dirty.current) setForm(asForm(data.profile));
    onSaveRecord?.(data.record || null, data);
  };
  useAdaptivePolling(async () => {
    try {
      const response = await apiFetch("/api/students/me");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load your workspace.");
      ingest(data);
    } catch (err) { setError(err.message); }
  }, { intervalMs: 15000 });
  const saveProfile = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/api/students/me", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(FIELDS.map(([key]) => [key, form[key] === "true"]))) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not save your information.");
      dirty.current = false; ingest(data); setMessage(data.message);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const designate = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/api/students/me/academic-provider", { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...period, semester: Number(period.semester) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not designate your professor.");
      ingest(data); setMessage(data.message);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  if (!workspace) return <p role="status">{error || "Loading your workspace..."}</p>;
  const academic = workspace.academic;
  const record = workspace.record;
  return <div className="academic-workspace">
    {error && <p className="academic-notice academic-notice--error" role="alert">{error}</p>}
    {message && <p className="academic-notice" role="status">{message}</p>}
    <section className="academic-panel">
      <div className="academic-panel-heading"><div><p className="dashboard-eyebrow">Professor-managed</p><h3>Your academic record</h3></div><span className="academic-source-badge">{record ? "Professor CSV" : "Awaiting record"}</span></div>
      <p role="status">{READINESS_MESSAGES[workspace.readiness]}</p>
      {academic && <p className="academic-provenance">Source semester: <strong>{academic.academicYear}, semester {academic.semester}</strong><br />Academic provider: {academic.provider?.fullName || "Unavailable"}
        {academic.uploadedAt && <><br />Uploaded by {academic.uploadedBy?.fullName || "your professor"} on {new Date(academic.uploadedAt).toLocaleString()} · Version {academic.academicVersion}</>}</p>}
      {record && <dl className="academic-values">
        <div><dt>Previous semester GWA / grade</dt><dd>{record.previousSemesterGrade} / {record.gradeMaximum}</dd></div>
        <div><dt>Enrolled units</dt><dd>{record.previousSemesterUnitsEnrolled}</dd></div>
        <div><dt>Approved units</dt><dd>{record.previousSemesterUnitsApproved}</dd></div>
        <div><dt>Study schedule</dt><dd>{record.attendance === "day" ? "Daytime" : "Evening"}</dd></div>
      </dl>}
      <p className="academic-help">Your professor supplies academic information through CSV. For corrections, contact your academic provider through Messages.</p>
      {workspace.hasOutdatedForecast && <p className="academic-notice">Your previous forecast is historical. Run a new forecast after your record is ready.</p>}
      {workspace.legacyRecord && <details><summary>Previous self-reported record</summary><p>This legacy record is historical and cannot be used for new forecasts: {workspace.legacyRecord.previousSemesterGrade} / {workspace.legacyRecord.gradeMaximum}. Ask your professor to upload the authoritative record.</p></details>}
    </section>
    <section className="academic-panel">
      <h3>Academic-record provider</h3>
      <p>Select the source semester your professor will upload. This does not let you edit academic values. A published period's provider can only be changed through a professor-to-professor transfer.</p>
      {workspace.providers.length > 0 ? <form className="academic-form" onSubmit={designate}>
        <label>Source academic year<input required pattern="[0-9]{4}-[0-9]{4}" placeholder="2025-2026" value={period.academicYear} onChange={event => setPeriod({ ...period, academicYear: event.target.value })} /></label>
        <label>Source semester<select value={period.semester} onChange={event => setPeriod({ ...period, semester: event.target.value })}><option value="1">Semester 1</option><option value="2">Semester 2</option></select></label>
        <label>Connected professor<select required value={period.professorId} onChange={event => setPeriod({ ...period, professorId: event.target.value })}><option value="">Choose a professor</option>{workspace.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.fullName}</option>)}</select></label>
        <button className="dashboard-action" disabled={busy}>Designate provider</button>
      </form> : <p>Open Connections to connect with a professor first.</p>}
      {workspace.academicPeriods.length > 0 && <p className="academic-help">Records: {workspace.academicPeriods.map(item => item.academicYear + " semester " + item.semester + " (" + item.status.replace("_", " ") + ")").join("; ")}. Your latest source semester is used for forecasting.</p>}
    </section>
    <section className="academic-panel">
      <h3>Your personal information</h3><p>You can save this information while waiting for your professor's upload.</p>
      <form className="academic-form" onSubmit={saveProfile}>{FIELDS.map(([key, label]) => <label key={key}>{label}<select required disabled={busy} value={form[key]} onChange={event => { dirty.current = true; setForm({ ...form, [key]: event.target.value }); }}><option value="">Select an answer</option><option value="true">Yes</option><option value="false">No</option></select></label>)}
        <button className="dashboard-action" disabled={busy}>{busy ? "Saving..." : "Save personal information"}</button>
      </form>
    </section>
  </div>;
}
