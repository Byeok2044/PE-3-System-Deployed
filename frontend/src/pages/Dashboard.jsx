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
  Filter,
  History as HistoryIcon,
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
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
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
import ProfessorDashboardView from "./ProfessorDashboardView.jsx";

// Route-aware count-up hook
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
    detail: "Save your academic record, then run a personal forecast whenever you want to check your outlook.",
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

const INITIAL_COHORT = [
  {
    id: "STU-1029",
    name: "Alex Rivera",
    program: "BS Information Technology",
    yearLevel: "3rd Year",
    riskLevel: "high",
    riskScore: 84,
    primaryTrigger: "GPA dropped > 0.6 this term; 3 consecutive absences in Networking 2",
    displayGrade: "2.15 / 4.0",
    currentGpa: 2.15,
    attendanceRate: 74,
    trajectory: [
      { term: "Y1-T1", gpa: 3.4 },
      { term: "Y1-T2", gpa: 3.2 },
      { term: "Y2-T1", gpa: 2.85 },
      { term: "Y2-T2", gpa: 2.6 },
      { term: "Y3-T1", gpa: 2.15 },
      { term: "Y3-T2 (Proj)", gpa: 1.85 },
    ],
  },
  {
    id: "STU-1044",
    name: "Bea Santos",
    program: "BS Computer Science",
    yearLevel: "2nd Year",
    riskLevel: "medium",
    riskScore: 58,
    primaryTrigger: "Midterm exam failure in Data Structures; missing lab submissions",
    displayGrade: "2.75 / 4.0",
    currentGpa: 2.75,
    attendanceRate: 88,
    trajectory: [
      { term: "Y1-T1", gpa: 3.5 },
      { term: "Y1-T2", gpa: 3.3 },
      { term: "Y2-T1", gpa: 2.75 },
      { term: "Y2-T2 (Proj)", gpa: 2.65 },
    ],
  },
];

