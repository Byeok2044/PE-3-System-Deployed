import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Clock3, Link2, MessageCircle, Search, Trash2, UserPlus, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const statusLabel = {
  pending: "Awaiting response",
  accepted: "Connected",
  declined: "Not accepted",
};

export default function ConnectionManager({ onNavigateTab }) {
  const navigate = useNavigate();
  const { user, apiFetch } = useAuth();
  const [connections, setConnections] = useState([]);
  const [query, setQuery] = useState("");
  const [professors, setProfessors] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connectionToRemove, setConnectionToRemove] = useState(null);
  const [removeError, setRemoveError] = useState("");
  const removeDialogRef = useRef(null);
  const cancelRemovalRef = useRef(null);
  const removalInFlight = useRef(false);
  const isStudent = user?.role === "student";

  const closeRemoveDialog = () => {
    if (removalInFlight.current) return;
    setConnectionToRemove(null);
    setRemoveError("");
  };

  useEffect(() => {
    if (!connectionToRemove) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRemovalRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!removalInFlight.current) { setConnectionToRemove(null); setRemoveError(""); }
      }
      if (event.key !== "Tab") return;
      const buttons = removeDialogRef.current?.querySelectorAll("button:not(:disabled)");
      if (!buttons?.length) { event.preventDefault(); removeDialogRef.current?.focus(); return; }
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !removeDialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !removeDialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [connectionToRemove]);

  const loadConnections = async (background = false) => {
    if (!background) { setIsLoading(true); setError(""); }
    try {
      const response = await apiFetch("/api/connections");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not load connections.");
      setConnections(data.connections || []);
    } catch (requestError) {
      if (!background) setError(requestError.message || "Could not load connections.");
    } finally {
      if (!background) setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadConnections();
  }, [apiFetch]);

  useEffect(() => {
    if (!isStudent || query.trim().length < 2) {
      setProfessors([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await apiFetch(
          `/api/connections/professors?query=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Could not search professors.");
        setProfessors(data.professors || []);
      } catch (requestError) {
        if (requestError.name !== "AbortError") {
          setError(requestError.message || "Could not search professors.");
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiFetch, isStudent, query]);

  const sendRequest = async (professorId) => {
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch("/api/connections/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ professorId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not send the request.");
      setConnections((current) => [
        data.connection,
        ...current.filter((item) => item.id !== data.connection.id),
      ]);
      setMessage("Your connection request has been sent.");
    } catch (requestError) {
      setError(requestError.message || "Could not send the request.");
      // Another tab may have created or accepted the request since this list loaded.
      void loadConnections(true);
    } finally {
      setIsSaving(false);
    }
  };

  const respond = async (id, action) => {
    setIsSaving(true);
    setError("");
    try {
      const response = await apiFetch(`/api/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not update the request.");
      setConnections((current) =>
        current.map((item) => (item.id === id ? data.connection : item))
      );
      setMessage(action === "accept" ? "Student connection approved." : "Request declined.");
    } catch (requestError) {
      setError(requestError.message || "Could not update the request.");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (!connectionToRemove || removalInFlight.current) return;
    const id = connectionToRemove.id;
    removalInFlight.current = true;
    setIsSaving(true);
    setError("");
    setMessage("");
    setRemoveError("");
    try {
      const response = await apiFetch(`/api/connections/${id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not remove the connection.");
      setConnections((current) => current.filter((item) => item.id !== id));
      setMessage("Connection removed.");
      setConnectionToRemove(null);
    } catch (requestError) {
      setRemoveError(requestError.message || "Could not remove the connection.");
    } finally {
      removalInFlight.current = false;
      setIsSaving(false);
    }
  };

  const handleMessageClick = (person) => {
    // Navigate using React Router to the URL route
    navigate("/dashboard/messages", { state: { selectedUser: person } });

    // Fallback if rendered inside a component that switches local tab state
    if (typeof onNavigateTab === "function") {
      onNavigateTab("messages", { selectedUser: person });
    }
  };

  const pendingCount = connections.filter((connection) => connection.status === "pending").length;

  return (
    <section className="connection-manager" aria-labelledby="connection-title">
      <div className="connection-manager__heading">
        <div className="connection-manager__icon" aria-hidden="true">
          <Link2 size={19} />
        </div>
        <div>
          <p className="dashboard-eyebrow">Professor connection</p>
          <h3 id="connection-title">
            {isStudent ? "Connect with professors" : "Student Connection Requests"}
          </h3>
        </div>
        {!isStudent && pendingCount > 0 && (
          <span className="connection-count">{pendingCount} pending</span>
        )}
      </div>

      <p className="connection-manager__description">
        {isStudent
          ? "Search the in-app directory for a professor at your institution. They must approve your request before the connection is active."
          : "Review requests from students at your institution. Accept only students you recognize and support."}
      </p>

      {isStudent && (
        <div className="connection-directory">
          <label htmlFor="professor-search">Find a professor at {user?.institution}</label>
          <div>
            <Search size={16} aria-hidden="true" />
            <input
              id="professor-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by professor name"
            />
          </div>
          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="connection-search-note">Enter at least two characters to search.</p>
          )}
          {isSearching && <p className="connection-search-note">Searching professors…</p>}
          {query.trim().length >= 2 && !isSearching && professors.length === 0 && (
            <p className="connection-search-note">No professors found with that name.</p>
          )}
          {professors.length > 0 && (
            <ul className="professor-search-results">
              {professors.map((professor) => {
                const existing = connections.find((connection) =>
                  String(connection.professor?.id || connection.professor?._id) === String(professor.id)
                  && ['accepted', 'pending'].includes(connection.status)
                );
                return (
                <li key={professor.id}>
                  <span className="connection-avatar" aria-hidden="true">
                    {professor.fullName
                      .split(" ")
                      .map((name) => name[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div>
                    <strong>{professor.fullName}</strong>
                    <small>{professor.institution}</small>
                  </div>
                  <button
                    type="button"
                    className={`connection-button ${existing ? 'connection-button--existing' : 'connection-button--accept'}`}
                    onClick={() => sendRequest(professor.id)}
                    disabled={isSaving || isLoading || Boolean(existing)}
                  >
                    {existing?.status === 'accepted' ? <Check size={15} /> : existing?.status === 'pending' ? <Clock3 size={15} /> : <UserPlus size={15} />}
                    {existing?.status === 'accepted' ? 'Connected already' : existing?.status === 'pending' ? 'Request pending' : 'Connect'}
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="connection-message connection-message--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="connection-message connection-message--success" role="status">
          {message}
        </p>
      )}

      {isLoading ? (
        <p className="connection-empty">Loading connections…</p>
      ) : connections.length === 0 ? (
        <p className="connection-empty">
          {isStudent ? "No professor connections yet." : "No student requests yet."}
        </p>
      ) : (
        <ul className="connection-list">
          {connections.map((connection) => {
            const person = isStudent ? connection.professor : connection.student;
            return (
              <li key={connection.id}>
                <span className="connection-avatar" aria-hidden="true">
                  {person?.fullName
                    ?.split(" ")
                    .map((name) => name[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div className="connection-person">
                  <strong>{person?.fullName}</strong>
                  <small>{person?.email}</small>
                </div>
                <span className={`connection-status connection-status--${connection.status}`}>
                  <Clock3 size={13} />
                  {statusLabel[connection.status]}
                </span>
                <div className="connection-actions">
                  {!isStudent && connection.status === "pending" && (
                    <>
                      <button
                        type="button"
                        className="connection-button connection-button--accept"
                        onClick={() => respond(connection.id, "accept")}
                        disabled={isSaving}
                      >
                        <Check size={15} />
                        Accept
                      </button>
                      <button
                        type="button"
                        className="connection-button connection-button--decline"
                        onClick={() => respond(connection.id, "decline")}
                        disabled={isSaving}
                      >
                        <X size={15} />
                        Decline
                      </button>
                    </>
                  )}
                  {(isStudent || connection.status === "accepted") && (
                    <>
                      <button
                        type="button"
                        className="connection-msg"
                        onClick={() => handleMessageClick(person)}
                        aria-label={`Message ${person?.fullName}`}
                      >
                        <MessageCircle size={16} />
                      </button>
                      <button
                        type="button"
                        className="connection-remove"
                        onClick={() => { setRemoveError(""); setConnectionToRemove(connection); }}
                        disabled={isSaving}
                        aria-label={`Remove connection with ${person?.fullName}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {connectionToRemove && (
        <div className="risk-pop-backdrop" style={{ zIndex: 1200 }} onClick={closeRemoveDialog}>
          <div ref={removeDialogRef} className="risk-pop-modal" style={{ maxWidth: "400px", textAlign: "center" }}
            role="dialog" aria-modal="true" aria-labelledby="remove-connection-title" aria-describedby="remove-connection-description"
            aria-busy={isSaving} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="risk-pop-close" onClick={closeRemoveDialog} disabled={isSaving} aria-label="Close remove connection confirmation">
              <X size={18} />
            </button>
            <div className="risk-pop-icon red" style={{ margin: "0 auto 1rem" }} aria-hidden="true"><Trash2 size={26} /></div>
            <h3 id="remove-connection-title" style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Confirm Remove Connection</h3>
            <p id="remove-connection-description" style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
              Are you sure you want to remove your connection with <strong>{(isStudent ? connectionToRemove.professor : connectionToRemove.student)?.fullName || "this person"}</strong>?
              {connectionToRemove.status === "accepted" ? " Shared workspace access will end and your conversation will be closed." : connectionToRemove.status === "pending" ? " This will cancel the pending connection request." : " This will remove the request from your connections."}
            </p>
            {removeError && <p className="connection-message connection-message--error" role="alert">{removeError}</p>}
            <div className="risk-pop-actions" style={{ justifyContent: "center" }}>
              <button type="button" className="risk-pop-action-btn red" style={{ backgroundColor: "#ef4444", color: "#ffffff", minWidth: "120px" }} onClick={remove} disabled={isSaving}>
                {isSaving ? "Removing..." : "Remove Connection"}
              </button>
              <button ref={cancelRemovalRef} type="button" className="risk-pop-dismiss-btn" onClick={closeRemoveDialog} disabled={isSaving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
