import { useId, useState } from "react";
import { Download, FileSpreadsheet, Upload, CheckCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import "../styles/AcademicWorkspace.css";

export default function AcademicCsvImport({ onImported, disabled = false }) {
  const { apiFetch } = useAuth();
  const fileInputId = useId();
  const [file, setFile] = useState(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [processing, setBusy] = useState(false);
  const busy = processing || disabled;
  const [section, setSection] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const downloadTemplate = async (sample = false) => {
    setError("");
    try {
      const response = await apiFetch("/api/professor/academic-imports/template" + (sample ? '?sample=true' : ''));
      if (!response.ok) throw new Error((await response.json()).message);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = sample ? 'retainify-academic-sample.csv' : 'retainify-academic-template.csv';
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
      const params = new URLSearchParams({ reason, section, allowPartial: String(allowPartial) });
      const response = await apiFetch("/api/professor/academic-imports/preview?" + params, {
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
      onImported?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="academic-panel academic-import" aria-labelledby={`${fileInputId}-heading`} aria-busy={processing}>
      <div className="academic-panel-heading">
        <div>
          <span className="dashboard-eyebrow">Academic Records</span>
          <h2 id={`${fileInputId}-heading`}>Upload Student Records</h2>
        </div>
        <div className="academic-template-actions">
          <button type="button" className="connection-button" onClick={() => downloadTemplate()} disabled={busy}><Download size={15} aria-hidden="true" /> Download CSV Template</button>
          <button type="button" className="connection-button" onClick={() => downloadTemplate(true)} disabled={busy}><FileSpreadsheet size={15} aria-hidden="true" /> Download Sample CSV</button>
        </div>
      </div>
      <p className="academic-panel-subtitle">Add your class records for one source semester. Review the preview before publishing any changes.</p>

      <details className="academic-upload-format">
        <summary>CSV requirements and upload instructions</summary>
        <div className="academic-upload-format-content">
          <p><strong>File:</strong> One source semester per file, up to 500 students and 1 MB.</p>
          <p><strong>Requirement:</strong> Each student must have an accepted connection and designated you as the provider for that period.</p>
          <p><strong>CSV Column Headers:</strong> studentEmail, academicYear, semester, previousSemesterGrade, gradeMaximum, previousSemesterUnitsEnrolled, previousSemesterUnitsApproved, attendance</p>
          <p><strong>CSV Values:</strong> studentEmail must match the student's email; academicYear in YYYY-YYYY format; semester must be 1 or 2; previousSemesterGrade and gradeMaximum numeric (scales: 4, 5, 20, or 100); attendance must be &quot;day&quot; or &quot;night&quot;.</p>
          <p><strong>Class forecasts:</strong> After confirming the import, run attrition forecasts for the class below. Each student must also have complete personal information; grades alone are insufficient.</p>
          <p><strong>Sample CSV:</strong> Replace the example emails, academic period, and academic values with your actual connected students' records before uploading.</p>
        </div>
      </details>

      <form className="academic-csv-upload-form" onSubmit={upload}>
        <div className="academic-form-group academic-import-file">
          <label htmlFor={fileInputId}>Student Records CSV</label>
          <div className={`academic-upload-card ${file ? 'has-file' : ''}`}>
            <span className="academic-upload-icon" aria-hidden="true"><FileSpreadsheet size={23} /></span>
            <div className="academic-upload-description">
              <strong title={file?.name} aria-live="polite">{file?.name || "Choose your class records"}</strong>
              <span id={`${fileInputId}-help`}>{file ? `${(file.size / 1024).toFixed(1)} KB · Ready to validate` : "UTF-8 CSV · Up to 500 students · Maximum 1 MB"}</span>
            </div>
            <div className="academic-file-control">
              <input id={fileInputId} className="academic-file-input" type="file" accept=".csv,text/csv" required disabled={busy}
                aria-label="Student records CSV" aria-describedby={`${fileInputId}-help`}
                onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); }} />
              <label className="academic-file-picker-button" htmlFor={fileInputId}><Upload size={15} aria-hidden="true" /> {file ? "Change file" : "Choose file"}</label>
            </div>
          </div>
        </div>
        <div className="academic-form-group academic-import-section">
          <label htmlFor={`${fileInputId}-section`}>Section / Block <span className="academic-field-optional">Optional</span></label>
          <input id={`${fileInputId}-section`} className="academic-input" value={section} maxLength={80} disabled={busy}
            onChange={event => { setSection(event.target.value); setPreview(null); }} placeholder="e.g. BSIT 3-3" />
          <small className="academic-field-help">Use a class label to find this import later.</small>
        </div>
        <div className="academic-form-group">
          <label htmlFor={`${fileInputId}-reason`}>Correction Reason</label>
          <input
            id={`${fileInputId}-reason`}
            className="academic-input"
            value={reason}
            maxLength={500}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
              setPreview(null);
            }}
            placeholder="e.g. Updated approved units after grade review"
          />
          <small className="academic-field-help">Required when correcting a record; optional for new records.</small>
        </div>
        <div className="academic-import-policy">
          <label className="academic-import-options">
            <input type="checkbox" checked={allowPartial} disabled={busy}
              onChange={event => { setAllowPartial(event.target.checked); setPreview(null); }} />
            <span><strong>Skip invalid rows</strong><small>Import eligible records only. Review skipped students before confirming.</small></span>
          </label>
        </div>
        <div className="academic-submit-row">
          <p>Validation creates a preview. Records are saved after you confirm.</p>
          <button type="submit" className="dashboard-action" disabled={busy || !file}><CheckCheck size={16} aria-hidden="true" />
            {busy ? "Processing..." : "Validate and preview"}
          </button>
        </div>
      </form>

      {error && <p role="alert" className="academic-notice academic-notice--error">{error}</p>}
      {result && (
        <p role="status" className="academic-notice">
          {result.message} New: {result.created}; corrected: {result.corrected}; unchanged: {result.unchanged}; skipped: {result.skipped || 0}.
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
                        <ul className="academic-preview-errors">
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

          {preview.canConfirm && (
            <div className="academic-submit-row">
              <p>
                Preview expires {new Date(preview.expiresAt).toLocaleTimeString()}. Confirm {preview.eligibleCount} eligible records; skip {preview.skippedCount} invalid rows.
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
