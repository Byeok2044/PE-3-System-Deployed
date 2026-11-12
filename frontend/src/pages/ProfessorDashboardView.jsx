import { useEffect, useState } from "react";
import { BarChart3, Database, Info, ShieldCheck, UsersRound } from "lucide-react";
import ConnectedStudentData from "../components/ConnectedStudentData.jsx";
import AcademicCsvImport from "../components/AcademicCsvImport.jsx";
import ClassForecastPanel from "../components/ClassForecastPanel.jsx";
import { useAuth } from "../context/AuthContext";
import useWorkspaceGuide from "../hooks/useWorkspaceGuide.js";
import "../styles/ProfessorWorkspace.css";

export default function ProfessorDashboardView({ user, activeTab }) {
  const { apiFetch } = useAuth();
  const [connections, setConnections] = useState([]);
  const [importRevision, setImportRevision] = useState(0);
  const [importedBatchId, setImportedBatchId] = useState('');
  const [classRunning, setClassRunning] = useState(false);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const {
    isOpen: isTutorialOpen,
    setIsOpen: setIsTutorialOpen,
    doNotShowAutomatically,
    setDoNotShowAutomatically,
  } = useWorkspaceGuide({
    role: "professor",
    user,
    enabled: activeTab === "data",
  });

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const response = await apiFetch("/api/connections");
        const data = await response.json().catch(() => ({}));
        if (response.ok && isMounted) setConnections(data.connections || []);
      } finally {
        if (isMounted) setIsLoadingConnections(false);
      }
    })();
    return () => { isMounted = false; };
  }, [apiFetch]);

  useEffect(() => {
    if (!isTutorialOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsTutorialOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isTutorialOpen]);

  if (activeTab === "history" || activeTab === "connections") return null;

  if (activeTab === "data") {
    return (
      <section className="workspace-section professor-workspace" id="data">
        <div className="section-heading data-workspace-heading">
          <div>
            <p className="dashboard-eyebrow">Class Workspace</p>
            <h2>Student Academic Records</h2>
          </div>
          <button
            type="button"
            className="data-workspace-help"
            onClick={() => setIsTutorialOpen((open) => !open)}
            aria-label={isTutorialOpen ? "Close professor data workspace tutorial" : "Open professor data workspace tutorial"}
            aria-expanded={isTutorialOpen}
            aria-controls={isTutorialOpen ? "professor-data-tutorial" : undefined}
          >
            <Info size={19} aria-hidden="true" />
          </button>
        </div>

        <p className="dashboard-subtext">Upload semester records, run class forecasts, and review the information shared by your connected students.</p>
        <div className="professor-workspace-panels">
        <AcademicCsvImport
          disabled={classRunning}
          onImported={(result) => {
            setImportedBatchId(result.batchId);
            setImportRevision((value) => value + 1);
          }}
        />
        <ClassForecastPanel
          importedBatchId={importedBatchId}
          onRunningChange={setClassRunning}
          onCompleted={() => setImportRevision((value) => value + 1)}
        />
        <ConnectedStudentData key={importRevision} />
        </div>

        {isTutorialOpen && (
          <div
            className="academic-tutorial-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsTutorialOpen(false);
            }}
          >
            <section
              id="professor-data-tutorial"
              className="academic-tutorial-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="professor-data-tutorial-title"
              aria-describedby="professor-data-tutorial-description"
            >
              <div className="academic-tutorial-header">
                <span className="dashboard-eyebrow">Professor Data Workspace Guide</span>
                <h2 id="professor-data-tutorial-title">Managing Student Records</h2>
                <p id="professor-data-tutorial-description">
                  Import academic records, run class forecasts, and review the information shared by your connected students.
                </p>
              </div>

              <ol className="academic-tutorial-steps">
                <li>
                  <h3>Check Connections and the Source Period</h3>
                  <p>
                    A student must have an accepted connection and designate you as their academic provider for the
                    source semester before their record can be imported.
                  </p>
                </li>
                <li>
                  <h3>Prepare a CSV File</h3>
                  <p>
                    Download the CSV template for the required columns or the sample CSV to see an example, then review
                    the format instructions. Use one source semester per file,
                    with up to 500 students and a maximum file size of 1 MB. Include the student email, academic year,
                    semester, previous grade and maximum, enrolled and approved units, and attendance (day or evening).
                    The optional Section / Block label helps you find the import later. The correction reason is optional
                    for initial uploads and required when modifying existing records.
                  </p>
                </li>
                <li>
                  <h3>Validate, Review, and Confirm the Import</h3>
                  <p>
                    Choose the CSV, optionally select <strong>Skip invalid rows</strong> to import only eligible records,
                    then select <strong>Validate and Preview</strong>. Review proposed changes, row errors, and the eligible
                    and skipped counts. When the preview allows confirmation, select <strong>Confirm Import</strong> to
                    save the eligible records as a batch. The preview has an expiry time.
                  </p>
                </li>
                <li>
                  <h3>Run Class Forecasts</h3>
                  <p>
                    Select a confirmed import in <strong>Class Forecasts</strong>. Students need complete personal
                    information and an active connection with you as their academic provider. Select
                    <strong> Run Attrition Risk for This Class</strong> to start; the results show progress, risk levels,
                    estimated dropout probabilities, predicted grades, and per-student status. Keep the page open while
                    a run is active. You can pause and resume, retry failed students, filter or search results, and
                    download a results CSV.
                  </p>
                </li>
                <li>
                  <h3>Review Connected Student Records</h3>
                  <p>
                    Search students by name or email. Check their readiness, source period, academic record, and current
                    forecast. When provider-transfer controls are available, use them to offer or accept a transfer.
                    Treat forecasts as context for supportive conversations, not as labels or the sole basis for decisions.
                  </p>
                </li>
              </ol>

              <div className="academic-tutorial-footer">
                <label className="academic-tutorial-opt-out">
                  <input
                    type="checkbox"
                    checked={doNotShowAutomatically}
                    onChange={(event) => setDoNotShowAutomatically(event.target.checked)}
                  />
                  <span>Don't show this guide automatically again</span>
                </label>
                <button type="button" className="dashboard-action" onClick={() => setIsTutorialOpen(false)}>
                  Close
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    );
  }

  if (activeTab === "insights") {
    return <section className="dashboard-guidance" id="insights"><ShieldCheck size={21} /><p><strong>Use class insights to support, not label, students.</strong> Review course context, attendance, and recent work before responding to a risk signal or forecast.</p></section>;
  }

  const connectedStudents = connections.filter((connection) => connection.status === "accepted");
  const pendingRequests = connections.filter((connection) => connection.status === "pending");

  return <>
    <section className="dashboard-intro" id="overview"><p className="dashboard-eyebrow">{user.institution || "Your academic workspace"}</p><h1>Welcome, Professor {user?.fullName ? user.fullName.split(" ")[0] : ""}.</h1><p>{connectedStudents.length > 0 ? "Your connected students are ready to review in the Data Workspace. Continue using their information as context for supportive academic conversations." : "Monitor the learners and courses assigned to you. Approve student connection requests to begin reviewing the records they choose to share."}</p></section>
    <section className="dashboard-summary" aria-label="Class workspace status"><article><span className="summary-icon blue"><UsersRound size={19} /></span><div><strong>{isLoadingConnections ? "—" : connectedStudents.length}</strong><small>Connected students</small></div></article><article><span className="summary-icon amber"><BarChart3 size={19} /></span><div><strong>{isLoadingConnections ? "—" : pendingRequests.length}</strong><small>Requests to review</small></div></article><article><span className="summary-icon green"><Database size={19} /></span><div><strong>{isLoadingConnections ? "Checking…" : connectedStudents.length ? "Available" : "No records yet"}</strong><small>Student data access</small></div></article></section>
    {connectedStudents.length > 0 && <section className="professor-overview-connections" aria-labelledby="connected-overview-title"><div><p className="dashboard-eyebrow">Connected now</p><h2 id="connected-overview-title">Students who shared data with you</h2></div><ul>{connectedStudents.slice(0, 4).map((connection) => <li key={connection.id}><span className="connection-avatar" aria-hidden="true">{connection.student.fullName.split(" ").map((name) => name[0]).slice(0, 2).join("")}</span><div><strong>{connection.student.fullName}</strong><small>Connection active</small></div></li>)}</ul>{connectedStudents.length > 4 && <p className="professor-overview-connections__more">Plus {connectedStudents.length - 4} more connected student{connectedStudents.length - 4 === 1 ? "" : "s"}.</p>}</section>}
  </>;
}
