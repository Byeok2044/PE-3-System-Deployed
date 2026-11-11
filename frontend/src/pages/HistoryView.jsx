import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FilePenLine,
  FilePlus2,
  History as HistoryIcon,
  Trash2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling";
import "../styles/AcademicWorkspace.css";

const eventCopy = {
  record_created: { label: "Personal Information Created", icon: FilePlus2 },
  record_updated: { label: "Personal Information Updated", icon: FilePenLine },
  forecast_run: { label: "Forecast Prediction run", icon: BarChart3 },
  insight_generated: { label: "Support Suggestions Generated", icon: Activity },
};

const formatDate = (value) => {
  if (!value) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export default function HistoryView({ user }) {
  const { apiFetch } = useAuth();
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [academicAudit, setAcademicAudit] = useState([]);
  const [state, setState] = useState({
    loading: user?.role === "student",
    error: "",
    activities: [],
  });
  const [deletingId, setDeletingId] = useState(null);
  const [entryPendingDeletion, setEntryPendingDeletion] = useState(null);

  const deleteEntry = async () => {
    const entry = entryPendingDeletion;
    const id = entry?.id || entry?._id;
    if (!id) return;

    setDeletingId(id);
    setState((current) => ({ ...current, error: "" }));
    try {
      const response = await apiFetch(`/api/students/me/history/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not delete this history entry.");
      setState((current) => ({
        ...current,
        activities: current.activities.filter((activity) => (activity.id || activity._id) !== id),
      }));
      setEntryPendingDeletion(null);
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || "Could not delete this history entry." }));
    } finally {
      setDeletingId(null);
    }
  };

  useAdaptivePolling(async () => {
    try {
      const [historyResponse, auditResponse] = await Promise.all([
        apiFetch("/api/students/me/history"), apiFetch("/api/students/me/academic-audit"),
      ]);
      if (!historyResponse.ok || !auditResponse.ok) throw new Error("Could not load your history.");
      const [history, audit] = await Promise.all([historyResponse.json(), auditResponse.json()]);
      setState({ loading: false, error: "", activities: history.activities || [] });
      setAcademicAudit(audit.entries || []);
    } catch (error) { setState(current => ({ ...current, loading: false, error: error.message })); }
  }, { intervalMs: 15000, enabled: user?.role === "student" });

  if (user?.role !== "student") {
    return (
      <section className="workspace-section" id="history">
        <div className="section-heading">
          <div>
            <p className="dashboard-eyebrow">Forecast history</p>
            <h2>Cohort Timeline & Audits</h2>
          </div>
        </div>
        <p className="dashboard-subtext">
          Historical log tracking is active for individual student forecasting runs and institutional updates.
        </p>
      </section>
    );
  }

  if (state.loading) {
    return <p className="student-data-loading">Loading your timeline history…</p>;
  }

  const filteredActivities = state.activities.filter((entry) => {
    if (selectedFilter === "all") return true;
    if (selectedFilter === "system_event") {
      // Handles unknown or explicit system_event types
      return !eventCopy[entry.type] || entry.type === "system_event";
    }
    return entry.type === selectedFilter;
  });

  return (
    <section className="workspace-section" id="history">
      <div className="section-heading"
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          width: "100%" 
        }}
      >
        <div>
          <p className="dashboard-eyebrow">Your Activity</p>
          <h2>Record & Forecast Timeline</h2>
        </div>

        {/* --- START OF NEW FILTER CONTROL --- */}
        <div className="caseload-controls" 
          style={{ 
            margin: 0, 
            width: "auto",      /* Overrides width: 100% from dashboard.css */
            flex: "none",        /* Prevents flexbox from stretching the element */
            marginLeft: "auto",  /* Forces it to the far right */
            display: "flex", 
              alignItems: "center"
          }}
        >
          <div className="filter-select">
            <select
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
              aria-label="Filter events by type"
            >
              <option value="all">All Events</option>
              <option value="record_created">Personal Information Created</option>
              <option value="record_updated">Personal Information Updated</option>
              <option value="forecast_run">Forecast Prediction Run</option>
              <option value="insight_generated">Support Suggestions Generated</option>
              <option value="system_event">System Event</option>
            </select>
          </div>
        </div>
      </div>

      <details className="academic-audit"><summary>Academic record audit (protected)</summary>
        <p>Professor uploads, corrections, and provider changes are retained independently of your activity history.</p>
        {academicAudit.length ? <ul>{academicAudit.map(entry => <li key={entry._id}>
          <strong>{entry.action.replaceAll("_", " ")}</strong> · {entry.actor?.fullName || "Account unavailable"} · {formatDate(entry.createdAt)}
          {entry.after && <span> · {entry.after.academicYear}, semester {entry.after.semester} · version {entry.after.academicVersion}</span>}
          {entry.reason && <p>{entry.reason}</p>}
          {entry.before?.previousSemesterGrade !== undefined && <p>Before: {entry.before.previousSemesterGrade}/{entry.before.gradeMaximum}, {entry.before.previousSemesterUnitsApproved}/{entry.before.previousSemesterUnitsEnrolled} units</p>}
          {entry.after?.previousSemesterGrade !== undefined && <p>After: {entry.after.previousSemesterGrade}/{entry.after.gradeMaximum}, {entry.after.previousSemesterUnitsApproved}/{entry.after.previousSemesterUnitsEnrolled} units</p>}
        </li>)}</ul> : <p>No professor-managed academic events yet.</p>}
      </details>
      {state.error && (
        <div className="login-alert" role="alert">
          {state.error}
        </div>
      )}

      {!state.error && state.activities.length === 0 ? (
        <div
          className="empty-state"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            minHeight: "220px",
            padding: "2rem 1.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.25rem",
              maxWidth: "540px",
            }}
          >
            <div
              className="empty-illustration"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <HistoryIcon size={32} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>No activity logged yet</h3>
              <p style={{ margin: "0.35rem 0 0 0", lineHeight: 1.5 }}>
                Save your personal information or run a forecast after your professor uploads your academic record.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ul className="history-timeline history-timeline--live">
          {filteredActivities.map((entry) => {
            const details = eventCopy[entry.type] || {
              label: "System Event",
              icon: Activity,
            };
            const Icon = details.icon;
            const forecast = entry.forecast;
            // Legacy forecast snapshots used studySchedule; saved records and
            // new forecasts use attendance. Read either so old history is
            // displayed correctly as well.
            const attendance = entry.record?.attendance || entry.record?.studySchedule;
            const isHighRisk =
              forecast && Math.round((forecast.dropoutProbability || 0) * 100) > 50;

            return (
              <li key={entry.id || entry._id} className="history-timeline-item">
                <span className="history-timeline-icon">
                  <Icon size={16} />
                </span>

                <div className="history-timeline-body">
                  <div className="history-timeline-main">
                    <strong>{details.label}</strong>
                    <time>{formatDate(entry.createdAt)}</time>
                    {(entry.forecast || entry.insight) && <small>{entry.freshness === "current" ? "Current inputs" : entry.freshness === "legacy" ? "Historical · legacy inputs" : "Historical · outdated inputs"}{entry.record?.academicVersion !== undefined ? " · Academic version " + entry.record.academicVersion : ""}</small>}
                  </div>

                  {entry.record?.previousSemesterGrade !== undefined && (
                    <div className="history-timeline-record-meta">
                      <span>
                        Previous Grade:{" "}
                        <strong>
                          {entry.record.previousSemesterGrade} / {entry.record.gradeMaximum ?? "Not recorded"}
                        </strong>
                      </span>
                      <span>
                        Units Approved:{" "}
                        <strong>
                          {entry.record.previousSemesterUnitsApproved} of {entry.record.previousSemesterUnitsEnrolled}
                        </strong>
                      </span>
                      <span>
                        Schedule:{" "}
                          <strong>{attendance === "day" ? "Daytime" : attendance === "night" ? "Evening" : "Not recorded"}</strong>
                      </span>
                    </div>
                  )}
                </div>

                {forecast && (
                  <div className="history-timeline-value">
                    <span className="forecast-metric-badge">
                      Proj. Grade: {forecast.predictedNextSemesterGrade} / {forecast.gradeMaximum ?? "Not recorded"}
                    </span>
                    <span
                      className={`forecast-risk-tag ${isHighRisk ? "risk-high" : "risk-low"}`}
                    >
                      {isHighRisk ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                      {Math.round((forecast.dropoutProbability || 0) * 100)}% Attrition Risk
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className="history-delete-button"
                  onClick={() => setEntryPendingDeletion(entry)}
                  disabled={entry.type === "risk_alert_sent" || deletingId === (entry.id || entry._id)}
                  aria-label={`Delete ${details.label.toLowerCase()} from history`}
                >
                  <Trash2 size={15} />
                  {deletingId === (entry.id || entry._id) ? "Deleting…" : "Delete"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {entryPendingDeletion && (
        <div className="history-delete-warning" role="dialog" aria-modal="true" aria-labelledby="history-delete-warning-title">
          <div className="history-delete-warning__card">
            <AlertTriangle size={23} aria-hidden="true" />
            <div>
              <h3 id="history-delete-warning-title">Delete this history entry?</h3>
              <p>
                This permanently removes the selected activity from your history. It cannot be restored.
              </p>
            </div>
            <div className="history-delete-warning__actions">
              <button
                type="button"
                className="history-delete-cancel"
                onClick={() => setEntryPendingDeletion(null)}
                disabled={Boolean(deletingId)}
              >
                Keep entry
              </button>
              <button
                type="button"
                className="history-delete-confirm"
                onClick={deleteEntry}
                disabled={Boolean(deletingId)}
              >
                <Trash2 size={15} />
                {deletingId ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
