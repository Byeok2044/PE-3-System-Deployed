import { useEffect, useState } from "react";
import { BarChart3, Database, ShieldCheck, UsersRound } from "lucide-react";
import ConnectedStudentData from "../components/ConnectedStudentData.jsx";
import AcademicCsvImport from "../components/AcademicCsvImport.jsx";
import { useAuth } from "../context/AuthContext";

export default function ProfessorDashboardView({ user, activeTab }) {
  const { apiFetch } = useAuth();
  const [connections, setConnections] = useState([]);
  const [importRevision, setImportRevision] = useState(0);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);

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

  if (activeTab === "history" || activeTab === "connections") return null;

  if (activeTab === "data") {
    return <section className="workspace-section academic-workspace" id="data"><div className="section-heading"><div><p className="dashboard-eyebrow">Class workspace</p><h2>Student academic records</h2></div></div><AcademicCsvImport onImported={() => setImportRevision(value => value + 1)} /><ConnectedStudentData key={importRevision} /></section>;
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
