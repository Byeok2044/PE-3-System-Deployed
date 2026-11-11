import { useId, useState } from "react";
import { useAuth } from "../context/AuthContext";
import "../styles/AcademicWorkspace.css";

export default function AcademicCsvImport({ onImported }) {
  const { apiFetch } = useAuth();
  const fileInputId = useId();
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
      const link = document.createElement("a");
      link.href = url;
      link.download = "retainify-academic-template.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.message || "Template download failed.");
    }
  };

  const upload = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setPreview(null);
    setResult(null);
    try {
      if (!file || file.size > 1024 * 1024) throw new Error("Choose a UTF-8 CSV no larger than 1 MB.");
      const response = await apiFetch("/api/professor/academic-imports/preview?reason=" + encodeURIComponent(reason), {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Preview failed.");
      setPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/professor/academic-imports/" + preview.batchId + "/confirm", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 403) setPreview(null);
        throw new Error(data.message || "Import failed.");
      }
      setResult(data);
      setPreview(null);
      onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="academic-panel academic-import">
      <div className="academic-panel-heading">
        <div>
          <span className="dashboard-eyebrow">Academic Records</span>
          <h2>Upload Student Records</h2>
        </div>
        <button type="button" className="connection-button" onClick={downloadTemplate} disabled={busy}>
          Download CSV Template
        </button>
      </div>

      <details className="academic-upload-format">
        <summary>Student Record CSV Upload Format Instructions</summary>
        <div className="academic-upload-format-content">
          <p><strong>File:</strong> One source semester per file, up to 500 students and 1 MB.</p>
          <p><strong>Requirement:</strong> Each student must have an accepted connection and designated you as the provider for that period.</p>
          <p><strong>CSV Column Headers:</strong> studentEmail, academicYear, semester, previousSemesterGrade, gradeMaximum, previousSemesterUnitsEnrolled, previousSemesterUnitsApproved, attendance</p>
          <p><strong>CSV Values:</strong> studentEmail must match the student's email; academicYear in YYYY-YYYY format; semester must be 1 or 2; previousSemesterGrade and gradeMaximum numeric (scales: 4, 5, 20, or 100); attendance must be &quot;day&quot; or &quot;evening&quot;.</p>
        </div>
      </details>

      <form className="academic-csv-upload-form" onSubmit={upload}>
        {/* Column 1: Custom Uniform File Picker */}
        <div className="academic-form-group">
          <label htmlFor={fileInputId}>Student Records CSV</label>
          <div className="academic-file-picker">
            <input
              id={fileInputId}
              className="academic-file-input"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={busy}
              aria-label="Student records CSV"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setPreview(null);
                setResult(null);
              }}
            />
            <label className="academic-file-picker-button" htmlFor={fileInputId}>
              Choose File
            </label>
            <span className="academic-file-name" aria-live="polite">
              {file?.name || "No File Selected"}
            </span>
          </div>
        </div>

        {/* Column 2: Correction Reason Text Box */}
        <div className="academic-form-group">
          <label>Correction Reason (Optional for initial / required for edits)</label>
          <input
            className="academic-input"
            value={reason}
            maxLength={500}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
              setPreview(null);
            }}
            placeholder="Explain why this record is being uploaded or modified"
          />
        </div>

        {/* Column 3: Aligned Action Button */}
        <button className="dashboard-action" disabled={busy || !file}>
          {busy ? "Processing..." : "Validate and Preview"}
        </button>
      </form>

      {error && <p role="alert" className="academic-notice academic-notice--error">{error}</p>}
      {result && (
        <p role="status" className="academic-notice">
          {result.message} New: {result.created}; corrected: {result.corrected}; unchanged: {result.unchanged}.
        </p>
      )}

      {preview && (
        <div className="academic-preview">
          <p className="academic-panel-subtitle">{preview.message}</p>
          <div className="academic-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row / Student</th>
                  <th>Source Period</th>
                  <th>Existing Record</th>
                  <th>Proposed Record</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td><strong>{row.rowNumber}:</strong> {row.studentName || row.values.studentEmail}</td>
                    <td>{row.values.academicYear} · Semester {row.values.semester}</td>
                    <td>
                      {row.before
                        ? `${row.before.previousSemesterGrade}/${row.before.gradeMaximum}; ${row.before.previousSemesterUnitsApproved}/${row.before.previousSemesterUnitsEnrolled} units; ${row.before.attendance}`
                        : "No published record"}
                    </td>
                    <td>
                      {`${row.after.previousSemesterGrade}/${row.after.gradeMaximum}; ${row.after.previousSemesterUnitsApproved}/${row.after.previousSemesterUnitsEnrolled} units; ${row.after.attendance}`}
                    </td>
                    <td>
                      <span className={`academic-source-badge ${row.errors.length > 0 ? "badge--pending" : "badge--success"}`}>
                        {row.action}
                      </span>
                      {row.errors.length > 0 && (
                        <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1rem", color: "#b91c1c" }}>
                          {row.errors.map((msg, i) => (
                            <li key={i}>{msg}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.valid && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginTop: "0.5rem" }}>
              <p className="academic-panel-subtitle" style={{ margin: 0 }}>
                Preview expires {new Date(preview.expiresAt).toLocaleTimeString()}. Confirmation saves the entire batch.
              </p>
              <button type="button" className="dashboard-action" onClick={confirm} disabled={busy}>
                Confirm Import
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}