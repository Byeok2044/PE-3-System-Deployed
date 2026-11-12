import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  FilePenLine,
  FilePlus2,
  Filter,
  History as HistoryIcon,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling";
import "../styles/AcademicWorkspace.css";
import "../styles/Dashboard.css";

const eventCopy = {
  record_created: { label: "Personal Information Created", icon: FilePlus2, color: "blue" },
  record_updated: { label: "Personal Information Updated", icon: FilePenLine, color: "blue" },
  forecast_run: { label: "Forecast Prediction Run", icon: BarChart3, color: "purple" },
  insight_generated: { label: "Support Suggestions Generated", icon: Activity, color: "emerald" },
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
        apiFetch("/api/students/me/history"),
        apiFetch("/api/students/me/academic-audit"),
      ]);
      if (!historyResponse.ok || !auditResponse.ok) throw new Error("Could not load your history.");
      const [history, audit] = await Promise.all([historyResponse.json(), auditResponse.json()]);
      setState({ loading: false, error: "", activities: history.activities || [] });
      setAcademicAudit(audit.entries || []);
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }, { intervalMs: 15000, enabled: user?.role === "student" });

  if (user?.role !== "student") {
    return (
      <section className="workspace-section" id="history">
        <div className="section-heading">
          <div>
            <span className="dashboard-eyebrow">Forecast history</span>
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
    return <p className="connected-students-loading">Loading your timeline history…</p>;
  }

  const filteredActivities = state.activities.filter((entry) => {
    if (selectedFilter === "all") return true;
    return entry.type === selectedFilter;
  });

  return (
    <div className="history-page-wrapper">
      {/* Intro Header */}
      <section className="dashboard-intro">
        <span className="dashboard-eyebrow">Your Activity</span>
        <h1>Record & Forecast Timeline</h1>
        <p>
          Trace changes made to your academic record, past attrition forecasts, and official professor audits.
        </p>
      </section>

      {/* Unified Toolbar & Filter Section */}
      <div className="history-control-card">
        <div className="history-control-header">
          <div className="history-control-title">
            <Filter size={16} className="history-icon-primary" />
            <span>Activity Filters</span>
          </div>

          <div className="history-filter-field">
            <select
              className="history-select"
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
              aria-label="Filter events by type"
            >
              <option value="all">All Events ({state.activities.length})</option>
              <option value="record_created">Personal Information Created</option>
              <option value="record_updated">Personal Information Updated</option>
              <option value="forecast_run">Forecast Prediction Runs</option>
              <option value="insight_generated">Support Suggestions</option>
            </select>
            <ChevronDown size={14} className="history-select-arrow" />
          </div>
        </div>

        {/* Embedded Protected Audit Dropdown */}
        <details className="history-embedded-audit">
          <summary className="history-embedded-audit__summary">
            <div className="history-audit-left">
              <ShieldCheck size={16} className="history-icon-shield" />
              <span>Academic Record Audit (Protected Official History)</span>
            </div>
            <span className="history-audit-pill">{academicAudit.length} Records</span>
          </summary>

          <div className="history-embedded-audit__content">
            <p className="history-audit-note">
              Professor uploads, corrections, and provider changes are retained independently of your personal log.
            </p>

            {academicAudit.length ? (
              <div className="history-audit-items">
                {academicAudit.map((entry) => (
                  <div key={entry._id} className="history-audit-row">
                    <div className="history-audit-row__header">
                      <span className="audit-type-tag">{entry.action.replaceAll("_", " ")}</span>
                      <time>{formatDate(entry.createdAt)}</time>
                    </div>

                    <p className="history-audit-row__detail">
                      By <strong>{entry.actor?.fullName || "Account unavailable"}</strong>
                      {entry.after && (
                        <span>
                          {" "}· AY {entry.after.academicYear}, Sem {entry.after.semester} (v{entry.after.academicVersion})
                        </span>
                      )}
                    </p>

                    {entry.reason && (
                      <p className="history-audit-row__reason">
                        <em>Reason:</em> {entry.reason}
                      </p>
                    )}

                    {(entry.before?.previousSemesterGrade !== undefined || entry.after?.previousSemesterGrade !== undefined) && (
                      <div className="history-audit-row__diff">
                        {entry.before?.previousSemesterGrade !== undefined && (
                          <div className="audit-diff-col before">
                            <small>Prior Value</small>
                            <strong>{entry.before.previousSemesterGrade} / {entry.before.gradeMaximum}</strong>
                            <span>{entry.before.previousSemesterUnitsApproved} / {entry.before.previousSemesterUnitsEnrolled} Units</span>
                          </div>
                        )}
                        {entry.after?.previousSemesterGrade !== undefined && (
                          <div className="audit-diff-col after">
                            <small>Updated Record</small>
                            <strong>{entry.after.previousSemesterGrade} / {entry.after.gradeMaximum}</strong>
                            <span>{entry.after.previousSemesterUnitsApproved} / {entry.after.previousSemesterUnitsEnrolled} Units</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="history-audit-empty">No professor-managed academic events logged yet.</p>
            )}
          </div>
        </details>
      </div>

      {state.error && (
        <div className="login-alert" role="alert">
          <AlertTriangle size={16} />
          <p>{state.error}</p>
        </div>
      )}

      {/* Main Activity Timeline Section */}
      <section className="workspace-section history-timeline-panel">
        <div className="section-heading">
          <div>
            <span className="dashboard-eyebrow">Logged Activities</span>
            <h2>Activity Feed</h2>
          </div>
          <span className="history-counter-chip">
            Showing {filteredActivities.length} of {state.activities.length}
          </span>
        </div>

        {!state.error && filteredActivities.length === 0 ? (
          <div className="empty-state" style={{ minHeight: "180px" }}>
            <div className="empty-illustration">
              <HistoryIcon size={26} />
            </div>
            <div>
              <h3>No activity logged for this filter</h3>
              <p>
                Save your personal information or generate a retention forecast to review entries on your timeline.
              </p>
            </div>
          </div>
        ) : (
          <ul className="history-timeline-list">
            {filteredActivities.map((entry) => {
              const details = eventCopy[entry.type] || {
                label: "System Event",
                icon: Activity,
                color: "blue",
              };
              const Icon = details.icon;
              const forecast = entry.forecast;
              const attendance = entry.record?.attendance || entry.record?.studySchedule;
              const isHighRisk =
                forecast && forecast.dropoutProbability >= 0.4;

              return (
                <li key={entry.id || entry._id} className="history-card-item">
                  <div className={`history-card-icon ${details.color}`}>
                    <Icon size={18} />
                  </div>

                  <div className="history-card-content">
                    <div className="history-card-header">
                      <h4 className="history-card-title">{details.label}</h4>
                      <time className="history-timestamp">
                        <Clock size={12} /> {formatDate(entry.createdAt)}
                      </time>
                      {(entry.forecast || entry.insight) && (
                        <span className="history-status-tag">
                          {entry.freshness === "current"
                            ? "Current inputs"
                            : entry.freshness === "legacy"
                            ? "Legacy inputs"
                            : "Outdated inputs"}
                          {entry.record?.academicVersion !== undefined
                            ? ` · v${entry.record.academicVersion}`
                            : ""}
                        </span>
                      )}
                    </div>

                    {entry.batchId && <p className="dashboard-subtext">
                      Class forecast by {entry.generatedByName || "your professor"}{entry.section && ` · ${entry.section}`}
                      {entry.record?.academicYear && ` · ${entry.record.academicYear}, Semester ${entry.record.semester}`}
                      {forecast?.modelVersion && ` · Model: ${forecast.modelVersion}`}
                    </p>}

                    {entry.record?.previousSemesterGrade !== undefined && (
                      <div className="history-metrics-row">
                        <span className="history-metric">
                          Grade: <strong>{entry.record.previousSemesterGrade} / {entry.record.gradeMaximum ?? "—"}</strong>
                        </span>
                        <span className="history-metric">
                          Units: <strong>{entry.record.previousSemesterUnitsApproved} / {entry.record.previousSemesterUnitsEnrolled}</strong>
                        </span>
                        <span className="history-metric">
                          Schedule:{" "}
                          <strong>
                            {attendance === "day"
                              ? "Daytime"
                              : attendance === "night"
                              ? "Evening"
                              : "Not recorded"}
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="history-card-actions">
                    {forecast && (
                      <div className="history-forecast-stat">
                        <span className="forecast-val">
                          Proj. Grade: <strong>{forecast.predictedNextSemesterGrade} / {forecast.gradeMaximum ?? "—"}</strong>
                        </span>
                        <span className={`forecast-pill ${isHighRisk ? "high" : "low"}`}>
                          {isHighRisk ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                          {Math.round((forecast.dropoutProbability || 0) * 100)}% Dropout Risk
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      className="history-delete-btn"
                      onClick={() => setEntryPendingDeletion(entry)}
                      disabled={entry.type === "risk_alert_sent" || deletingId === (entry.id || entry._id)}
                      aria-label={`Delete ${details.label.toLowerCase()} from history`}
                      title="Delete activity record"
                    >
                      <Trash2 size={14} />
                      <span>{deletingId === (entry.id || entry._id) ? "Deleting…" : "Delete"}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {entryPendingDeletion && (
        <div className="risk-pop-backdrop" role="dialog" aria-modal="true" onClick={() => setEntryPendingDeletion(null)}>
          <div className="risk-pop-modal border-red" onClick={(e) => e.stopPropagation()}>
            <div className="risk-pop-icon red">
              <Trash2 size={24} />
            </div>
            <h3>Delete history entry?</h3>
            <p>
              This permanently removes the selected activity from your timeline record. This action cannot be reversed.
            </p>
            <div className="risk-pop-actions">
              <button
                type="button"
                className="risk-pop-action-btn red"
                onClick={deleteEntry}
                disabled={Boolean(deletingId)}
              >
                {deletingId ? "Deleting Record…" : "Delete Permanently"}
              </button>
              <button
                type="button"
                className="risk-pop-dismiss-btn"
                onClick={() => setEntryPendingDeletion(null)}
                disabled={Boolean(deletingId)}
              >
                Keep Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