function evaluateGrade(rawGradeNum, scaleType) {
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
    passingCutoff = 2.0;
    chartDomain = [1.0, 4.0];
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
  const [connectedStudentsData, setConnectedStudentsData] = useState([]);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [expandedStudentId, setExpandedStudentId] = useState(null);
  const [filterRisk, setFilterRisk] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    const fetchProfessorData = async () => {
      setLoading(true);
      try {
        if (!apiFetch) return;

        const [connRes, studentsRes] = await Promise.all([
          apiFetch("/api/connections"),
          apiFetch("/api/professor/students"),
        ]);

        if (connRes.ok && isMounted) {
          const connData = await connRes.json();
          const pendings = (connData.connections || []).filter(
            (c) => c.status === "pending"
          );
          setPendingRequestsCount(pendings.length);
        }

        if (studentsRes.ok && isMounted) {
          const stData = await studentsRes.json();
          const sameInstitutionStudents = (stData.students || []).filter(
            ({ student }) => !user.institution || student.institution === user.institution
          );
          setConnectedStudentsData(sameInstitutionStudents);
        } else if (!studentsRes.ok && isMounted) {
          const errData = await studentsRes.json().catch(() => ({}));
          throw new Error(errData.message || "Failed to load connected students.");
        }
      } catch (err) {
        if (isMounted) setError(err.message || "Error fetching dashboard data.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchProfessorData();
    return () => {
      isMounted = false;
    };
  }, [apiFetch, user?.institution]);

  const formattedStudents = useMemo(() => {
    return connectedStudentsData.map(({ student, record, forecast }) => {
      const riskLevel = forecast
        ? riskLevelFromForecast(forecast.riskLevel, forecast.dropoutProbability)
        : null;
      const dropoutProbability = Number(forecast?.dropoutProbability);

      return {
        id: String(student.id || student._id),
        name: student.fullName || "Unknown Student",
        gpa: record ? `${record.previousSemesterGrade} / ${record.gradeMaximum}` : "N/A",
        attendance: record ? (record.attendance === "day" ? "Day" : "Night") : "N/A",
        riskScore: Number.isFinite(dropoutProbability) ? percentage(dropoutProbability) : "—",
        riskLevel,
        predictedGrade: forecast ? `${forecast.predictedNextSemesterGrade} / ${forecast.gradeMaximum}` : "N/A",
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

  const toggleExpand = (studentId) => {
    setExpandedStudentId((prev) => (prev === studentId ? null : studentId));
  };

  const getFilterIconColor = () => {
    if (filterRisk === "high") return "#dc2626";
    if (filterRisk === "medium") return "#ea580c";
    if (filterRisk === "low") return "#16a34a";
    return "#70869b";
  };

  if (loading) return <p className="connected-students-loading">Loading professor dashboard...</p>;
  if (error) return <p className="connected-students-error" role="alert">{error}</p>;

  return (
    <div className="advisor-dashboard">
      <section className="dashboard-intro">
        <p className="dashboard-eyebrow">{user.institution || "Advisory Caseload Workspace"}</p>
        <h1>Advisor Command Center</h1>
        <p>
          Monitor cohort risk levels, review pending requests, and inspect academic trajectories for connected students.
        </p>
      </section>

      <section className="advisor-summary-grid">
        <div className="summary-card">
          <div className="card-icon red"><AlertTriangle size={20} /></div>
          <div className="card-details">
            <span className="card-value">
              {riskCount("high")} ({riskShare("high")})
            </span>
            <span className="card-label">High Risk</span>
            <small>High risk: 40%+ dropout probability</small>
          </div>
        </div>

        <div className="summary-card">
          <div className="card-icon amber"><TrendingDown size={20} /></div>
          <div className="card-details">
            <span className="card-value">
              {riskCount("medium")} ({riskShare("medium")})
            </span>
            <span className="card-label">Medium Risk</span>
            <small>Medium risk: 20–39% dropout probability</small>
          </div>
        </div>

        <div className="summary-card">
          <div className="card-icon green"><UserCheck size={20} /></div>
          <div className="card-details">
            <span className="card-value">
              {riskCount("low")} ({riskShare("low")})
            </span>
            <span className="card-label">Low Risk</span>
            <small>Low risk: below 20% dropout probability</small>
          </div>
        </div>

        <div className="summary-card">
          <div className="card-icon blue"><UsersRound size={20} /></div>
          <div className="card-details">
            <span className="card-value">{connectedStudentsData.length}</span>
            <span className="card-label">Total Students</span>
            <small>Connected active students</small>
          </div>
        </div>

        <div className="summary-card">
          <div className="card-icon silver"><Clock size={20} /></div>
          <div className="card-details">
            <span className="card-value">{pendingRequestsCount}</span>
            <span className="card-label">Pending Requests</span>
            <small>Awaiting your approval</small>
          </div>
        </div>
      </section>

      <section className="workspace-section">
        <div className="section-heading">
          <div>
            <p className="dashboard-eyebrow">Connected Student Performance</p>
            <h2>Attrition Risk and Academic Trajectory Overview</h2>
          </div>
        </div>

        <div className="caseload-controls">
          <div className="search-box">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search student name"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div
            className={`filter-select ${filterRisk !== "all" ? `risk-${filterRisk}` : ""}`}
            data-risk={filterRisk}
          >
            <Filter
              size={15}
              color={getFilterIconColor()}
              stroke={getFilterIconColor()}
              style={{
                stroke: getFilterIconColor(),
                color: getFilterIconColor(),
              }}
            />
            <select
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value.toLowerCase())}
            >
              <option value="all">Attrition Tiers</option>
              <option value="high">High Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="low">Low Risk</option>
            </select>
          </div>
        </div>

        {formattedStudents.length === 0 ? (
          <div className="connected-students-empty">
            <BookOpen size={20} />
            <p>
              No connected students from {user.institution || "your institution"} yet. Approve connection requests to view student records here.
            </p>
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student, idx) => {
                  const isExpanded = expandedStudentId === student.id;
                  return (
                    <React.Fragment key={student.id}>
                      <tr className={isExpanded ? "row-expanded" : ""}>
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
                            className="action-button secondary"
                            onClick={() => toggleExpand(student.id)}
                          >
                            {isExpanded ? (
                              <>Hide Trajectory <ChevronUp size={14} /></>
                            ) : (
                              <>View Trajectory <ChevronDown size={14} /></>
                            )}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (() => {
                        const gradeScale = student.scale || student.gpa?.split("/")[1]?.trim() || "4.0";
                        const currentGradeNum = parseFloat(student.gpa) || 0;
                        const predictedGradeNum = parseFloat(student.predictedGrade) || 0;
                        const { isAtRisk, chartDomain, isReversed, passingCutoff } = evaluateGrade(currentGradeNum, gradeScale);
                        
                        

                        return (
                          <tr className="trajectory-expansion-row">
                            <td colSpan={5}>
                              <div className="expanded-trajectory-wrapper">
                                <div className="trajectory-header">
                                  <TrendingUp size={18} color="#0c5bb4" />
                                  <h4>
                                    Academic Performance Trajectory Forecast ({gradeScale} Scale)
                                  </h4>
                                </div>

                                <div className="trajectory-content">
                                  <div className="trajectory-chart-box">
                                    <div className="trajectory-chart">
                                      <ResponsiveContainer width="100%" height="100%">
                                        <LineChart
                                          data={[
                                            { term: "Current Term", grade: currentGradeNum },
                                            { term: "Next Term (ML)", grade: predictedGradeNum },
                                          ]}
                                          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                                        >
                                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                          <XAxis dataKey="term" stroke="#64748b" fontSize={11} />
                                          <YAxis
                                            domain={chartDomain}
                                            reversed={isReversed}
                                            stroke="#64748b"
                                            fontSize={11}
                                          />
                                          <Tooltip formatter={(val) => [val, "Grade"]} />
                                          <ReferenceLine
                                            y={passingCutoff}
                                            label={{ value: `Cutoff (${passingCutoff})`, fill: "#d55752", fontSize: 10, x: 1100, dy: 18, position: "insideBottomRight"}}
                                            stroke="#d55752"
                                            strokeDasharray="3 3"
                                          />
                                          <Line
                                            type="monotone"
                                            dataKey="grade"
                                            stroke={isAtRisk ? "#d55752" : "#0c5bb4"}
                                            strokeWidth={2.5}
                                            dot={{ r: 4, fill: isAtRisk ? "#d55752" : "#0c5bb4" }}
                                            activeDot={{ r: 6 }}
                                          />
                                        </LineChart>
                                      </ResponsiveContainer>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Dashboard() {
  const { user, logout, apiFetch } = useAuth();
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

  const [cohort, setCohort] = useState(INITIAL_COHORT);
  const [studentRecord, setStudentRecord] = useState(null);
  const [latestForecast, setLatestForecast] = useState(null);

  // Unread messages state for sidebar badge
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const closeProfile = useCallback(() => setShowProfile(false), []);

  // 5-second balloon pop states
  const [isInflating, setIsInflating] = useState(false);
  const [isPopped, setIsPopped] = useState(false);
  const [showPopModal, setShowPopModal] = useState(false);
  const popTimerRef = useRef(null);

  const activeTab = TAB_BY_PATH[location.pathname] || "overview";
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

  const processAndStoreRecord = useCallback((record) => {
    if (!record || record.previousSemesterGrade === undefined || record.previousSemesterGrade === "") return;

    setStudentRecord(record);
    const rawGradeNum = Number(record.previousSemesterGrade) || 0;
    const { isAtRisk, label } = evaluateGrade(rawGradeNum, record.gradeMaximum);

    const unitsEnrolled = Number(record.previousSemesterUnitsEnrolled) || 1;
    const unitsApproved = Number(record.previousSemesterUnitsApproved) || 0;
    const passRate = unitsApproved / unitsEnrolled;

    let riskLevel = "low";
    let riskScore = 15;
    let trigger = `Academic record satisfactory (${label}); student is not at risk`;

    if (isAtRisk || passRate < 0.6) {
      riskLevel = "high";
      riskScore = 88;
      trigger = `Critical: Term grade ${label} is below minimum academic retention threshold`;
    } else if (passRate < 0.85) {
      riskLevel = "medium";
      riskScore = 55;
      trigger = `Moderate: Passing grade, but course completion rate is ${(passRate * 100).toFixed(0)}%`;
    }

    const updatedStudentEntry = {
      id: user?._id || "STU-CURRENT",
      name: user?.fullName || "Current Student",
      program: user?.program || "BS Information Technology",
      yearLevel: "Current Term",
      riskLevel,
      riskScore,
      primaryTrigger: trigger,
      displayGrade: label,
      currentGpa: rawGradeNum,
      attendanceRate: record.attendance === "day" ? 94 : 85,
      trajectory: [
        { term: "Prior Term", gpa: rawGradeNum },
        { term: "Current Term", gpa: rawGradeNum },
        { term: "Next (Proj)", gpa: rawGradeNum },
      ],
    };

    setCohort((prevCohort) => {
      const idx = prevCohort.findIndex((s) => s.id === updatedStudentEntry.id);
      if (idx >= 0) {
        const next = [...prevCohort];
        next[idx] = updatedStudentEntry;
        return next;
      }
      return [updatedStudentEntry, ...prevCohort];
    });
  }, [user]);

  useEffect(() => {
    localStorage.removeItem("retainify_student_record");
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        if (!apiFetch) return;
        const res = await apiFetch("/api/students/me");
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            if (data?.record) processAndStoreRecord(data.record);
            else setStudentRecord(null);
          }
        }
      } catch (err) {
        console.warn("Could not fetch user record on Dashboard mount", err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [apiFetch, processAndStoreRecord]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        if (!apiFetch || user?.role !== "student") return;
        const res = await apiFetch("/api/students/me/history");
        if (!res.ok) return;
        const data = await res.json();
        const forecastRun = (data.activities || []).find(
          (activity) => activity.type === "forecast_run" && activity.forecast
        );
        if (isMounted) setLatestForecast(forecastRun || null);
      } catch (err) {
        console.warn("Could not fetch the latest student forecast", err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [apiFetch, user?.role]);

  const handleForecastCompleted = useCallback((forecastRun) => {
    setLatestForecast(forecastRun);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
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

  const trajectoryRecord = studentRecord || latestForecast?.record || null;
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

  const studentTrajectoryData = gradeDetails
    ? [
        {
          term: "Current Term",
          gpa: rawGradeNum,
        },
        ...(hasForecast
          ? [{ term: "Next Term (ML Forecast)", gpa: forecastedGrade }]
          : []),
      ]
    : [];

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

  // Balloon Hover & Pop Handlers
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
          
          {/* MESSAGES WITH UNREAD BADGE */}
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

          {user?.role !== "professor" && user?.role !== "administrator" && (
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
            <button type="button" className="user-initials profile-trigger" onClick={() => setShowProfile(true)} aria-label="Open my profile" aria-haspopup="dialog">{user.profileImage ? <img src={user.profileImage} alt="" /> : userInitials}</button>
            <div>
              <strong>{user?.fullName || "User"}</strong>
              <small>{roleLabel}</small>
            </div>
            <button type="button" onClick={handleLogout} aria-label="Log out">
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <nav className="mobile-dashboard-nav" aria-label="Mobile navigation">
          <DashboardNavLink tab="overview" currentTab={activeTab}>Overview</DashboardNavLink>
          
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

          {/* MOBILE MESSAGES TAB WITH UNREAD BADGE */}
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

          {user?.role !== "professor" && user?.role !== "administrator" && (
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
                Save your academic record, run a forecast when you are ready, and
                revisit your History to track changes over time.
              </p>
            </section>

            <section className="dashboard-summary" aria-label="Advisor module objectives">
              {/* Card 1: 5-Second Hover Balloon Pop Container */}
              <article 
                className={`risk-card-${alertCardColor} ${isInflating ? "balloon-inflating" : ""} ${isPopped ? "balloon-popped" : ""}`}
                onMouseEnter={handleMouseEnterRisk}
                onMouseLeave={handleMouseLeaveRisk}
                title="Hold hover for 5 seconds to inspect action directives"
              >
                {/* Visual explosion particles on pop */}
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
                      : "Go to Data Workspace to submit your grades"}
                  </small>
                </div>
              </article>

              {/* Card 2: Formatted Current Term Grade */}
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
                      : "Awaiting your semester input"}
                  </small>
                </div>
              </article>

              {/* Card 3: Next Semester Projected Grade (ML Output) */}
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

            {/* Balloon Pop Modal Directives */}
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

                  <div className="chart-container" style={{ marginTop: "1rem" }}>
                    <h4>Academic Trajectory vs. Passing Cutoff ({gradeDetails.passingCutoff})</h4>
                    <p className="chart-subtext">
                      {trajectorySource}. Forecast period: {hasForecast ? "next term" : "not available"}.
                    </p>

                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <LineChart
                          data={studentTrajectoryData}
                          margin={{ top: 15, right: 25, left: -10, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf1" />
                          <XAxis dataKey="term" stroke="#718399" fontSize={12} />
                          <YAxis
                            domain={gradeDetails.chartDomain}
                            reversed={gradeDetails.isReversed}
                            stroke="#718399"
                            fontSize={12}
                          />
                          <Tooltip
                            formatter={(value) => [value, "Grade"]}
                            contentStyle={{ borderRadius: "8px", border: "1px solid #c6d6e5" }}
                          />
                          <ReferenceLine
                            y={gradeDetails.passingCutoff}
                            label={{
                              value: `Cutoff (${gradeDetails.passingCutoff})`,
                              fill: "#a63834",
                              position: "insideTopRight",
                              fontSize: 11,
                            }}
                            stroke="#d55752"
                            strokeDasharray="4 4"
                          />
                          <Line
                            type="monotone"
                            dataKey="gpa"
                            stroke={gradeDetails.isAtRisk ? "#d55752" : "#0c5bb4"}
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: gradeDetails.isAtRisk ? "#d55752" : "#0c5bb4" }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
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
                      Enter your latest term grades and completed credit units in the Data Workspace to plot your historical trajectory and predictive forecast.
                    </p>
                    <NavLink to="/dashboard/data" className="dashboard-action">
                      Enter Academic Record
                    </NavLink>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {user?.role === "student" && activeTab === "data" && (
          <section className="workspace-section" id="data">
            <div className="section-heading">
              <div>
                <p className="dashboard-eyebrow">Your data</p>
                <h2>Tell us about your term</h2>
              </div>
            </div>
            <p className="dashboard-subtext">
              This information is used to generate your personal risk forecast.
              Only you and authorized staff at your institution can see it.
            </p>
            <StudentDataForm onSaveRecord={processAndStoreRecord} />
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

        {user?.role === "professor" && (activeTab === "data" || activeTab === "insights") && <ProfessorDashboardView user={user} activeTab={activeTab} />}

        {user?.role === "student" && activeTab === "insights" && (
          <StudentInsights onForecastComplete={handleForecastCompleted} latestForecast={latestForecast} />
        )}

        {activeTab === "history" && (
          <HistoryView user={user} nextStep={nextStep} />
        )}
      </main>
      {showProfile && <Profile onClose={closeProfile} />}
    </div>
  );
}
