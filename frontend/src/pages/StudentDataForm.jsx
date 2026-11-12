import { useRef, useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling";
import "../styles/StudentDataForm.css";

export const READINESS_MESSAGES = {
  no_connection: "Connect with a professor at your institution and wait for acceptance.",
  choose_provider: "Choose a connected professor to provide your record for the source semester.",
  provider_disconnected: "Your academic provider is no longer connected. Reconnect before running a forecast.",
  awaiting_upload: "Awaiting your professor's CSV upload for this semester.",
  profile_incomplete: "Complete your personal information below to enable forecasting.",
  ready: "Your academic record and personal information are ready for forecasting.",
};

const FIELDS = [
  ["educationalSpecialNeeds", "Educational Support Needs"],
  ["tuitionFeeStatus", "Tuition Fees Up to Date"],
  ["scholarshipStatus", "Active Scholarship"],
];

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

  const dirty = useRef(false);
  const digitInputRefs = useRef([]);
  const pickerRef = useRef(null);

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
    try {
      const response = await apiFetch("/api/students/me");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load your workspace.");
      ingest(data);
    } catch (err) { setGeneralError(err.message); }
  }, { intervalMs: 15000 });

  const saveProfile = async (event) => {
    event.preventDefault(); setBusy(true); setProfileError(""); setProfileMessage("");
    try {
      const response = await apiFetch("/api/students/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(FIELDS.map(([key]) => [key, form[key] === "true"]))),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not save your information.");
      dirty.current = false; ingest(data); setProfileMessage(data.message);
    } catch (err) { setProfileError(err.message); } finally { setBusy(false); }
  };

  const designate = async (event) => {
    event.preventDefault();
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
    setBusy(true);
    try {
      const response = await apiFetch("/api/students/me/academic-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...period, semester: Number(period.semester) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not designate your professor.");
      ingest(data); setProviderMessage(data.message);
    } catch (err) { setProviderError(err.message); } finally { setBusy(false); }
  };

  if (!workspace) return <p role="status">{generalError || "Loading your workspace..."}</p>;

  const academic = workspace.academic;
  const record = workspace.record;
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

      {providerError && (
        <p className="academic-notice academic-notice--error" role="alert">{providerError}</p>
      )}
      {providerMessage && (
        <p className="academic-notice" role="status">{providerMessage}</p>
      )}

      {/* 2. Designate Source Panel */}
      <section className="academic-panel">
        <div className="academic-panel-heading">
          <div>
            <span className="dashboard-eyebrow">Configuration</span>
            <h2>Designate Academic Provider</h2>
          </div>
        </div>
        <p className="academic-panel-subtitle">
          Select the source semester and designate your connected professor to handle record ingestion.
        </p>

        {workspace.providers.length > 0 ? (
          <form onSubmit={designate} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
                  <div
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
                  </div>

                  {isProfPickerOpen && (
                    <div className="professor-picker-dropdown">
                      {workspace.providers.map((prof) => {
                        const isSelected = period.professorId === prof.id;
                        return (
                          <div
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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="academic-submit-row">
              <p>Verify professor availability before submitting request.</p>
              <button className="dashboard-action" disabled={busy}>
                {busy ? "Designating..." : "Designate Provider"}
              </button>
            </div>
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
            <p>Update flags before generating personal forecasts.</p>
            <button className="dashboard-action" disabled={busy}>
              {busy ? "Saving..." : "Save Personal Information"}
            </button>
          </div>
        </form>
      </section>

    </div>
  );
}