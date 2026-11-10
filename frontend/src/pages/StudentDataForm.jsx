import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  CircleHelp,
  GraduationCap,
  Landmark,
  Pencil,
  Save,
  Check,
  X,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import "../styles/StudentDataForm.css";

const EMPTY_FORM = {
  educationalSpecialNeeds: "",
  tuitionFeeStatus: "",
  scholarshipStatus: "",
  attendance: "",
  gradeMaximum: "20",
  previousSemesterGrade: "",
  previousSemesterUnitsEnrolled: "",
  previousSemesterUnitsApproved: "",
};

const boolToString = (value) =>
  value === true ? "yes" : value === false ? "no" : "";

const recordToForm = (record) => ({
  educationalSpecialNeeds: boolToString(record.educationalSpecialNeeds),
  tuitionFeeStatus: boolToString(record.tuitionFeeStatus),
  scholarshipStatus: boolToString(record.scholarshipStatus),
  attendance: record.attendance || "",
  gradeMaximum: record.gradeMaximum ? String(record.gradeMaximum) : "20",
  previousSemesterGrade: record.previousSemesterGrade ?? "",
  previousSemesterUnitsEnrolled: record.previousSemesterUnitsEnrolled ?? "",
  previousSemesterUnitsApproved: record.previousSemesterUnitsApproved ?? "",
});

const isCurrentRecord = (record) =>
  record &&
  typeof record.previousSemesterGrade === "number" &&
  typeof record.previousSemesterUnitsEnrolled === "number" &&
  typeof record.previousSemesterUnitsApproved === "number" &&
  ["day", "night"].includes(record.attendance) &&
  typeof record.tuitionFeeStatus === "boolean" &&
  typeof record.scholarshipStatus === "boolean";

