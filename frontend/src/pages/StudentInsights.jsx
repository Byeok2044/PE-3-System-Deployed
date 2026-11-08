import { useEffect, useState } from "react";
import { BarChart3, Play, RefreshCw, ShieldCheck, Sparkles, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import RiskExplanation from "../components/RiskExplanation.jsx";

const scheduleToApi = (attendance) => (attendance === "day" ? "day" : "night");
const TRACER_ANIMATION_DURATION_MS = 3000; // 3.0s exact full-perimeter trace

export default function StudentInsights({ onForecastComplete, latestForecast }) {
  const { apiFetch } = useAuth();
  const [record, setRecord] = useState(null);
  const [loadingRecord, setLoadingRecord] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [prediction, setPrediction] = useState(latestForecast?.forecast || null);
  const [insight, setInsight] = useState(null);
  const [gettingInsight, setGettingInsight] = useState(false);

  useEffect(() => {
    setPrediction(latestForecast?.forecast || null);
    setInsight(null);
  }, [latestForecast]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await apiFetch("/api/students/me");
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Your academic record could not be loaded.");
        if (active) setRecord(data.record);
      } catch (requestError) {
        if (active) setError(requestError.message || "Your academic record could not be loaded.");
      } finally {
        if (active) setLoadingRecord(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiFetch]);

  const runForecast = async () => {
    if (!record) return;
    setRunning(true);
    setError("");
    try {
      const response = await apiFetch("/api/ml/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          educationalSpecialNeeds: record.educationalSpecialNeeds,
          tuitionFeeStatus: record.tuitionFeeStatus,
          scholarshipStatus: record.scholarshipStatus,
          studySchedule: scheduleToApi(record.attendance),
          previousSemesterUnitsEnrolled: record.previousSemesterUnitsEnrolled,
          previousSemesterUnitsApproved: record.previousSemesterUnitsApproved,
          previousSemesterGrade: record.previousSemesterGrade,
          gradeMaximum: record.gradeMaximum || 20,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.message || "Your forecast could not be generated.");
      setPrediction(data);
      setInsight(null);
      onForecastComplete?.({ forecast: data, record, createdAt: new Date().toISOString() });
    } catch (requestError) {
      setError(requestError.message || "Your forecast could not be generated.");
    } finally {
      setRunning(false);
    }
  };

  const getSupportInsight = async () => {
    setGettingInsight(true);
    setError("");

    // Timer promise that resolves exactly when the outline finishes filling
    const animationPromise = new Promise((resolve) =>
      setTimeout(resolve, TRACER_ANIMATION_DURATION_MS)
    );

    // API fetch promise
    const fetchPromise = apiFetch("/api/insights/student-support", { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Support suggestions could not be generated.");
        return data;
      });

    try {
      // Wait for BOTH the perimeter line to complete 100% and the API call
      const [, data] = await Promise.all([animationPromise, fetchPromise]);
      setInsight(data.insight);
    } catch (requestError) {
      setError(requestError.message || "Support suggestions could not be generated.");
    } finally {
      setGettingInsight(false);
    }
  };

  if (loadingRecord) return <p className="student-data-loading">Loading your academic record…</p>;
  if (!record) {
    return (
      <section className="workspace-section">
        <div className="section-heading">
          <div>
            <p className="dashboard-eyebrow">Your forecast</p>
            <h2>Add your semester record first</h2>
          </div>
        </div>
        <p className="dashboard-subtext">
          Save your study schedule, units, and previous-semester grade in Data Workspace to generate a forecast.
        </p>
      </section>
    );
  }

  const completionPercent = prediction && Math.round(prediction.completionRate * 100);
  const dropoutPercent = prediction && Math.round(prediction.dropoutProbability * 100);

  return (
    <section
      className={`workspace-section insights-container ${gettingInsight ? "insights-loading-active" : ""}`}
      id="insights"
    >
      {/* Perimeter Progressive Fill SVG Tracer */}
      {gettingInsight && (
        <svg className="insights-border-fill-tracer" aria-hidden="true">
          <rect
            x="2"
            y="2"
            width="calc(100% - 4px)"
            height="calc(100% - 4px)"
            rx="10"
            ry="10"
            pathLength="100"
          />
        </svg>
      )}

      {/* Blurred Center Loading Overlay */}
      {gettingInsight && (
        <div className="insights-blur-overlay">
          <div className="insights-loading-spinner-box">
            <Loader2 size={38} className="insights-spin-icon" />
            <h3>Analyzing Academic Profile</h3>
            <p>Please wait while AI constructs personalized support recommendations...</p>
          </div>
        </div>
      )}

      <div className="section-heading">
        <div>
          <p className="dashboard-eyebrow">Your forecast</p>
          <h2>{prediction ? "Next-semester outlook" : "Ready when you are"}</h2>
        </div>
      </div>
      <p className="dashboard-subtext">
        {prediction ? "Your latest saved forecast is shown below. Run a new forecast after updating your academic record. " : "Run a forecast from your saved academic record. "}
        Each completed forecast is added to your History so you can compare it later.
      </p>

      {error && <div className="login-alert" role="alert">{error}</div>}

      <button
        type="button"
        className="dashboard-action"
        onClick={runForecast}
        disabled={running || gettingInsight}
      >
        {running ? <RefreshCw size={16} className="forecast-spin" /> : <Play size={16} />}
        {running ? "Running forecast…" : prediction ? "Run a new forecast" : "Run my forecast"}
      </button>

      {prediction && (
        <>
          <div className="dashboard-summary forecast-results" aria-label="Forecast results">
            <article>
              <span className="summary-icon blue"><BarChart3 size={19} /></span>
              <div>
                <strong>{prediction.predictedNextSemesterGrade} / {prediction.gradeMaximum}</strong>
                <small>Predicted next-semester grade</small>
              </div>
            </article>
            <article>
              <span className="summary-icon amber"><ShieldCheck size={19} /></span>
              <div>
                <strong>{dropoutPercent}%</strong>
                <small>Estimated dropout probability</small>
              </div>
            </article>
            <article>
              <span className="summary-icon green"><BarChart3 size={19} /></span>
              <div>
                <strong>{completionPercent}%</strong>
                <small>Previous-semester completion rate</small>
              </div>
            </article>
          </div>

          <section className="dashboard-guidance">
            <ShieldCheck size={21} />
            <p>
              <strong>{prediction.riskLevel[0].toUpperCase() + prediction.riskLevel.slice(1)} support risk.</strong> This is a forecast, not a decision or diagnosis. Discuss it with an adviser or professor to identify useful support early.
            </p>
          </section>

          <RiskExplanation explanation={prediction.riskExplanation} />

          <button
            type="button"
            className="dashboard-action support-insight-button"
            onClick={getSupportInsight}
            disabled={gettingInsight}
          >
            {gettingInsight ? <RefreshCw size={16} className="forecast-spin" /> : <Sparkles size={16} />}
            {gettingInsight ? "Creating suggestions…" : "Get support suggestions"}
          </button>

          {insight && (
            <section className="support-insight" aria-labelledby="support-insight-title">
              <h3 id="support-insight-title"><Sparkles size={18} /> Your explanation and next steps</h3>
              <p>{insight.summary}</p>
              {insight.explanationStatus === "unavailable" && (
                <p>Model-based reasons are unavailable for this saved forecast. Run a new forecast before requesting a detailed risk explanation.</p>
              )}
              {insight.riskReasons?.length > 0 && (
                <>
                  <h4>Why the model raised your risk estimate</h4>
                  <ul>{insight.riskReasons.map((item) => (
                    <li key={item.factorKey}><strong>{item.factorLabel}:</strong> {item.explanation}</li>
                  ))}</ul>
                </>
              )}
              {insight.protectiveFactors?.length > 0 && (
                <>
                  <h4>What lowered your risk estimate</h4>
                  <ul>{insight.protectiveFactors.map((item) => (
                    <li key={item.factorKey}><strong>{item.factorLabel}:</strong> {item.explanation}</li>
                  ))}</ul>
                </>
              )}
              {insight.strengths?.length > 0 && (
                <>
                  <h4>Strengths to build on</h4>
                  <ul>
                    {insight.strengths.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              )}
              {insight.suggestedActions?.length > 0 && (
                <>
                  <h4>Actions you can take</h4>
                  <ul>
                    {insight.suggestedActions.map((item, index) => (
                      <li key={`${item.factorKey || "legacy"}-${index}`}>
                        {typeof item === "string" ? item : <><strong>{item.factorLabel}:</strong> {item.action}</>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {insight.discussionQuestions?.length > 0 && (
                <>
                  <h4>Questions to discuss with your adviser</h4>
                  <ul>{insight.discussionQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
                </>
              )}
              <p className="support-insight__disclaimer">{insight.disclaimer}</p>
            </section>
          )}
        </>
      )}
    </section>
  );
}
