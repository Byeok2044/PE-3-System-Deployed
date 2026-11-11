import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import "../styles/AcademicWorkspace.css";

export default function AcademicCsvImport({ onImported }) {
  const { apiFetch } = useAuth();
  const [file, setFile] = useState(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const downloadTemplate = async () => {
    setError("");
    try {
      const response = await apiFetch("/api/professor/academic-imports/template");
      if (!response.ok) throw new Error((await response.json()).message);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = "retainify-academic-template.csv"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message || "Template download failed."); }
  };
  const upload = async event => {
    event.preventDefault(); setBusy(true); setError(""); setPreview(null); setResult(null);
    try {
      if (!file || file.size > 1024 * 1024) throw new Error("Choose a UTF-8 CSV no larger than 1 MB.");
      const response = await apiFetch("/api/professor/academic-imports/preview?reason=" + encodeURIComponent(reason),
        { method: "POST", headers: { "Content-Type": "text/csv; charset=utf-8" }, body: file });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Preview failed.");
      setPreview(data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/professor/academic-imports/" + preview.batchId + "/confirm", { method: "POST" });
      const data = await response.json();
      if (!response.ok) { if (response.status === 409 || response.status === 403) setPreview(null); throw new Error(data.message || "Import failed."); }
      setResult(data); setPreview(null); onImported?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="academic-panel academic-import">
    <div className="academic-panel-heading"><div><p className="dashboard-eyebrow">Academic records</p><h3>Upload student records</h3></div><button type="button" className="connection-button" onClick={downloadTemplate} disabled={busy}>Download CSV template</button></div>
    <p>Upload one source semester per file, up to 500 students and 1 MB. Each student must have an accepted connection and designate you as the provider for that period.</p>
    <p className="academic-help">Columns: studentEmail, academicYear, semester, previousSemesterGrade, gradeMaximum, previousSemesterUnitsEnrolled, previousSemesterUnitsApproved, attendance. Scales: 4, 5, 20, 100. Schedule: day or night. All grades and units must describe the same source semester.</p>
    <form className="academic-form" onSubmit={upload}>
      <label>Student records CSV<input type="file" accept=".csv,text/csv" required disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); }} /></label>
      <label>Correction reason (required for replacements)<input value={reason} maxLength={500} disabled={busy} onChange={event => { setReason(event.target.value); setPreview(null); }} placeholder="Explain the correction" /></label>
      <button className="dashboard-action" disabled={busy || !file}>{busy ? "Processing..." : "Validate and preview"}</button>
    </form>
    {error && <p role="alert" className="academic-notice academic-notice--error">{error}</p>}
    {result && <p role="status" className="academic-notice">{result.message} New: {result.created}; corrected: {result.corrected}; unchanged: {result.unchanged}.</p>}
    {preview && <div className="academic-preview"><p role="status">{preview.message}</p>
      <div className="academic-table-scroll"><table><caption>Import preview — no records are saved until confirmation</caption><thead><tr><th>Row / student</th><th>Source period</th><th>Existing record</th><th>Proposed record</th><th>Result</th></tr></thead>
        <tbody>{preview.rows.map(row => <tr key={row.rowNumber}><td>{row.rowNumber}: {row.studentName || row.values.studentEmail}</td><td>{row.values.academicYear} · S{row.values.semester}</td>
          <td>{row.before ? row.before.previousSemesterGrade + "/" + row.before.gradeMaximum + "; " + row.before.previousSemesterUnitsApproved + "/" + row.before.previousSemesterUnitsEnrolled + " units; " + row.before.attendance : "No published record"}</td>
          <td>{row.after.previousSemesterGrade}/{row.after.gradeMaximum}; {row.after.previousSemesterUnitsApproved}/{row.after.previousSemesterUnitsEnrolled} units; {row.after.attendance}</td><td><strong>{row.action}</strong>{row.errors.length > 0 && <ul>{row.errors.map((message, i) => <li key={i}>{message}</li>)}</ul>}</td></tr>)}</tbody></table></div>
      {preview.valid && <><p className="academic-help">Preview expires {new Date(preview.expiresAt).toLocaleTimeString()}. Confirmation saves the entire batch. If a record or connection changes, upload again.</p><button type="button" className="dashboard-action" onClick={confirm} disabled={busy}>Confirm import</button></>}
    </div>}
  </section>;
}