export default function StudentDataForm({ onSaveRecord }) {
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [savedRecord, setSavedRecord] = useState(null);
  const [isEditing, setIsEditing] = useState(true);

  // Hover Modal State (active ONLY in saved summary view)
  const [hoverModal, setHoverModal] = useState(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const response = await apiFetch("/api/students/me");
        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "Your student data could not be loaded. Please refresh the page and try again."
              : "Could not load your data."
          );
        }
        const data = await response.json();
        if (isMounted && isCurrentRecord(data.record)) {
          setFormData(recordToForm(data.record));
          setSavedRecord(data.record);
          setIsEditing(false);
          setSavedAt(data.record.updatedAt || data.record.submittedAt || null);
          if (onSaveRecord) onSaveRecord(data.record);
        }
      } catch (error) {
        if (isMounted) setServerError(error.message || "Could not load your data.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [apiFetch, onSaveRecord]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  // Hover event handler for summary status cards
  const handleBadgeHover = (field, isTrue) => {
    if (field === "educationalSpecialNeeds") {
      setHoverModal({
        title: "Educational Special Needs",
        message: isTrue
          ? "You indicated that you have special educational needs or learning accommodations."
          : "You indicated you do not require special educational assistance.",
        variant: isTrue ? "info" : "success",
      });
    } else if (field === "tuitionFeeStatus") {
      setHoverModal({
        title: "Tuition Fee Status",
        message: isTrue
          ? "Tuition requirements for your student profile are complete."
          : "Your registration requirements remain incomplete.",
        variant: isTrue ? "success" : "warning",
      });
    } else if (field === "scholarshipStatus") {
      setHoverModal({
        title: "Scholarship Status",
        message: isTrue
          ? "You indicated an active scholarship or academic grant."
          : "You answered that you don't have an active student scholarship.",
        variant: isTrue ? "success" : "info",
      });
    }
  };

  const handleBadgeLeave = () => {
    setHoverModal(null);
  };

  const unitStats = useMemo(() => {
    const enrolled = Number(formData.previousSemesterUnitsEnrolled);
    const approved = Number(formData.previousSemesterUnitsApproved);
    if (!enrolled || isNaN(enrolled) || isNaN(approved) || enrolled <= 0) return null;
    const rate = Math.min(100, Math.max(0, Math.round((approved / enrolled) * 100)));
    return { enrolled, approved, rate };
  }, [formData.previousSemesterUnitsEnrolled, formData.previousSemesterUnitsApproved]);

  const validate = () => {
    const next = {};
    if (formData.educationalSpecialNeeds === "") next.educationalSpecialNeeds = "Select an option.";
    if (formData.tuitionFeeStatus === "") next.tuitionFeeStatus = "Select an option.";
    if (formData.scholarshipStatus === "") next.scholarshipStatus = "Select an option.";
    if (!formData.attendance) next.attendance = "Select daytime or evening attendance.";

    const gradeMax = Number(formData.gradeMaximum);
    if (isNaN(gradeMax) || gradeMax <= 0 || gradeMax > 100) {
      next.gradeMaximum = "Select a valid scale.";
    }

    const prevGrade = Number(formData.previousSemesterGrade);
    const minGrade = gradeMax === 5 ? 1 : 0;
    if (
      formData.previousSemesterGrade === "" ||
      isNaN(prevGrade) ||
      prevGrade < minGrade ||
      prevGrade > gradeMax
    ) {
      next.previousSemesterGrade = `Enter a grade between ${minGrade} and ${gradeMax}.`;
    }

    const enrolled = Number(formData.previousSemesterUnitsEnrolled);
    if (!formData.previousSemesterUnitsEnrolled || !Number.isInteger(enrolled) || enrolled < 1 || enrolled > 100) {
      next.previousSemesterUnitsEnrolled = "Enter enrolled units between 1 and 100.";
    }

    const approved = Number(formData.previousSemesterUnitsApproved);
    if (
      formData.previousSemesterUnitsApproved === "" ||
      !Number.isInteger(approved) ||
      approved < 0 ||
      approved > 100
    ) {
      next.previousSemesterUnitsApproved = "Enter approved units between 0 and 100.";
    } else if (Number.isInteger(enrolled) && approved > enrolled) {
      next.previousSemesterUnitsApproved = "Approved units cannot exceed enrolled units.";
    }

    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError("");
    setSavedAt(null);

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiFetch("/api/students/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          educationalSpecialNeeds: formData.educationalSpecialNeeds === "yes",
          tuitionFeeStatus: formData.tuitionFeeStatus === "yes",
          scholarshipStatus: formData.scholarshipStatus === "yes",
          attendance: formData.attendance,
          gradeMaximum: Number(formData.gradeMaximum),
          previousSemesterGrade: Number(formData.previousSemesterGrade),
          previousSemesterUnitsEnrolled: Number(formData.previousSemesterUnitsEnrolled),
          previousSemesterUnitsApproved: Number(formData.previousSemesterUnitsApproved),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.errors) setErrors(data.errors);
        throw new Error(data.message || "Could not save your information.");
      }

      const record = data.record || {
        educationalSpecialNeeds: formData.educationalSpecialNeeds === "yes",
        tuitionFeeStatus: formData.tuitionFeeStatus === "yes",
        scholarshipStatus: formData.scholarshipStatus === "yes",
        attendance: formData.attendance,
        gradeMaximum: Number(formData.gradeMaximum),
        previousSemesterGrade: Number(formData.previousSemesterGrade),
        previousSemesterUnitsEnrolled: Number(formData.previousSemesterUnitsEnrolled),
        previousSemesterUnitsApproved: Number(formData.previousSemesterUnitsApproved),
      };

      setSavedRecord(record);
      setFormData(recordToForm(record));
      setSavedAt(record.updatedAt || new Date().toISOString());
      setIsEditing(false);

      if (onSaveRecord) onSaveRecord(record);
    } catch (err) {
      setServerError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Normal Form Answering Card (No popovers/tooltips)
  const SegmentedPill = ({ name, label }) => (
    <div className="circumstance-card">
      <label>{label}</label>
      <div className="segmented-pill-toggle" role="radiogroup" aria-label={label}>
        {["yes", "no"].map((option) => {
          const isSelected = formData[name] === option;
          return (
            <button
              type="button"
              key={option}
              className={`segmented-pill-option ${isSelected ? "active" : ""}`}
              onClick={() => handleChange({ target: { name, value: option } })}
              aria-pressed={isSelected}
            >
              {option === "yes" ? "Yes" : "No"}
            </button>
          );
        })}
      </div>
      {errors[name] && <span className="field-error">{errors[name]}</span>}
    </div>
  );

  if (isLoading) {
    return (
      <div className="student-data-skeleton-wrapper" aria-busy="true">
        <div className="skeleton-box skeleton-banner" />
        <div className="skeleton-box skeleton-fieldset" />
        <div className="skeleton-box skeleton-fieldset" />
      </div>
    );
  }

  return (
    <>
      {/* Blurred Backdrop Hover Modal (Only appears when hovering over saved cards) */}
      {hoverModal && (
        <div className="modal-overlay" role="tooltip" aria-live="polite">
          <div className="status-modal-card">
            <div className="status-modal-header">
              <h4>{hoverModal.title}</h4>
            </div>
            <div className="status-modal-body">
              <div className={`status-modal-icon-badge ${hoverModal.variant || "info"}`}>
                {hoverModal.variant === "warning" ? (
                  <AlertTriangle size={20} />
                ) : hoverModal.variant === "success" ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <Info size={20} />
                )}
              </div>
              <p className="status-modal-message">{hoverModal.message}</p>
            </div>
          </div>
        </div>
      )}

      {savedRecord && !isEditing ? (
        <div className="student-data-saved-view">
          <section className="student-data-summary" aria-labelledby="student-data-summary-title">
            <div className="student-data-summary__header">
              <div>
                <p className="dashboard-eyebrow">Academic Profile</p>
                <h3 id="student-data-summary-title">Saved Academic Information</h3>
                <p>
                  {savedAt
                    ? `Synchronized ${new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(savedAt))}`
                    : "Data is up to date."}
                </p>
              </div>
              <button
                type="button"
                className="student-data-edit"
                onClick={() => {
                  setIsEditing(true);
                  setSavedAt(null);
                  setServerError("");
                }}
              >
                <Pencil size={13} /> Edit Record
              </button>
            </div>

            {/* Row 1: Academic Metrics (4 Cards) */}
            <div className="student-data-summary__metrics-grid">
              <div className="metric-tile">
                <span>Study Schedule</span>
                <strong>{savedRecord.attendance === "day" ? "Daytime" : "Evening/Night"}</strong>
              </div>
              <div className="metric-tile">
                <span>Previous Grade</span>
                <strong>
                  {savedRecord.previousSemesterGrade}{" "}
                  <small style={{ fontSize: "0.75rem", color: "#64748b" }}>
                    / {savedRecord.gradeMaximum || 20}
                  </small>
                </strong>
              </div>
              <div className="metric-tile">
                <span>Units Enrolled</span>
                <strong>{savedRecord.previousSemesterUnitsEnrolled}</strong>
              </div>
              <div className="metric-tile">
                <span>Units Approved</span>
                <strong>{savedRecord.previousSemesterUnitsApproved}</strong>
              </div>
            </div>

            {/* Row 2: Personal Circumstances matching the same container card style (3 Cards) */}
            <div className="student-data-summary__details">
              <div
                className="metric-tile interactive-tile"
                onMouseEnter={() =>
                  handleBadgeHover(
                    "educationalSpecialNeeds",
                    savedRecord.educationalSpecialNeeds
                  )
                }
                onMouseLeave={handleBadgeLeave}
              >
                <span>Special Needs</span>
                <div className="metric-tile-badge-wrapper">
                  <span
                    className={`status-badge ${
                      savedRecord.educationalSpecialNeeds ? "active" : "inactive"
                    }`}
                  >
                    {savedRecord.educationalSpecialNeeds ? <Check size={11} /> : <X size={11} />}
                    {savedRecord.educationalSpecialNeeds ? "Assisted" : "None"}
                  </span>
                </div>
              </div>

              <div
                className="metric-tile interactive-tile"
                onMouseEnter={() =>
                  handleBadgeHover("tuitionFeeStatus", savedRecord.tuitionFeeStatus)
                }
                onMouseLeave={handleBadgeLeave}
              >
                <span>Tuition Status</span>
                <div className="metric-tile-badge-wrapper">
                  <span
                    className={`status-badge ${
                      savedRecord.tuitionFeeStatus ? "active" : "warning"
                    }`}
                  >
                    {savedRecord.tuitionFeeStatus ? <Check size={11} /> : <X size={11} />}
                    {savedRecord.tuitionFeeStatus ? "Settled" : "Unsettled"}
                  </span>
                </div>
              </div>

              <div
                className="metric-tile interactive-tile"
                onMouseEnter={() =>
                  handleBadgeHover("scholarshipStatus", savedRecord.scholarshipStatus)
                }
                onMouseLeave={handleBadgeLeave}
              >
                <span>Scholarship</span>
                <div className="metric-tile-badge-wrapper">
                  <span
                    className={`status-badge ${
                      savedRecord.scholarshipStatus ? "active" : "inactive"
                    }`}
                  >
                    {savedRecord.scholarshipStatus ? <Check size={11} /> : <X size={11} />}
                    {savedRecord.scholarshipStatus ? "Scholar" : "Regular"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="student-data-calculate-card">
            <div>
              <div className="student-data-calculate-card__badge">
                <CheckCircle2 size={13} /> Ready For Modeling
              </div>
              <h4 style={{ margin: "0.2rem 0 0.1rem", color: "#0f172a", fontSize: "0.95rem" }}>
                Academic Snapshot Complete
              </h4>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.78rem" }}>
                Calculate and model your predicted performance trends.
              </p>
            </div>
            <button
              type="button"
              className="calculate-action-btn"
              onClick={() => navigate("/dashboard/insights")}
            >
              <Calculator size={15} /> Run Evaluation <ArrowRight size={15} />
            </button>
          </section>
        </div>
      ) : (
        <form className="student-data-form" onSubmit={handleSubmit} noValidate>
          <div className="student-data-form__intro">
            <div className="student-data-form__intro-icon" aria-hidden="true">
              <GraduationCap size={18} />
            </div>
            <div>
              <h3>Academic Record Setup</h3>
              <p>Provide your enrollment metrics and status to calibrate your forecasting profile.</p>
            </div>
          </div>

          {serverError && (
            <div
              className="field-error"
              style={{ padding: "0.6rem 0.85rem", background: "#fef2f2", borderRadius: 6 }}
            >
              {serverError}
            </div>
          )}

          <fieldset className="student-data-fieldset">
            <legend>
              <Landmark size={13} /> Personal Circumstances
            </legend>
            <p className="student-data-section-description">
              Contextual background criteria used to calibrate your retention profile.
            </p>
            <SegmentedPill
              name="educationalSpecialNeeds"
              label="Educational special needs?"
            />
            <SegmentedPill
              name="tuitionFeeStatus"
              label="Tuition fees fully up to date?"
            />
            <SegmentedPill
              name="scholarshipStatus"
              label="Active academic scholarship recipient?"
            />
          </fieldset>

          <fieldset className="student-data-fieldset">
            <legend>
              <GraduationCap size={13} /> Academic Performance
            </legend>
            <p className="student-data-section-description">
              Enter your specific grade scale and unit breakdown from the previous semester.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem" }}>
              <div className="form-group">
                <label htmlFor="attendance">Study Schedule</label>
                <select
                  id="attendance"
                  name="attendance"
                  value={formData.attendance}
                  onChange={handleChange}
                  className={errors.attendance ? "input-error" : ""}
                >
                  <option value="">Select schedule</option>
                  <option value="day">Daytime Session</option>
                  <option value="night">Evening / Night Session</option>
                </select>
                {errors.attendance && <span className="field-error">{errors.attendance}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="gradeMaximum">Grade Metric Scale</label>
                <select
                  id="gradeMaximum"
                  name="gradeMaximum"
                  value={formData.gradeMaximum}
                  onChange={handleChange}
                  className={errors.gradeMaximum ? "input-error" : ""}
                >
                  <option value="4">4.0 Scale (GPA Standard)</option>
                  <option value="5">5.0 Scale (GWA Standard; 1.0 highest)</option>
                  <option value="20">20.0 Scale (European Standard)</option>
                  <option value="100">100.0 Scale (Percentage)</option>
                </select>
                {errors.gradeMaximum && <span className="field-error">{errors.gradeMaximum}</span>}
              </div>
            </div>

            <div className="student-data-grade-row">
              <div className="form-group">
                <label htmlFor="previousSemesterGrade">Previous-Semester Grade</label>
                <div className="input-affix-wrapper">
                  <input
                    type="number"
                    id="previousSemesterGrade"
                    name="previousSemesterGrade"
                    min={formData.gradeMaximum === "5" ? "1" : "0"}
                    max={formData.gradeMaximum || 100}
                    step="0.01"
                    placeholder={formData.gradeMaximum === "5" ? "1.00 - 5.00" : "0.00"}
                    value={formData.previousSemesterGrade}
                    onChange={handleChange}
                    className={errors.previousSemesterGrade ? "input-error" : ""}
                  />
                  <span className="input-affix-badge">/ {formData.gradeMaximum || "Scale"}</span>
                </div>
                {errors.previousSemesterGrade && (
                  <span className="field-error">{errors.previousSemesterGrade}</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="previousSemesterUnitsEnrolled">Units Enrolled</label>
                <div className="input-affix-wrapper">
                  <input
                    type="number"
                    id="previousSemesterUnitsEnrolled"
                    name="previousSemesterUnitsEnrolled"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="Total units"
                    value={formData.previousSemesterUnitsEnrolled}
                    onChange={handleChange}
                    className={errors.previousSemesterUnitsEnrolled ? "input-error" : ""}
                  />
                  <span className="input-affix-badge">units</span>
                </div>
                {errors.previousSemesterUnitsEnrolled && (
                  <span className="field-error">{errors.previousSemesterUnitsEnrolled}</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="previousSemesterUnitsApproved">Units Approved / Passed</label>
                <div className="input-affix-wrapper">
                  <input
                    type="number"
                    id="previousSemesterUnitsApproved"
                    name="previousSemesterUnitsApproved"
                    min="0"
                    max="100"
                    step="1"
                    placeholder="Passed units"
                    value={formData.previousSemesterUnitsApproved}
                    onChange={handleChange}
                    className={errors.previousSemesterUnitsApproved ? "input-error" : ""}
                  />
                  <span className="input-affix-badge">units</span>
                </div>
                {errors.previousSemesterUnitsApproved && (
                  <span className="field-error">{errors.previousSemesterUnitsApproved}</span>
                )}
              </div>
            </div>

            {unitStats && (
              <div className="live-completion-meter">
                <div className="live-completion-meter__info">
                  <span>Term Completion Rate</span>
                  <strong>
                    {unitStats.approved} of {unitStats.enrolled} units passed ({unitStats.rate}%)
                  </strong>
                </div>
                <div className="live-completion-meter__track">
                  <div
                    className="live-completion-meter__fill"
                    style={{
                      width: `${unitStats.rate}%`,
                      backgroundColor:
                        unitStats.rate >= 75
                          ? "#0c5bb4"
                          : unitStats.rate >= 50
                          ? "#eab308"
                          : "#ef4444",
                    }}
                  />
                </div>
              </div>
            )}
          </fieldset>

          <div className="student-data-submit-row">
            <p>
              <CircleHelp size={14} /> Confidential record protected for analytics and forecasting.
            </p>
            <div className="student-data-submit-actions">
              {savedRecord && (
                <button
                  type="button"
                  className="student-data-cancel"
                  onClick={() => {
                    setFormData(recordToForm(savedRecord));
                    setErrors({});
                    setServerError("");
                    setIsEditing(false);
                  }}
                >
                  Cancel
                </button>
              )}
              <button type="submit" className="dashboard-action" disabled={isSubmitting}>
                <Save size={14} /> {isSubmitting ? "Saving changes…" : "Save Information"}
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}