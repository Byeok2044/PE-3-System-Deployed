import { useRef, useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling";
import { SOCIOECONOMIC_FIELDS as FIELDS } from "../utils/socioeconomicFactors";
import "../styles/StudentDataForm.css";

export const READINESS_MESSAGES = {
  no_connection: "Connect with a professor at your institution and wait for acceptance.",
  choose_provider: "Choose a connected professor to provide your record for the source semester.",
  provider_disconnected: "Your academic provider is no longer connected. Reconnect before running a forecast.",
  awaiting_upload: "Awaiting your professor's CSV upload for this semester.",
  profile_incomplete: "Complete your personal information below to enable forecasting.",
  ready: "Your academic record and personal information are ready for forecasting.",
};

const emptyProfile = { educationalSpecialNeeds: "", tuitionFeeStatus: "", scholarshipStatus: "" };

const asForm = (profile) =>
  Object.fromEntries(
    FIELDS.map(([key]) => [
      key,
      typeof profile?.[key] === "boolean" ? String(profile[key]) : "",
    ])
  );

export default function StudentDataForm({ onSaveRecord }) {
  const { apiFetch } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [form, setForm] = useState(emptyProfile);
  const [period, setPeriod] = useState({ academicYear: "", semester: "1", professorId: "" });
  const [yearDigits, setYearDigits] = useState(["", "", "", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [generalError, setGeneralError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [providerError, setProviderError] = useState("");
  const [providerMessage, setProviderMessage] = useState("");
  const [isProfPickerOpen, setIsProfPickerOpen] = useState(false);
  const [replacement, setReplacement] = useState(null);
  const [requestToCancel, setRequestToCancel] = useState(null);

  const dirty = useRef(false);
  const mutationRevision = useRef(0);
  const saving = useRef(false);
  const digitInputRefs = useRef([]);
  const pickerRef = useRef(null);
  const providerFormRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsProfPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDigitChange = (index, value) => {
    const char = value.replace(/\D/g, "").slice(-1);
    const updated = [...yearDigits];
    updated[index] = char;
    setYearDigits(updated);

    const firstYear = updated.slice(0, 4).join("");
    const secondYear = updated.slice(4).join("");
    const formatted = firstYear && secondYear ? `${firstYear}-${secondYear}` : `${firstYear}${secondYear}`;
    setPeriod((prev) => ({ ...prev, academicYear: formatted }));

    if (char && index < 7) digitInputRefs.current[index + 1]?.focus();
  };

  const handleDigitKeyDown = (index, event) => {
    if (event.key === "Backspace" && !yearDigits[index] && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (event) => {
    event.preventDefault();
    const paste = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 8);
    if (!paste) return;
    const updated = [...yearDigits];
    paste.split("").forEach((char, i) => { updated[i] = char; });
    setYearDigits(updated);
    const firstYear = updated.slice(0, 4).join("");
    const secondYear = updated.slice(4).join("");
    setPeriod((prev) => ({ ...prev, academicYear: `${firstYear}-${secondYear}` }));
    digitInputRefs.current[Math.min(paste.length, 7)]?.focus();
  };

  const ingest = (data) => {
    setWorkspace(data);
    if (!dirty.current) setForm(asForm(data.profile));
    onSaveRecord?.(data.record || null, data);
  };

  useAdaptivePolling(async () => {
    if (saving.current) return;
    const revision = mutationRevision.current;
    try {
      const response = await apiFetch("/api/students/me");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load your workspace.");
      if (revision === mutationRevision.current && !saving.current) { ingest(data); setGeneralError(""); }
    } catch (err) { if (revision === mutationRevision.current && !saving.current) setGeneralError(err.message); }
  }, { intervalMs: 15000 });

  const saveProfile = async (event) => {
    event.preventDefault();
    if (saving.current) return;
    setBusy(true); saving.current = true; mutationRevision.current++;
    setProfileError(""); setProfileMessage("");
    try {
      const response = await apiFetch("/api/students/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(FIELDS.map(([key]) => [key, form[key] === "true"]))),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not save your information.");
      dirty.current = false; ingest(data); setProfileMessage(data.message);
    } catch (err) { setProfileError(err.message); } finally { setBusy(false); saving.current = false; }
  };

  const resetReplacement = () => {
    setReplacement(null);
    setPeriod({ academicYear: "", semester: "1", professorId: "" });
    setYearDigits(["", "", "", "", "", "", "", ""]);
    setIsProfPickerOpen(false);
  };

  const startReplacement = (request) => {
    setReplacement(request); setRequestToCancel(null); setProviderError(""); setProviderMessage("");
    setPeriod({ academicYear: request.academicYear, semester: String(request.semester), professorId: request.provider?._id || "" });
    setYearDigits(request.academicYear.replace(/\D/g, "").split(""));
    setIsProfPickerOpen(false);
    providerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    digitInputRefs.current[0]?.focus({ preventScroll: true });
  };

  const cancelRequest = async () => {
    if (!requestToCancel || saving.current) return;
    setBusy(true); saving.current = true; mutationRevision.current++;
    setProviderError(""); setProviderMessage("");
    try {
      const response = await apiFetch(`/api/students/me/academic-provider/${requestToCancel.id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: requestToCancel.academicVersion }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not cancel your request.");
      if (replacement?.id === requestToCancel.id) resetReplacement();
      ingest(data); setProviderMessage(data.message); setRequestToCancel(null);
    } catch (err) { setProviderError(err.message); } finally { setBusy(false); saving.current = false; }
  };

  const designate = async (event) => {
    event.preventDefault();
    if (saving.current) return;
    setProviderError("");
    setProviderMessage("");
    if (!period.academicYear || !/^[0-9]{4}-[0-9]{4}$/.test(period.academicYear)) {
      setProviderError("Please complete all 8 digits of the source academic year.");
      return;
    }
    if (!period.professorId) {
      setProviderError("Please select a connected professor.");
      return;
    }
    setBusy(true); saving.current = true; mutationRevision.current++;
    try {
      const response = await apiFetch("/api/students/me/academic-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...period, semester: Number(period.semester),
          ...(replacement ? { replaceRequestId: replacement.id, expectedVersion: replacement.academicVersion } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not designate your professor.");
      ingest(data); setProviderMessage(data.message); resetReplacement();
    } catch (err) { setProviderError(err.message); } finally { setBusy(false); saving.current = false; }
  };

  if (!workspace) return <p role="status">{generalError || "Loading your workspace..."}</p>;

  const academic = workspace.academic;
  const record = workspace.record;
  const pendingRequests = workspace.pendingRequests || [];
  const selectedProfessor = workspace.providers.find((p) => p.id === period.professorId);

  const getInitials = (name) =>
    name ? name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() : "PR";

  return (
    <div className="student-workspace">
      {generalError && <p className="academic-notice academic-notice--error" role="alert">{generalError}</p>}

      {/* 1. Academic Record Panel */}
      <section className="academic-panel">
        <div className="academic-panel-heading">
          <div>
            <span className="dashboard-eyebrow">Professor-managed</span>
            <h2>Your Academic Record</h2>
          </div>
          <span className={`academic-source-badge ${record ? "badge--success" : "badge--pending"}`}>
            {record ? "Record Uploaded" : "Awaiting Record"}
          </span>
        </div>
        <p className="academic-panel-subtitle">{READINESS_MESSAGES[workspace.readiness]}</p>

        <div className="academic-record-grid">
          {academic && (
            <div className="academic-intro-card">
              <div className="academic-intro-icon">
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                </svg>
              </div>
              <div>
                <h4>{academic.academicYear} · Semester {academic.semester}</h4>
                <p>
                  Provider: <strong>{academic.provider?.fullName || "Unavailable"}</strong>
                  {academic.uploadedAt && <> · Uploaded {new Date(academic.uploadedAt).toLocaleDateString()} (v{academic.academicVersion})</>}
                </p>
              </div>
            </div>
          )}

          {record && (
            <dl className="academic-values-grid">
              <div className="metric-tile">
                <dt>Previous GWA / Grade</dt>
                <dd>{record.previousSemesterGrade} / {record.gradeMaximum}</dd>
              </div>
              <div className="metric-tile">
                <dt>Enrolled Units</dt>
                <dd>{record.previousSemesterUnitsEnrolled}</dd>
              </div>
              <div className="metric-tile">
                <dt>Approved Units</dt>
                <dd>{record.previousSemesterUnitsApproved}</dd>
              </div>
              <div className="metric-tile">
                <dt>Schedule</dt>
                <dd>{record.attendance === "day" ? "Daytime" : "Evening"}</dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      {pendingRequests.length > 0 && (
        <section className="academic-panel" aria-labelledby="pending-record-requests-title">
          <div className="academic-panel-heading">
            <div><span className="dashboard-eyebrow">Awaiting professor upload</span><h2 id="pending-record-requests-title">Pending Record Requests</h2></div>
            <span className="academic-source-badge badge--pending">{pendingRequests.length} pending</span>
          </div>
          <p className="academic-panel-subtitle">Cancel a request or replace its academic year, semester, or professor before the record is uploaded.</p>
          <ul className="pending-record-requests">
            {pendingRequests.map((request) => (
              <li key={request.id} className="pending-record-request">
                <div><strong>{request.academicYear} · Semester {request.semester}</strong><p>Provider: {request.provider?.fullName || "Unavailable"}</p></div>
                <div className="pending-request-actions">
                  <button type="button" className="dashboard-action" disabled={busy || workspace.providers.length === 0} onClick={() => startReplacement(request)} aria-label={`Replace request for ${request.academicYear} semester ${request.semester}`}>Replace</button>
                  <button type="button" className="pending-request-secondary" disabled={busy} onClick={() => { setRequestToCancel(request); setProviderError(""); setProviderMessage(""); }} aria-label={`Cancel request for ${request.academicYear} semester ${request.semester}`}>Cancel Request</button>
                </div>
              </li>
            ))}
          </ul>
          {requestToCancel && (
            <div className="pending-request-confirmation" role="group" aria-label="Confirm request cancellation">
              <p>Cancel the request for <strong>{requestToCancel.academicYear} · Semester {requestToCancel.semester}</strong>? Your professor will no longer be able to upload it. You can request it again later.</p>
              <div className="pending-request-actions">
                <button type="button" className="dashboard-action" disabled={busy} onClick={cancelRequest}>{busy ? "Cancelling..." : "Confirm Cancel"}</button>
                <button type="button" className="pending-request-secondary" disabled={busy} onClick={() => setRequestToCancel(null)}>Keep Request</button>
              </div>
            </div>
          )}
        </section>
      )}

      {providerError && (
        <p className="academic-notice academic-notice--error" role="alert">{providerError}</p>
      )}
      {providerMessage && (
        <p className="academic-notice" role="status">{providerMessage}</p>
      )}

      {/* 2. Designate Source Panel */}
      <section className="academic-panel" ref={providerFormRef}>
        <div className="academic-panel-heading">
          <div>
            <span className="dashboard-eyebrow">Configuration</span>
            <h2>{replacement ? "Replace Pending Request" : "Designate Academic Provider"}</h2>
          </div>
        </div>
        <p className="academic-panel-subtitle">
          {replacement
            ? `Replacing ${replacement.academicYear}, Semester ${replacement.semester}. Update the details below and save. Your existing request stays active until the replacement succeeds.`
            : "Select the source semester and designate your connected professor to handle record ingestion."}
        </p>

        {workspace.providers.length > 0 ? (
          <form onSubmit={designate} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <fieldset className="provider-request-fields" disabled={busy}>
            <div className="designate-source-row">
              {/* Segmented PIN Year */}
              <div className="form-group">
                <label>Source Academic Year</label>
                <div className="academic-year-segmented-container" onPaste={handleDigitPaste}>
                  <div className="academic-year-digit-group">
                    {[0, 1, 2, 3].map((i) => (
                      <input
                        key={i}
                        ref={(el) => (digitInputRefs.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        aria-label={`Source academic year digit ${i + 1}`}
                        className="academic-year-digit-input"
                        value={yearDigits[i]}
                        onChange={(e) => handleDigitChange(i, e.target.value)}
                        onKeyDown={(e) => handleDigitKeyDown(i, e)}
                      />
                    ))}
                  </div>
                  <span className="academic-year-divider">—</span>
                  <div className="academic-year-digit-group">
                    {[4, 5, 6, 7].map((i) => (
                      <input
                        key={i}
                        ref={(el) => (digitInputRefs.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        aria-label={`Source academic year digit ${i + 1}`}
                        className="academic-year-digit-input"
                        value={yearDigits[i]}
                        onChange={(e) => handleDigitChange(i, e.target.value)}
                        onKeyDown={(e) => handleDigitKeyDown(i, e)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Semester Pills */}
              <div className="form-group">
                <label>Source Semester</label>
                <div className="segmented-pill-toggle semester-pill-wrapper">
                  <button
                    type="button"
                    className={`segmented-pill-option ${period.semester === "1" ? "active" : ""}`}
                    onClick={() => setPeriod((prev) => ({ ...prev, semester: "1" }))}
                  >
                    Semester 1
                  </button>
                  <button
                    type="button"
                    className={`segmented-pill-option ${period.semester === "2" ? "active" : ""}`}
                    onClick={() => setPeriod((prev) => ({ ...prev, semester: "2" }))}
                  >
                    Semester 2
                  </button>
                </div>
              </div>

              {/* Connected Professor Custom Dropdown */}
              <div className="form-group">
                <label>Connected Professor</label>
                <div className="professor-picker-container" ref={pickerRef}>
                  <button type="button" aria-label="Connected professor" aria-expanded={isProfPickerOpen}
                    className={`professor-picker-trigger ${isProfPickerOpen ? "is-open" : ""}`}
                    onClick={() => setIsProfPickerOpen(!isProfPickerOpen)}
                  >
                    {selectedProfessor ? (
                      <div className="professor-picker-selected">
                        <div className="professor-avatar-badge">{getInitials(selectedProfessor.fullName)}</div>
                        <div className="professor-card-content">
                          <p className="professor-name">{selectedProfessor.fullName}</p>
                          <span className="professor-role">Connected Academic Provider</span>
                        </div>
                      </div>
                    ) : (
                      <span className="professor-picker-placeholder">Choose a professor...</span>
                    )}
                    <svg
                      className="professor-picker-chevron"
                      width="18"
                      height="18"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>

                  {isProfPickerOpen && (
                    <div className="professor-picker-dropdown">
                      {workspace.providers.map((prof) => {
                        const isSelected = period.professorId === prof.id;
                        return (
                          <button type="button"
                            key={prof.id}
                            className={`professor-picker-option ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              setPeriod((prev) => ({ ...prev, professorId: prof.id }));
                              setIsProfPickerOpen(false);
                            }}
                          >
                            <div className="professor-avatar-badge">{getInitials(prof.fullName)}</div>
                            <div className="professor-card-content">
                              <p className="professor-name">{prof.fullName}</p>
                              <span className="professor-role">Connected Academic Provider</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="academic-submit-row">
              <p>{replacement ? "The previous request will be replaced when you save." : "Verify professor availability before submitting request."}</p>
              <div className="pending-request-actions">
                {replacement && <button type="button" className="pending-request-secondary" disabled={busy} onClick={resetReplacement}>Stop Editing</button>}
                <button className="dashboard-action" disabled={busy}>
                  {busy ? "Saving..." : replacement ? "Save Replacement" : "Designate Provider"}
                </button>
              </div>
            </div>
            </fieldset>
          </form>
        ) : (
          <p className="academic-panel-subtitle">Open Connections to connect with a professor first.</p>
        )}
      </section>

      {profileError && (
        <p className="academic-notice academic-notice--error" role="alert">{profileError}</p>
      )}
      {profileMessage && (
        <p className="academic-notice" role="status">{profileMessage}</p>
      )}

      {/* 3. Personal Circumstances Panel */}
      <section className="academic-panel">
        <div className="academic-panel-heading">
          <div>
            <span className="dashboard-eyebrow">Personal Background</span>
            <h2>Circumstances & Personal Indicators</h2>
          </div>
        </div>
        <p className="academic-panel-subtitle">
          Complete and update your background indicators while waiting for your professor's upload.
        </p>

        <form onSubmit={saveProfile}>
          <div className="circumstances-grid">
            {FIELDS.map(([key, label]) => {
              const currentVal = form[key];
              return (
                <div key={key} className="circumstance-card">
                  <label>{label}</label>
                  <div className="segmented-pill-toggle">
                    <button
                      type="button"
                      disabled={busy}
                      className={`segmented-pill-option ${currentVal === "true" ? "active" : ""}`}
                      onClick={() => { dirty.current = true; setForm((prev) => ({ ...prev, [key]: "true" })); }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className={`segmented-pill-option ${currentVal === "false" ? "active" : ""}`}
                      onClick={() => { dirty.current = true; setForm((prev) => ({ ...prev, [key]: "false" })); }}
                    >
                      No
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="academic-submit-row">
            <p>Saved changes are shared with your connected professors. Run a new forecast after changing a factor.</p>
            <button className="dashboard-action" disabled={busy}>
              {busy ? "Saving..." : "Save Personal Information"}
            </button>
          </div>
        </form>
      </section>

    </div>
  );
}
