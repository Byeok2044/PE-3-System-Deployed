import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Database,
  History as HistoryIcon,
  Info,
  LayoutDashboard,
  LogOut,
  Search,
  ShieldCheck,
  Sparkles,
  Table,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UsersRound,
  MessageCircle,
  X,
  AlertOctagon,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import AcademicTrajectoryChart from "../components/AcademicTrajectoryChart.jsx";
import { useAuth } from "../context/AuthContext";
import BrandLogo from "../components/BrandLogo";
import "../styles/Dashboard.css";

import HistoryView from "./HistoryView.jsx";
import StudentDataForm from "./StudentDataForm.jsx";
import ConnectionManager from "../components/ConnectionManager.jsx";
import StudentInsights from "./StudentInsights.jsx";
import MessageCenter from "../components/MessageCenter.jsx";
import Profile from './Profile.jsx';
import useAdaptivePolling from "../hooks/useAdaptivePolling.js";
import useWorkspaceGuide from "../hooks/useWorkspaceGuide.js";
import ProfessorDashboardView from "./ProfessorDashboardView.jsx";
import ProfessorHistoryView from "./ProfessorHistoryView.jsx";

// Route-aware count-up animation hook
function useCountUp(target, triggerKey, duration = 1200) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setCount(0);
      return;
    }

    const finalVal = Math.round(target);
    if (finalVal === 0) {
      setCount(0);
      return;
    }

    setCount(0);

    let animationFrameId;
    const startTime = performance.now();

    const updateCount = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(easeOut * finalVal));

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(updateCount);
      }
    };

    animationFrameId = requestAnimationFrame(updateCount);

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [target, triggerKey, duration]);

  return count;
}

function AdminDashboardView({ user, nextStep }) {
  return (
    <section className="workspace-section" id="admin-overview">
      <div className="section-heading">
        <div>
          <p className="dashboard-eyebrow">Institutional Administration</p>
          <h2>Admin Command Center</h2>
        </div>
      </div>
      <p className="dashboard-subtext">
        Manage institutional cohorts, review overall attrition datasets, and configure system rules.
      </p>
      {nextStep && (
        <div className="dashboard-guidance">
          <p>
            <strong>Next Step:</strong> {nextStep.detail}
          </p>
        </div>
      )}
    </section>
  );
}

const NEXT_STEPS_BY_ROLE = {
  administrator: {
    label: "Prepare student data",
    detail: "Upload a validated institutional data file to begin creating an overview.",
    action: "Prepare data",
  },
  professor: {
    label: "Review student caseload",
    detail: "Automated alerts flag students at immediate risk of attrition or probation.",
    action: "Review alerts",
  },
  student: {
    label: "Review your academic record",
    detail: "Review your professor-uploaded record, complete your personal information, then run a forecast.",
    action: "Save your record",
  },
};

const TAB_BY_PATH = {
  "/dashboard": "overview",
  "/dashboard/data": "data",
  "/dashboard/insights": "insights",
  "/dashboard/history": "history",
  "/dashboard/connections": "connections",
  "/dashboard/messages": "messages",
};

const riskLevelFromForecast = (riskLevel, dropoutProbability) => {
  const normalized = String(riskLevel || "").toLowerCase();
  if (["low", "medium", "high"].includes(normalized)) return normalized;

  const probability = Number(dropoutProbability);
  if (!Number.isFinite(probability)) return null;
  if (probability >= 0.4) return "high";
  if (probability >= 0.2) return "medium";
  return "low";
};

const riskLabel = (riskLevel) =>
  riskLevel ? `${riskLevel[0].toUpperCase()}${riskLevel.slice(1)} Risk` : "Forecast Pending";
const percentage = (value) =>
  Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "—";

export function evaluateGrade(rawGradeNum, scaleType) {
  const scale = String(scaleType);
  let isAtRisk = false;
  let label = "";
  let passingCutoff = 2.0;
  let chartDomain = [1.0, 4.0];
  let isReversed = false;
  if (scale === "100") {
    passingCutoff = 75.0; 
    chartDomain = [50, 100]; 
    isAtRisk = rawGradeNum < 75.0; 
    label = `${rawGradeNum} / 100`;
  } else if (scale === "20") {
    passingCutoff = 10.0; 
    chartDomain = [0, 20]; 
    isAtRisk = rawGradeNum < 10.0; 
    label = `${rawGradeNum} / 20`;
  } else if (scale === "5-inv" || scale === "5") {
    passingCutoff = 3.0; 
    chartDomain = [1.0, 5.0]; 
    isReversed = true; 
    isAtRisk = rawGradeNum > 3.0;
    label = `${rawGradeNum.toFixed(2)} / 5.00 (1.0 Highest)`;
  } else {
    isAtRisk = rawGradeNum < 2.0; 
    label = `${rawGradeNum.toFixed(2)} / 4.00`;
  }
  return { isAtRisk, label, passingCutoff, chartDomain, isReversed };
}

