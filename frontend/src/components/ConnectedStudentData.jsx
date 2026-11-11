import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling";
import { READINESS_MESSAGES } from "../pages/StudentDataForm";
import "../styles/AcademicWorkspace.css";

function ProviderTransfer({ item, onChanged }) {
  const { apiFetch, user } = useAuth();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const academic = item.academic;
  if (!academic) return null;
  const isOwner = String(academic.provider?._id) === String(user.id || user._id);
  const isRecipient = String(academic.pendingProvider?._id) === String(user.id || user._id);
  if (!isOwner && !isRecipient) return null;
  const transfer = async action => {
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch("/api/professor/academic-records/" + academic.academicRecordId + "/transfer",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, professorId: target }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Transfer failed.");
      setMessage(data.message); onChanged();
    } catch (err) { setMessage(err.message); } finally { setBusy(false); }
  };
  return <div className="academic-transfer">
    {academic.pendingProvider && <p>Transfer offered to {academic.pendingProvider.fullName}.</p>}
    {isRecipient && <button type="button" className="connection-button" disabled={busy} onClick={() => transfer("accept")}>Accept academic provider transfer</button>}
    {isOwner && <div className="academic-form"><label>Transfer to another connected professor<select value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose professor</option>{item.providers.filter(provider => provider.id !== String(academic.provider?._id)).map(provider => <option key={provider.id} value={provider.id}>{provider.fullName}</option>)}</select></label>
      <button type="button" className="connection-button" disabled={busy || !target} onClick={() => transfer("request")}>Offer transfer</button>
      {academic.pendingProvider && <button type="button" className="connection-button" disabled={busy} onClick={() => transfer("cancel")}>Cancel offer</button>}
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}

export default function ConnectedStudentData() {
  const { apiFetch } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    try {
      const response = await apiFetch("/api/professor/students");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load student records.");
      setStudents(data.students || []); setError("");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useAdaptivePolling(refresh, { intervalMs: 15000 });
  if (loading) return <p>Loading connected student records...</p>;
  return <section className="connected-students"><h3>Connected student records</h3>
    <p>Professor-uploaded records improve traceability. Review the source for accuracy and use forecasts to guide supportive conversations.</p>
    {error && <p role="alert">{error}</p>}
    {!students.length && <p>No connected students yet. Accept requests in Connections first.</p>}
    <div className="academic-workspace">{students.map(item => <article className="academic-panel" key={item.student.id}>
      <div className="academic-panel-heading"><h3>{item.student.fullName}</h3><span className="academic-source-badge">{item.record ? "Professor CSV" : "Awaiting record"}</span></div>
      <p>{item.student.email}</p><p>{READINESS_MESSAGES[item.readiness]}</p>
      {item.academic && <p className="academic-provenance">Source: {item.academic.academicYear}, semester {item.academic.semester} · Provider: {item.academic.provider?.fullName || "Unavailable"} · Version {item.academic.academicVersion}</p>}
      {item.record && <dl className="academic-values">
        <div><dt>Previous grade</dt><dd>{item.record.previousSemesterGrade} / {item.record.gradeMaximum}</dd></div>
        <div><dt>Approved / enrolled units</dt><dd>{item.record.previousSemesterUnitsApproved} / {item.record.previousSemesterUnitsEnrolled}</dd></div>
        <div><dt>Schedule</dt><dd>{item.record.attendance === "day" ? "Daytime" : "Evening"}</dd></div>
      </dl>}
      {item.forecast ? <p>Current forecast: <strong>{item.forecast.predictedNextSemesterGrade} / {item.forecast.gradeMaximum}</strong>; {Math.round(item.forecast.dropoutProbability * 100)}% estimated dropout probability.</p> : <p>{item.hasOutdatedForecast ? "Previous forecast is historical. The student must run a fresh forecast." : "No current student forecast."}</p>}
      <ProviderTransfer item={item} onChanged={refresh} />
    </article>)}</div>
  </section>;
}
