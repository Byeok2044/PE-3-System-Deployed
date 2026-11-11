import { useMemo, useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling";
import { READINESS_MESSAGES } from "../pages/StudentDataForm";
import "../styles/AcademicWorkspace.css";

function ProviderTransfer({ item, onChanged }) {
  const { apiFetch, user } = useAuth();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const academic = item.academic;
  if (!academic) return null;

  const isOwner = String(academic.provider?._id) === String(user.id || user._id);
  const isRecipient = String(academic.pendingProvider?._id) === String(user.id || user._id);
  if (!isOwner && !isRecipient) return null;

  const eligibleProviders = (item.providers || []).filter(
    (provider) => provider.id !== String(academic.provider?._id)
  );

  const selectedTargetProvider = eligibleProviders.find((p) => p.id === target);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const transfer = async (action) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(
        `/api/professor/academic-records/${academic.academicRecordId}/transfer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, professorId: target }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Transfer failed.");
      setMessage(data.message);
      onChanged();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="academic-transfer-container">
      {academic.pendingProvider && (
        <div className="academic-transfer-notice">
          <span>
            Transfer offer pending with <strong>{academic.pendingProvider.fullName}</strong>.
          </span>
          {isOwner && (
            <button
              type="button"
              className="connection-button connection-button--danger"
              disabled={busy}
              onClick={() => transfer("cancel")}
            >
              Cancel Transfer
            </button>
          )}
        </div>
      )}

      {isRecipient && (
        <div className="academic-transfer-action-strip">
          <p>You have been offered provider ownership for this student's source semester.</p>
          <button
            type="button"
            className="dashboard-action"
            disabled={busy}
            onClick={() => transfer("accept")}
          >
            {busy ? "Accepting..." : "Accept Academic Transfer"}
          </button>
        </div>
      )}

      {isOwner && !academic.pendingProvider && eligibleProviders.length > 0 && (
        <div className="academic-transfer-box">
          <label className="academic-transfer-label">Transfer Provider Responsibility</label>
          <div className="academic-transfer-row">
            {/* Custom Dropdown Trigger */}
            <div className="transfer-custom-picker" ref={dropdownRef}>
              <div
                className={`transfer-picker-trigger ${isOpen ? "is-open" : ""}`}
                onClick={() => !busy && setIsOpen(!isOpen)}
              >
                <span className={selectedTargetProvider ? "picker-value" : "picker-placeholder"}>
                  {selectedTargetProvider ? selectedTargetProvider.fullName : "Choose professor..."}
                </span>
                <svg
                  className={`picker-chevron ${isOpen ? "is-open" : ""}`}
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a11.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>

              {/* Floating Menu */}
              {isOpen && (
                <div className="transfer-picker-menu">
                  {eligibleProviders.map((provider) => (
                    <div
                      key={provider.id}
                      className={`transfer-picker-option ${target === provider.id ? "selected" : ""}`}
                      onClick={() => {
                        setTarget(provider.id);
                        setIsOpen(false);
                      }}
                    >
                      <span className="transfer-picker-option-name">{provider.fullName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="connection-button"
              disabled={busy || !target}
              onClick={() => transfer("request")}
            >
              {busy ? "Offering..." : "Offer Transfer"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="academic-notice" style={{ marginTop: "0.5rem" }}>
          {message}
        </p>
      )}
    </div>
  );
}

export default function ConnectedStudentData() {
  const { apiFetch } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const refresh = async () => {
    try {
      const response = await apiFetch("/api/professor/students");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load student records.");
      setStudents(data.students || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useAdaptivePolling(refresh, { intervalMs: 15000 });

  const filteredStudents = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return students;
    return students.filter((item) => {
      const name = item.student?.fullName?.toLowerCase() || "";
      const email = item.student?.email?.toLowerCase() || "";
      return name.includes(term) || email.includes(term);
    });
  }, [students, searchQuery]);

  if (loading) return <p className="academic-panel-subtitle">Loading connected student records...</p>;

  return (
    <section className="academic-panel connected-students">
      <div className="academic-panel-heading">
        <div>
          <span className="dashboard-eyebrow">Class Directory</span>
          <h2>Connected Student Records</h2>
        </div>
        <span className="student-count-chip">
          {filteredStudents.length} of {students.length} Student{students.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="academic-panel-subtitle">
        Review student sources for accuracy and use risk forecasts to guide supportive academic conversations.
      </p>

      {students.length > 0 && (
        <div className="student-search-bar-wrapper">
          <div className="student-search-input-box">
            <svg
              className="student-search-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="student-search-input"
              placeholder="Search connected student by name or email address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="student-search-clear-btn"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p role="alert" className="academic-notice academic-notice--error">{error}</p>}

      {!students.length && (
        <p className="academic-panel-subtitle">No connected students yet. Accept requests in Connections first.</p>
      )}

      {students.length > 0 && filteredStudents.length === 0 && (
        <div className="student-search-empty-state">
          <p>No connected students found matching &quot;<strong>{searchQuery}</strong>&quot;.</p>
          <button type="button" className="connection-button" onClick={() => setSearchQuery("")}>
            Reset Filter
          </button>
        </div>
      )}

      <div className="connected-students-list">
        {filteredStudents.map((item) => (
          <article className="connected-student-card" key={item.student.id}>
            {/* Pinned Top Row: Name on Left, Badge on Right */}
            <div className="connected-student-card__top">
              <h3 className="connected-student-name">{item.student.fullName}</h3>
              <span
                className={`academic-source-badge ${
                  item.record ? "badge--success" : "badge--pending"
                }`}
              >
                {item.record ? "Record Uploaded" : "Awaiting Record"}
              </span>
            </div>

            {/* Email and Readiness Message Below */}
            <p className="connected-student-subtext">
              <strong>{item.student.email}</strong> · {READINESS_MESSAGES[item.readiness]}
            </p>

            {item.academic && (
              <p className="academic-provenance">
                Source: {item.academic.academicYear}, Semester {item.academic.semester} · Provider:{" "}
                <strong>{item.academic.provider?.fullName || "Unavailable"}</strong> · Version{" "}
                {item.academic.academicVersion}
              </p>
            )}

            {item.record && (
              <dl className="professor-student-metrics">
                <div className="metric-tile">
                  <dt>Previous GWA / Grade</dt>
                  <dd>{item.record.previousSemesterGrade} / {item.record.gradeMaximum}</dd>
                </div>
                <div className="metric-tile">
                  <dt>Enrolled Units</dt>
                  <dd>{item.record.previousSemesterUnitsEnrolled}</dd>
                </div>
                <div className="metric-tile">
                  <dt>Approved Units</dt>
                  <dd>{item.record.previousSemesterUnitsApproved}</dd>
                </div>
                <div className="metric-tile">
                  <dt>Schedule</dt>
                  <dd>{item.record.attendance === "day" ? "Daytime" : "Evening"}</dd>
                </div>
              </dl>
            )}

            <div className="student-forecast-badge">
              <span>
                {item.forecast ? (
                  <>
                    Current Forecast: Grade{" "}
                    <strong>
                      {item.forecast.predictedNextSemesterGrade} / {item.forecast.gradeMaximum}
                    </strong>
                  </>
                ) : (
                  <span>
                    {item.hasOutdatedForecast
                      ? "Previous forecast is historical. Fresh forecast required."
                      : "No active forecast generated."}
                  </span>
                )}
              </span>
              {item.forecast && (
                <span>
                  Dropout Probability:{" "}
                  <strong>{Math.round(item.forecast.dropoutProbability * 100)}%</strong>
                </span>
              )}
            </div>

            <ProviderTransfer item={item} onChanged={refresh} />
          </article>
        ))}
      </div>
    </section>
  );
}