function DashboardNavLink({ tab, currentTab, children }) {
  const path = tab === "overview" ? "/dashboard" : `/dashboard/${tab}`;
  return (
    <NavLink
      to={path}
      end={tab === "overview"}
      className={({ isActive }) => (isActive ? "active" : "")}
      aria-current={currentTab === tab ? "page" : undefined}
    >
      {children}
    </NavLink>
  );
}

function AdvisorDashboardModule({ user }) {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();
  const [connectedStudentsData, setConnectedStudentsData] = useState([]);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [filterRisk, setFilterRisk] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useAdaptivePolling(async () => {
    try {
      const [connectionResponse, studentsResponse] = await Promise.all([
        apiFetch("/api/connections"),
        apiFetch("/api/professor/students"),
      ]);
      if (!connectionResponse.ok || !studentsResponse.ok) throw new Error("Could not refresh connected students.");
      const [connectionData, studentData] = await Promise.all([
        connectionResponse.json(), 
        studentsResponse.json()
      ]);
      setPendingRequestsCount((connectionData.connections || []).filter((item) => item.status === "pending").length);
      setConnectedStudentsData(studentData.students || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, { intervalMs: 15000 });

  const formattedStudents = useMemo(() => {
    return connectedStudentsData.map(({ student, record, forecast }) => {
      const riskLevel = forecast
        ? riskLevelFromForecast(forecast.riskLevel, forecast.dropoutProbability)
        : null;
      const dropoutProbability = Number(forecast?.dropoutProbability);

      return {
        id: String(student.id || student._id),
        name: student.fullName || "Unknown Student",
        email: student.email || "",
        gpa: record ? `${record.previousSemesterGrade} / ${record.gradeMaximum}` : "N/A",
        rawGrade: record ? Number(record.previousSemesterGrade) : null,
        gradeMaximum: record?.gradeMaximum || forecast?.gradeMaximum || "4.0",
        attendance: record ? (record.attendance === "day" ? "Day" : "Night") : "N/A",
        riskScore: Number.isFinite(dropoutProbability) ? percentage(dropoutProbability) : "—",
        riskLevel,
        predictedGrade: forecast ? `${forecast.predictedNextSemesterGrade} / ${forecast.gradeMaximum}` : "N/A",
        rawPredictedGrade: forecast ? Number(forecast.predictedNextSemesterGrade) : null,
        forecastDate: forecast?.createdAt ? new Date(forecast.createdAt).toLocaleDateString() : null,
      };
    });
  }, [connectedStudentsData]);

  const forecastedStudents = formattedStudents.filter((student) => student.riskLevel);
  const riskCount = (level) => forecastedStudents.filter((student) => student.riskLevel === level).length;
  const riskShare = (level) =>
    forecastedStudents.length ? percentage(riskCount(level) / forecastedStudents.length) : "—";

  const filteredStudents = useMemo(() => {
    return formattedStudents.filter((stu) => {
      const matchesRisk = filterRisk === "all" || stu.riskLevel === filterRisk;
      const matchesSearch =
        stu.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        stu.id.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesRisk && matchesSearch;
    });
  }, [formattedStudents, filterRisk, searchTerm]);

  useEffect(() => {
    if (!selectedStudentId && formattedStudents.length > 0) {
      setSelectedStudentId(formattedStudents[0].id);
    }
  }, [formattedStudents, selectedStudentId]);

  const selectedStudent = useMemo(() => {
    return formattedStudents.find((s) => s.id === selectedStudentId) || null;
  }, [formattedStudents, selectedStudentId]);

  const handleCardFilterClick = (tier) => {
    setFilterRisk((prev) => (prev === tier ? "all" : tier));
  };

  if (loading) return <p className="connected-students-loading">Loading professor dashboard...</p>;
  if (error) return <p className="connected-students-error" role="alert">{error}</p>;

  const selectedGradeDetails =
    selectedStudent && selectedStudent.rawGrade !== null
      ? evaluateGrade(selectedStudent.rawGrade, selectedStudent.gradeMaximum)
      : null;

  return (
    <div className="advisor-dashboard">
      <section className="dashboard-intro">
        <p className="dashboard-eyebrow">{user.institution || "Advisory Caseload Workspace"}</p>
        <h1>Advisor Command Center</h1>
        <p>
          Monitor cohort risk levels, review pending requests, and inspect academic trajectories for connected students.
        </p>
      </section>

      {/* 2-Column Responsive Metric Cards */}
      <section className="advisor-summary-grid">
        <div
          className={`summary-card clickable ${filterRisk === "high" ? "active-filter border-red" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => handleCardFilterClick("high")}
          onKeyDown={(e) => e.key === "Enter" && handleCardFilterClick("high")}
          title="Click to filter by High Risk"
        >
          <div className="card-icon red"><AlertTriangle size={20} /></div>
          <div className="card-details">
            <span className="card-value">
              {riskCount("high")} ({riskShare("high")})
            </span>
            <span className="card-label">High Risk</span>
            <small>High risk: 40%+ dropout probability</small>
          </div>
        </div>

        <div
          className={`summary-card clickable ${filterRisk === "medium" ? "active-filter border-amber" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => handleCardFilterClick("medium")}
          onKeyDown={(e) => e.key === "Enter" && handleCardFilterClick("medium")}
          title="Click to filter by Medium Risk"
        >
          <div className="card-icon amber"><TrendingDown size={20} /></div>
          <div className="card-details">
            <span className="card-value">
              {riskCount("medium")} ({riskShare("medium")})
            </span>
            <span className="card-label">Medium Risk</span>
            <small>Medium risk: 20–39% dropout probability</small>
          </div>
        </div>

        <div
          className={`summary-card clickable ${filterRisk === "low" ? "active-filter border-green" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => handleCardFilterClick("low")}
          onKeyDown={(e) => e.key === "Enter" && handleCardFilterClick("low")}
          title="Click to filter by Low Risk"
        >
          <div className="card-icon green"><UserCheck size={20} /></div>
          <div className="card-details">
            <span className="card-value">
              {riskCount("low")} ({riskShare("low")})
            </span>
            <span className="card-label">Low Risk</span>
            <small>Low risk: below 20% dropout probability</small>
          </div>
        </div>

        <div
          className={`summary-card clickable ${filterRisk === "all" ? "active-filter border-blue" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => setFilterRisk("all")}
          onKeyDown={(e) => e.key === "Enter" && setFilterRisk("all")}
          title="Click to view all students"
        >
          <div className="card-icon blue"><UsersRound size={20} /></div>
          <div className="card-details">
            <span className="card-value">{connectedStudentsData.length}</span>
            <span className="card-label">Total Students</span>
            <small>Connected active students</small>
          </div>
        </div>

        <div
          className="summary-card clickable"
          role="button"
          tabIndex={0}
          onClick={() => navigate("/dashboard/connections")}
          onKeyDown={(e) => e.key === "Enter" && navigate("/dashboard/connections")}
          title="Click to review and manage pending connection requests"
        >
          <div className="card-icon silver"><Clock size={20} /></div>
          <div className="card-details">
            <span className="card-value">{pendingRequestsCount}</span>
            <span className="card-label">Pending Requests</span>
            <small>Click to review approvals</small>
          </div>
        </div>
      </section>

      {/* Caseload Performance Table */}
      <section className="workspace-section">
        <div className="section-heading">
          <div>
            <p className="dashboard-eyebrow">Connected Student Performance</p>
            <h2>Attrition Risk and Academic Overview</h2>
          </div>
        </div>

        <div className="caseload-controls">
          <div className="search-box">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search student name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {filterRisk !== "all" && (
            <button
              type="button"
              className="action-button secondary"
              onClick={() => setFilterRisk("all")}
              style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            >
              Reset Filter ({filterRisk.toUpperCase()}) ×
            </button>
          )}
        </div>

        {formattedStudents.length === 0 ? (
          <div className="connected-students-empty">
            <BookOpen size={20} />
            <p>
              No connected students from {user.institution || "your institution"} yet. Approve connection requests to view student records here.
            </p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="student-search-empty-state">
            <p>No students match the current filter ({filterRisk.toUpperCase()} risk).</p>
            <button
              type="button"
              className="action-button secondary"
              onClick={() => {
                setFilterRisk("all");
                setSearchTerm("");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="tabular-student-container">
            <table className="student-metrics-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Student Name</th>
                  <th>Current Grade</th>
                  <th>Attrition Risk</th>
                  <th>Inspection</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student, idx) => {
                  const isSelected = selectedStudentId === student.id;
                  return (
                    <tr
                      key={student.id}
                      className={isSelected ? "row-selected-highlight" : ""}
                      onClick={() => setSelectedStudentId(student.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{idx + 1}</td>
                      <td>
                        <strong>{student.name}</strong>
                      </td>
                      <td><strong>{student.gpa}</strong></td>
                      <td>
                        <span className={`risk-pill ${student.riskLevel || "pending"}`}>
                          {student.riskScore} {student.riskLevel ? `· ${riskLabel(student.riskLevel)}` : "· Forecast pending"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`action-button secondary ${isSelected ? "active-inspection-btn" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStudentId(student.id);
                          }}
                        >
                          {isSelected ? "Inspecting Graph" : "Inspect Trajectory"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Static Dedicated Fixed Graph Card (Matches Student View) */}
      {selectedStudent && (
        <section className="workspace-section professor-trajectory-view" style={{ marginTop: "0.5rem" }}>
          <div className="section-heading">
            <div>
              <p className="dashboard-eyebrow">Predictive Outlook</p>
              <h2>{selectedStudent.name}&apos;s Academic Trajectory Graph</h2>
            </div>
            <span className="student-inspect-tag">Inspecting Student</span>
          </div>

          {selectedGradeDetails !== null ? (
            <div style={{ marginTop: "1rem" }}>
              <div className={`alert-banner ${!selectedGradeDetails.isAtRisk ? "banner-safe" : ""}`}>
                <Sparkles size={16} />
                <div>
                  {selectedGradeDetails.isAtRisk ? (
                    <>
                      <strong>Warning:</strong> Recorded grade (<strong>{selectedGradeDetails.label}</strong>) is currently below the institutional retention cutoff of {selectedGradeDetails.passingCutoff}.
                    </>
                  ) : (
                    <>
                      <strong>On Track:</strong> Recorded grade (<strong>{selectedGradeDetails.label}</strong>) indicates satisfactory academic progress.
                    </>
                  )}
                </div>
              </div>

              <div className="expanded-trajectory-wrapper professor-graph-card" style={{ marginTop: "1rem" }}>
                <div className="trajectory-header">
                  <TrendingUp size={18} color="#0c5bb4" />
                  <h4>Academic Performance Trajectory Forecast ({selectedStudent.gradeMaximum} Scale)</h4>
                </div>
                <p className="chart-subtext">
                  {selectedStudent.rawPredictedGrade !== null
                    ? `ML-service forecast generated ${selectedStudent.forecastDate || "previously"}`
                    : "Historical academic record (no ML forecast available)"}
                  . Forecast period: {selectedStudent.rawPredictedGrade !== null ? "next term" : "not available"}.
                </p>

                <div className="trajectory-content">
                  <AcademicTrajectoryChart
                    currentGrade={selectedStudent.rawGrade}
                    predictedGrade={selectedStudent.rawPredictedGrade !== null ? selectedStudent.rawPredictedGrade : undefined}
                    gradeDetails={selectedGradeDetails}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ minHeight: "160px" }}>
              <div className="empty-illustration">
                <TrendingUp size={24} />
              </div>
              <div>
                <h3>No Academic Trajectory Available</h3>
                <p>
                  No prior semester grade records uploaded for {selectedStudent.name}. Upload the student record through CSV in the Data Workspace first.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user, apiFetch, sessionError, retrySession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) {
    return (
      <div
        className="app-shell"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}
      >
        <p>Loading dashboard...</p>
      </div>
    );
  }

  const [studentRecord, setStudentRecord] = useState(null);
  const [latestForecast, setLatestForecast] = useState(null);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const closeProfile = useCallback(() => setShowProfile(false), []);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isInflating, setIsInflating] = useState(false);
  const [isPopped, setIsPopped] = useState(false);
  const [showPopModal, setShowPopModal] = useState(false);
  const popTimerRef = useRef(null);

  const activeTab = TAB_BY_PATH[location.pathname] || "overview";
  const {
    isOpen: isDataTutorialOpen,
    setIsOpen: setIsDataTutorialOpen,
    doNotShowAutomatically,
    setDoNotShowAutomatically,
  } = useWorkspaceGuide({
    role: "student",
    user,
    enabled: user.role === "student" && activeTab === "data",
  });

  useEffect(() => {
    if (location.pathname === '/dashboard/profile') {
      setShowProfile(true);
      navigate('/dashboard', { replace: true });
    }
  }, [location.pathname, navigate]);

  const nextStep = NEXT_STEPS_BY_ROLE[user?.role] ?? NEXT_STEPS_BY_ROLE.student;
  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "User";

  const fetchUnread = useCallback(async () => {
    const response = await apiFetch("/api/messages/unread-count");
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    if (Number.isFinite(data.unreadCount)) setUnreadMessagesCount(data.unreadCount);
  }, [apiFetch]);

  useAdaptivePolling(fetchUnread, {
    intervalMs: 3000,
    hiddenIntervalMs: 20000,
    enabled: activeTab !== "messages",
  });

  const processAndStoreRecord = useCallback((record, workspace) => {
    setStudentRecord(record || null);
    if (workspace) setLatestForecast(workspace.latestForecast || null);
  }, []);

  useAdaptivePolling(async () => {
    const response = await apiFetch("/api/students/me");
    if (!response.ok) return;
    const data = await response.json();
    setStudentRecord(data.record || null);
    setLatestForecast(data.latestForecast || null);
  }, { intervalMs: 15000, enabled: user?.role === "student" });

  const handleForecastCompleted = useCallback((forecastRun) => {
    setLatestForecast(forecastRun);
  }, []);

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleConfirmLogout = () => {
    setShowLogoutModal(false);
    navigate("/logout", { replace: true });
  };

  const handleCloseLogoutModal = () => {
    setShowLogoutModal(false);
  };

  const userInitials = user?.fullName
    ? user.fullName
        .split(" ")
        .map((name) => name[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  const firstName = user?.fullName ? user.fullName.split(" ")[0] : "Student";
  const hasConnectionAccess = user?.role === "student" || user?.role === "professor";

  const trajectoryRecord = latestForecast?.record || studentRecord || null;
  const rawGradeNum = trajectoryRecord ? Number(trajectoryRecord.previousSemesterGrade) : null;
  const forecastedGrade = Number(latestForecast?.forecast?.predictedNextSemesterGrade);
  const hasForecast = Number.isFinite(forecastedGrade);
  const forecastRiskLevel = riskLevelFromForecast(
    latestForecast?.forecast?.riskLevel,
    latestForecast?.forecast?.dropoutProbability
  );
  const hasForecastRisk = Boolean(forecastRiskLevel);
  const forecastIsAtRisk = ["medium", "high"].includes(forecastRiskLevel);
  const dropoutProbability = Number(latestForecast?.forecast?.dropoutProbability);

  const exactDropoutPercent = Number.isFinite(dropoutProbability)
    ? Math.round(dropoutProbability * 100)
    : 0;

  const animatedPercentage = useCountUp(exactDropoutPercent, location.pathname);

  const gradeScaleType = latestForecast?.forecast?.gradeMaximum || trajectoryRecord?.gradeMaximum;
  const gradeDetails =
    rawGradeNum !== null && !Number.isNaN(rawGradeNum)
      ? evaluateGrade(rawGradeNum, gradeScaleType)
      : null;

  const projectedGradeDetails =
    hasForecast
      ? evaluateGrade(forecastedGrade, gradeScaleType)
      : null;

  const forecastPeriod = latestForecast?.createdAt
    ? new Date(latestForecast.createdAt).toLocaleDateString()
    : null;
  const trajectorySource = hasForecast
    ? `ML-service forecast generated ${forecastPeriod || "previously"}`
    : "Historical academic record (no ML forecast available)";

  const alertCardColor = (() => {
    if (hasForecastRisk) {
      if (forecastRiskLevel === "high") return "red";
      if (forecastRiskLevel === "medium") return "amber";
      return "green";
    }
    if (gradeDetails?.isAtRisk) return "red";
    return "green";
  })();

  const handleMouseEnterRisk = () => {
    setIsInflating(true);
    popTimerRef.current = setTimeout(() => {
      setIsPopped(true);
      setTimeout(() => {
        setShowPopModal(true);
        setIsInflating(false);
        setIsPopped(false);
      }, 350);
    }, 5000);
  };

  const handleMouseLeaveRisk = () => {
    if (popTimerRef.current) {
      clearTimeout(popTimerRef.current);
    }
    setIsInflating(false);
  };

  const getPopModalContent = () => {
    if (alertCardColor === "red") {
      return {
        title: "Urgent: Academic Action Required",
        message: "You have triggered a high academic attrition risk threshold. Please immediately settle pending laboratory submissions, resolve unexcused absences, and book an academic advisement consultation with your program chair.",
        action: "Chat your professor",
      };
    }
    if (alertCardColor === "amber") {
      return {
        title: "Advisory: Moderate Risk Notice",
        message: "Your trajectory indicates potential probationary standing if courses are not completed this semester. Review course requirements and connect with your professors.",
        action: "Open Student Messages",
      };
    }
    return {
      title: "Good Standing: On Track",
      message: "Your academic standing and retention probability are within institutional compliance. Keep up your regular class participation!",
      action: "Continue to Dashboard",
    };
  };

  const popContent = getPopModalContent();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <BrandLogo className="app-brand" inverse to="/dashboard" />
        <nav aria-label="Dashboard navigation">
          <DashboardNavLink tab="overview" currentTab={activeTab}>
            <LayoutDashboard size={18} /> Overview
          </DashboardNavLink>
          {user?.role === "professor" && (
            <DashboardNavLink tab="data" currentTab={activeTab}>
              <Database size={18} /> Data Workspace
            </DashboardNavLink>
          )}
          {user?.role !== "professor" && user?.role !== "administrator" && (
            <>
              <DashboardNavLink tab="data" currentTab={activeTab}>
                <Database size={18} /> Data Workspace
              </DashboardNavLink>
              <DashboardNavLink tab="insights" currentTab={activeTab}>
                <BarChart3 size={18} /> Insights
              </DashboardNavLink>
            </>
          )}
          {hasConnectionAccess && (
            <DashboardNavLink tab="connections" currentTab={activeTab}>
              <UsersRound size={18} /> {user.role === "student" ? "Professors" : "Students"}
            </DashboardNavLink>
          )}

          {hasConnectionAccess && (
            <DashboardNavLink tab="messages" currentTab={activeTab}>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <MessageCircle size={18} />
                {unreadMessagesCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-3px",
                      right: "-3px",
                      width: "8px",
                      height: "8px",
                      backgroundColor: "#ef4444",
                      borderRadius: "50%",
                      border: "1.5px solid #1a2233",
                    }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <span>Messages</span>
              {unreadMessagesCount > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    backgroundColor: "#ef4444",
                    color: "#ffffff",
                    fontSize: "0.72rem",
                    fontWeight: "700",
                    padding: "2px 7px",
                    borderRadius: "9999px",
                    lineHeight: "1",
                    minWidth: "16px",
                    textAlign: "center",
                  }}
                  aria-label={`${unreadMessagesCount} unread messages`}
                >
                  {unreadMessagesCount > 99 ? "99+" : unreadMessagesCount}
                </span>
              )}
            </DashboardNavLink>
          )}

          {user?.role !== "administrator" && (
            <DashboardNavLink tab="history" currentTab={activeTab}>
              <HistoryIcon size={18} /> History
            </DashboardNavLink>
          )}
        </nav>
        <div className="sidebar-support">
          <ShieldCheck size={18} />
          <p>
            <strong>Responsible use</strong>
            <br />
            Always review context before acting on a signal.
          </p>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-topbar">
          <BrandLogo className="mobile-brand" to="/dashboard" />
          <div className="account-menu">
            <button
              type="button"
              className="user-initials profile-trigger"
              onClick={() => setShowProfile(true)}
              aria-label="Open my profile"
              aria-haspopup="dialog"
            >
              {user.profileImage ? <img src={user.profileImage} alt="" /> : userInitials}
            </button>
            <div>
              <strong>{user?.fullName || "User"}</strong>
              <small>{roleLabel}</small>
            </div>
            <button
              type="button"
              onClick={handleLogoutClick}
              aria-label="Log out"
              title="Log out"
              className="logout-topbar-button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                backgroundColor: "#ffffff",
                color: "#dc2626",
                fontSize: "0.85rem",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <LogOut size={16} />
              <span>Log out</span>
            </button>
          </div>
        </header>

        {sessionError && (
          <div className="login-alert" role="alert">
            <p>{sessionError}</p>
            <button type="button" className="connection-button" onClick={retrySession}>
              Retry session check
            </button>
          </div>
        )}

        <nav className="mobile-dashboard-nav" aria-label="Mobile navigation">
          <DashboardNavLink tab="overview" currentTab={activeTab}>Overview</DashboardNavLink>
          {user?.role === "professor" && <DashboardNavLink tab="data" currentTab={activeTab}>Data</DashboardNavLink>}

          {user?.role !== "professor" && user?.role !== "administrator" && (
            <>
              <DashboardNavLink tab="data" currentTab={activeTab}>Data</DashboardNavLink>
              <DashboardNavLink tab="insights" currentTab={activeTab}>Insights</DashboardNavLink>
            </>
          )}

          {hasConnectionAccess && (
            <DashboardNavLink tab="connections" currentTab={activeTab}>
              {user?.role === "student" ? "Professors" : "Students"}
            </DashboardNavLink>
          )}

          {hasConnectionAccess && (
            <DashboardNavLink tab="messages" currentTab={activeTab}>
              <span style={{ position: "relative" }}>
                Messages
                {unreadMessagesCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-4px",
                      right: "-12px",
                      backgroundColor: "#ef4444",
                      color: "#ffffff",
                      fontSize: "0.65rem",
                      fontWeight: "700",
                      padding: "1px 5px",
                      borderRadius: "9999px",
                      lineHeight: "1",
                    }}
                  >
                    {unreadMessagesCount > 99 ? "99+" : unreadMessagesCount}
                  </span>
                )}
              </span>
            </DashboardNavLink>
          )}

          {user?.role !== "administrator" && (
            <DashboardNavLink tab="history" currentTab={activeTab}>History</DashboardNavLink>
          )}
        </nav>

        {(user?.role === "professor" || user?.role === "advisor") && activeTab === "overview" && (
          <AdvisorDashboardModule user={user} />
        )}

        {user?.role === "administrator" && activeTab === "overview" && (
          <AdminDashboardView user={user} nextStep={nextStep} activeTab={activeTab} />
        )}

        {user?.role === "student" && activeTab === "overview" && (
          <>
            <section className="dashboard-intro" id="overview">
              <p className="dashboard-eyebrow">
                {user.institution || "Your academic workspace"}
              </p>
              <h1>Good to see you, {firstName}.</h1>
              <p>
                Review your professor-uploaded record, run a forecast when you are ready, and
                revisit your History to track changes over time.
              </p>
            </section>

            <section className="dashboard-summary" aria-label="Advisor module objectives">
              <article
                className={`risk-card-${alertCardColor} ${isInflating ? "balloon-inflating" : ""} ${isPopped ? "balloon-popped" : ""}`}
                onMouseEnter={handleMouseEnterRisk}
                onMouseLeave={handleMouseLeaveRisk}
                title="Hold hover for 5 seconds to inspect action directives"
              >
                {isPopped && (
                  <div className="balloon-shards">
                    <span className="shard s1" />
                    <span className="shard s2" />
                    <span className="shard s3" />
                    <span className="shard s4" />
                  </div>
                )}

                {hasForecastRisk ? (
                  <div className={`risk-stat-badge ${alertCardColor}`}>
                    <span className="risk-stat-number">{animatedPercentage}%</span>
                  </div>
                ) : (
                  <span className={`summary-icon ${alertCardColor}`}>
                    <AlertTriangle size={19} />
                  </span>
                )}
                <div>
                  <strong>
                    {gradeDetails !== null
                      ? hasForecastRisk
                        ? riskLabel(forecastRiskLevel)
                        : gradeDetails.isAtRisk ? "At-Risk Alert" : "Not At Risk"
                      : "No Record Yet"}
                  </strong>
                  <small>
                    {gradeDetails !== null
                      ? hasForecastRisk
                        ? `${animatedPercentage}% estimated dropout probability (${riskLabel(forecastRiskLevel)})`
                        : gradeDetails.isAtRisk ? `Grade below passing cutoff (${gradeDetails.passingCutoff})` : "Academic standing is satisfactory"
                      : "Awaiting your professor’s academic upload"}
                  </small>
                </div>
              </article>

              <article>
                <span className="summary-icon blue">
                  <BarChart3 size={19} />
                </span>
                <div>
                  <strong>
                    {gradeDetails !== null ? gradeDetails.label : "Grade Not Set"}
                  </strong>
                  <small>
                    {gradeDetails !== null
                      ? "Reported Semester Grade"
                      : "Awaiting your professor's semester record"}
                  </small>
                </div>
              </article>

              <article>
                <span className={`summary-icon ${projectedGradeDetails?.isAtRisk ? "amber" : "green"}`}>
                  <TrendingUp size={19} />
                </span>
                <div>
                  <strong>
                    {projectedGradeDetails !== null
                      ? projectedGradeDetails.label
                      : "No Forecast"}
                  </strong>
                  <small>
                    {projectedGradeDetails !== null
                      ? `Projected Next Term (${projectedGradeDetails.isAtRisk ? "Below Passing Cutoff" : "Satisfactory"})`
                      : "Run a forecast in Insights to calculate"}
                  </small>
                </div>
              </article>
            </section>

            {showPopModal && (
              <div className="risk-pop-backdrop" onClick={() => setShowPopModal(false)}>
                <div
                  className={`risk-pop-modal border-${alertCardColor}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="risk-pop-close"
                    onClick={() => setShowPopModal(false)}
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>

                  <div className={`risk-pop-icon ${alertCardColor}`}>
                    <AlertOctagon size={28} />
                  </div>

                  <h3>{popContent.title}</h3>
                  <p>{popContent.message}</p>

                  <div className="risk-pop-actions">
                    <button
                      type="button"
                      className={`risk-pop-action-btn ${alertCardColor}`}
                      onClick={() => {
                        setShowPopModal(false);
                        if (alertCardColor === "red" || alertCardColor === "amber") {
                          navigate("/dashboard/messages");
                        }
                      }}
                    >
                      {popContent.action}
                    </button>
                    <button
                      type="button"
                      className="risk-pop-dismiss-btn"
                      onClick={() => setShowPopModal(false)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            <section className="workspace-section" style={{ marginTop: "1.4rem" }}>
              <div className="section-heading">
                <div>
                  <p className="dashboard-eyebrow">Predictive Outlook</p>
                  <h2>Your Academic Trajectory Graph</h2>
                </div>
              </div>

              {gradeDetails !== null ? (
                <div style={{ marginTop: "1.2rem" }}>
                  <div className={`alert-banner ${!gradeDetails.isAtRisk ? "banner-safe" : ""}`}>
                    <Sparkles size={16} />
                    <div>
                      {gradeDetails.isAtRisk ? (
                        <>
                          <strong>Warning:</strong> Your recorded grade (<strong>{gradeDetails.label}</strong>) is currently below the institutional retention cutoff of {gradeDetails.passingCutoff}.
                        </>
                      ) : (
                        <>
                          <strong>On Track:</strong> Your recorded grade (<strong>{gradeDetails.label}</strong>) indicates satisfactory academic progress.
                        </>
                      )}
                    </div>
                  </div>

                  <div className="expanded-trajectory-wrapper" style={{ marginTop: "1rem" }}>
                    <div className="trajectory-header">
                      <TrendingUp size={18} color="#0c5bb4" />
                      <h4>Academic Performance Trajectory Forecast ({gradeScaleType} Scale)</h4>
                    </div>
                    <p className="chart-subtext">
                      {trajectorySource}. Forecast period: {hasForecast ? "next term" : "not available"}.
                    </p>

                    <div className="trajectory-content">
                      <AcademicTrajectoryChart
                        currentGrade={rawGradeNum}
                        predictedGrade={hasForecast ? forecastedGrade : undefined}
                        gradeDetails={gradeDetails}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state" style={{ minHeight: "180px" }}>
                  <div className="empty-illustration">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <h3>No Trajectory Available Yet</h3>
                    <p>
                      Ask your connected professor to upload your previous semester record through CSV. Review it in Data Workspace before running a forecast.
                    </p>
                    <NavLink to="/dashboard/data" className="dashboard-action">
                      Review Academic Record
                    </NavLink>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {user?.role === "student" && activeTab === "data" && (
          <section className="workspace-section" id="data">
            <div className="section-heading data-workspace-heading">
              <div>
                <p className="dashboard-eyebrow">Your data</p>
                <h2>Academic Record and Personal Information</h2>
              </div>
              <button
                type="button"
                className="data-workspace-help"
                onClick={() => setIsDataTutorialOpen(true)}
                aria-label={isDataTutorialOpen ? "Close Data Workspace tutorial" : "Open Data Workspace tutorial"}
                aria-expanded={isDataTutorialOpen}
                aria-controls={isDataTutorialOpen ? "student-data-tutorial" : undefined}
              >
                <Info size={19} aria-hidden="true" />
              </button>
            </div>
            <p className="dashboard-subtext">
              This information is used to generate your personal risk forecast.
              Only you and authorized staff at your institution can see it.
            </p>
            <StudentDataForm onSaveRecord={processAndStoreRecord} />
            {isDataTutorialOpen && (
              <div className="academic-tutorial-backdrop">
                <section
                  id="student-data-tutorial"
                  className="academic-tutorial-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="student-data-tutorial-title"
                  aria-describedby="student-data-tutorial-description"
                >
                  <div className="academic-tutorial-header">
                    <span className="dashboard-eyebrow">Data Workspace Guide</span>
                    <h2 id="student-data-tutorial-title">How Your Records Are Managed</h2>
                    <p id="student-data-tutorial-description">
                      Review your academic record, choose who provides it, and keep your personal indicators up to date.
                    </p>
                  </div>

                  <ol className="academic-tutorial-steps">
                    <li>
                      <h3>Review Your Academic Record</h3>
                      <p>
                        This section displays the academic year, semester, professor, and uploaded record details such as
                        your previous grade, units, and schedule. The professor manages these values; contact your provider
                        if something needs correction.
                      </p>
                    </li>
                    <li>
                      <h3>Designate an Academic Provider</h3>
                      <p>
                        Enter the source academic year as eight digits (for example, 2025-2026; pasting the year is also
                        supported), choose the semester, and select a connected professor. Select{" "}
                        <strong>Designate Provider</strong> to submit. If no professor is listed, connect with one first
                        in Connections.
                      </p>
                    </li>
                    <li>
                      <h3>Update Your Personal Indicators</h3>
                      <p>
                        Choose Yes or No for each background indicator: educational support needs, tuition fees up to
                        date, and active scholarship. Select <strong>Save Personal Information</strong> to save your
                        choices.
                      </p>
                    </li>
                  </ol>

                  <div className="academic-tutorial-readiness">
                    <h3>Understand Your Readiness Status</h3>
                    <ul>
                      <li><strong>No Connection:</strong> connect with a professor and wait for acceptance.</li>
                      <li><strong>Choose Provider:</strong> select a connected professor for the source semester.</li>
                      <li><strong>Provider Disconnected:</strong> reconnect with your professor before forecasting.</li>
                      <li><strong>Awaiting Upload:</strong> your professor still needs to upload the record.</li>
                      <li><strong>Profile Incomplete:</strong> complete your personal indicators.</li>
                      <li><strong>Ready:</strong> your record and personal information are ready for forecasting.</li>
                    </ul>
                  </div>

                  <div className="academic-tutorial-footer">
                    <label className="academic-tutorial-opt-out">
                      <input
                        type="checkbox"
                        checked={doNotShowAutomatically}
                        onChange={(event) => setDoNotShowAutomatically(event.target.checked)}
                      />
                      <span>Don't show this guide automatically again</span>
                    </label>
                    <button type="button" className="dashboard-action" onClick={() => setIsDataTutorialOpen(false)}>
                      Close
                    </button>
                  </div>
                </section>
              </div>
            )}
          </section>
        )}

        {hasConnectionAccess && activeTab === "connections" && (
          <section className="workspace-section" id="connections">
            <div className="section-heading">
              <div>
                <p className="dashboard-eyebrow">Academic support</p>
                <h2>
                  {user.role === "student" ? "Professors" : "Manage Student Connections"}
                </h2>
              </div>
            </div>
            <ConnectionManager />
          </section>
        )}

        {hasConnectionAccess && activeTab === "messages" && (
          <MessageCenter onUnreadCountChange={setUnreadMessagesCount} />
        )}

        {user?.role === "professor" && (activeTab === "data" || activeTab === "insights") && (
          <ProfessorDashboardView user={user} activeTab={activeTab} />
        )}

        {user?.role === "student" && activeTab === "insights" && (
          <StudentInsights onForecastComplete={handleForecastCompleted} latestForecast={latestForecast} />
        )}

        {user?.role === "professor" && activeTab === "history" && <ProfessorHistoryView />}
        {user?.role !== "professor" && activeTab === "history" && (
          <HistoryView user={user} nextStep={nextStep} />
        )}
      </main>

      {showLogoutModal && (
        <div
          className="risk-pop-backdrop"
          style={{ zIndex: 1200 }}
          onClick={handleCloseLogoutModal}
        >
          <div
            className="risk-pop-modal"
            style={{ maxWidth: "400px", textAlign: "center" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="risk-pop-close"
              onClick={handleCloseLogoutModal}
              aria-label="Close modal"
            >
              <X size={18} />
            </button>

            <div className="risk-pop-icon red" style={{ margin: "0 auto 1rem" }}>
              <LogOut size={26} />
            </div>

            <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Confirm Log Out</h3>
            <p style={{ color: "#64788e", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
              Are you sure you want to log out of your session?
            </p>

            <div className="risk-pop-actions" style={{ justifyContent: "center" }}>
              <button
                type="button"
                className="risk-pop-action-btn red"
                style={{ backgroundColor: "#ef4444", color: "#ffffff", minWidth: "120px" }}
                onClick={handleConfirmLogout}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {showProfile && <Profile onClose={closeProfile} />}
    </div>
  );
}