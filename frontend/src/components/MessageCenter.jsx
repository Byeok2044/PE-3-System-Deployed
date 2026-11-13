import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Ellipsis, MessageCircle, Reply, Search, Send, Trash2, UserRoundPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import useAdaptivePolling from "../hooks/useAdaptivePolling.js";
import ProfileAvatar from './ProfileAvatar.jsx';

const time = (value) =>
  new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const riskTier = (forecast) => {
  const tier = String(forecast?.riskLevel || "").toLowerCase();
  return ["low", "medium", "high"].includes(tier) ? tier : null;
};

export default function MessageCenter({ initialSelectedUser, onUnreadCountChange }) {
  const location = useLocation();
  // Read from prop or directly from route state
  const effectiveUser = initialSelectedUser || location.state?.selectedUser || null;

  const { apiFetch, user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState(effectiveUser);
  const handledInitialTarget = useRef("");
  const threadRequestId = useRef(0);
  const threadRevision = useRef(null);

  const applyConversations = useCallback((nextConversations) => {
    setConversations(nextConversations);
  }, []);

  useEffect(() => {
    onUnreadCountChange?.(
      conversations.reduce(
        (total, conversation) => total + (conversation.unreadCount || 0),
        0,
      ),
    );
  }, [conversations, onUnreadCountChange]);

  const refreshConversations = useCallback(async (surfaceError = false) => {
    try {
      const response = await apiFetch("/api/messages");
      const inbox = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(inbox.message || "Could not load messages.");
      applyConversations(inbox.conversations || []);
    } catch (err) {
      if (surfaceError) setError(err.message || "Could not load messages.");
    }
  }, [apiFetch, applyConversations]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [inboxResponse, peopleResponse] = await Promise.all([
          apiFetch("/api/messages"),
          apiFetch(
            user.role === "professor" ? "/api/professor/students" : "/api/connections",
          ),
        ]);
        const inbox = await inboxResponse.json().catch(() => ({}));
        if (!inboxResponse.ok) throw new Error(inbox.message || "Could not load messages.");
        if (!active) return;
        applyConversations(inbox.conversations || []);

        if (peopleResponse.ok) {
          const data = await peopleResponse.json();
          if (!active) return;
          setStudents(
            user.role === "professor"
              ? data.students || []
              : (data.connections || [])
                  .filter((connection) => connection.status === "accepted")
                  .map((connection) => ({ student: connection.professor, forecast: null })),
          );
        }
      } catch (err) {
        if (active) setError(err.message || "Could not load messages.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [apiFetch, applyConversations, user.role]);

  useAdaptivePolling(() => refreshConversations(false), {
    intervalMs: 2500,
    hiddenIntervalMs: 15000,
    enabled: !loading,
  });

  const fetchThread = useCallback(async (conversation, surfaceError = false, useRevision = false) => {
    const requestId = ++threadRequestId.current;
    try {
      const revisionQuery = useRevision && threadRevision.current !== null
        ? `?revision=${encodeURIComponent(threadRevision.current)}`
        : "";
      const response = await apiFetch(
        `/api/messages/${conversation.id}/messages${revisionQuery}`,
      );
      if ([403, 404].includes(response.status) && requestId === threadRequestId.current) {
        threadRequestId.current += 1;
        threadRevision.current = null;
        setSelected(null); setMessages([]); setReplyTo(null); setDraft(''); setShowMobileThread(false);
        setError('This conversation is no longer available. Your connection or institution may have changed.');
        return;
      }
      if (response.status === 204) return;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not open this conversation.");
      if (requestId !== threadRequestId.current) return;
      threadRevision.current = data.conversation.revision;
      setSelected(data.conversation);
      setMessages(data.messages || []);
      setConversations((current) => {
        const next = current.map((item) =>
          item.id === conversation.id ? { ...item, unreadCount: 0 } : item,
        );
        return next;
      });
    } catch (err) {
      if (surfaceError && requestId === threadRequestId.current) {
        setError(err.message || "Could not open this conversation.");
      }
    }
  }, [apiFetch, onUnreadCountChange]);

  const open = async (conversation) => {
    setShowMobileThread(true);
    setError("");
    threadRevision.current = null;
    setSelected(conversation);
    setMessages([]);
    await fetchThread(conversation, true);
  };

  const begin = async (studentId) => {
    setError("");
    try {
      const response = await apiFetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: studentId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not start the conversation.");
      setConversations((current) => [
        data.conversation,
        ...current.filter((item) => item.id !== data.conversation.id),
      ]);
      open(data.conversation);
    } catch (err) {
      setError(err.message || "Could not start the conversation.");
    }
  };

  // Sync selected target when passed via route or prop
  useEffect(() => {
    if (effectiveUser) {
      handledInitialTarget.current = "";
      setSelectedUser(effectiveUser);
    }
  }, [effectiveUser]);

  // Once conversations and students are loaded, find or start the thread
  useEffect(() => {
    if (!selectedUser || loading) return;

    const targetId = String(selectedUser.id || selectedUser._id || selectedUser.student?.id);
    if (!targetId || handledInitialTarget.current === targetId) return;

    const existingConv = conversations.find(
      (conv) => String(conv.peer?.id || conv.peer?._id) === targetId
    );

    if (existingConv) {
      handledInitialTarget.current = targetId;
      open(existingConv);
    } else if (students.length > 0) {
      const matchingStudent = students.find(
        (item) => String(item.student?.id || item.student?._id) === targetId
      );
      if (matchingStudent) {
        handledInitialTarget.current = targetId;
        begin(matchingStudent.student.id);
      }
    }
  }, [selectedUser, conversations, students, loading]);

  useAdaptivePolling(
    () => selected && fetchThread(selected, false, true),
    {
      intervalMs: 1500,
      hiddenIntervalMs: 10000,
      enabled: Boolean(selected?.id),
    },
  );

  const send = async (event) => {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      const response = await apiFetch(`/api/messages/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft, replyToId: replyTo?.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not send the message.");
      threadRequestId.current += 1;
      threadRevision.current = null;
      const sentMessage = {
        ...data.message,
        replyTo: replyTo
          ? { id: replyTo.id, body: replyTo.body, senderName: replyTo.sender.fullName }
          : null,
      };
      setMessages((current) =>
        current.some((message) => message.id === sentMessage.id)
          ? current
          : [...current, sentMessage],
      );
      setDraft("");
      setReplyTo(null);
      setConversations((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, lastMessageAt: data.message.createdAt } : item
        )
      );
      void refreshConversations(false);
      void fetchThread(selected, false, false);
    } catch (err) {
      setError(err.message || "Could not send the message.");
    } finally {
      setSending(false);
    }
  };

  const sendOnEnter = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!sending && draft.trim()) event.currentTarget.form?.requestSubmit();
  };

  const deleteMessage = async (messageId) => {
    if (!selected || !window.confirm("Delete this message?")) return;
    setError("");
    try {
      const response = await apiFetch(
        `/api/messages/${selected.id}/messages/${messageId}`,
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not delete this message.");
      threadRequestId.current += 1;
      threadRevision.current = null;
      setMessages((current) => current.filter((m) => m.id !== messageId));
      setOpenMenu(null);
      void refreshConversations(false);
      void fetchThread(selected, false, false);
    } catch (err) {
      setError(err.message || "Could not delete this message.");
    }
  };

  const useCheckInTemplate = () => {
    const name = selected?.peer?.fullName?.split(" ")[0] || "there";
    setDraft(
      `Hi ${name}, I’d like to check in and see how this term is going. If coursework, attendance, timing, or something else is making study harder, we can look at practical support options together. Would you like to reply here or choose a time to meet? There is no penalty for declining or letting me know you do not need support right now.`
    );
  };

  const studentById = new Map(students.map((item) => [String(item.student.id), item]));
  const availableStudents = students.filter(
    ({ student }) =>
      !conversations.some(
        (conversation) => String(conversation.peer.id) === String(student.id)
      )
  );

  const isProfessor = user.role === "professor";
  const searchQuery = studentSearch.trim().toLowerCase();
  const hasFilters = Boolean(searchQuery || riskFilter !== "all");
  const matchesFilters = (person) => {
    if (!isProfessor) return true;
    const tier = riskTier(studentById.get(String(person.id))?.forecast) || "pending";
    return (riskFilter === "all" || riskFilter === tier)
      && (!searchQuery || [person.fullName, person.email]
        .some((value) => String(value || "").toLowerCase().includes(searchQuery)));
  };
  const filteredStudents = availableStudents.filter(({ student }) => matchesFilters(student));
  const filteredConversations = conversations.filter(({ peer }) => matchesFilters(peer));
  const visibleCount = filteredStudents.length + filteredConversations.length;
  const totalCount = availableStudents.length + conversations.length;

  const riskBadge = (studentId) => {
    const tier = riskTier(studentById.get(String(studentId))?.forecast);
    return tier ? (
      <span className={`message-risk message-risk--${tier}`}>{tier} risk</span>
    ) : (
      <span className="message-risk message-risk--pending">No forecast</span>
    );
  };

  const peerRole = user.role === "professor" ? "Student" : "Professor";

  return (
    <section className="message-center" aria-labelledby="messages-title">
      <header>
        <div>
          <p className="dashboard-eyebrow">Academic support</p>
          <h2 id="messages-title">Support Messages</h2>
          <p>
            Private conversations are available only while the student–professor
            connection is active.
          </p>
          {user.role === "professor" && <small className="message-risk-note"></small>}
        </div>
      </header>

      {error && (
        <p className="connection-message connection-message--error" role="alert">
          {error}
        </p>
      )}

      <div className={`message-center__layout ${showMobileThread && selected ? "is-thread-open" : ""}`}>
        <aside aria-label="Conversations">
          {isProfessor && (
            <div className="message-center__filters" aria-label="Filter students">
              <label className="message-filter-field" htmlFor="message-student-search">
                <span>Find a student</span>
                <div className="message-filter-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    id="message-student-search"
                    type="search"
                    placeholder="Search name or email"
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                  />
                </div>
              </label>
              <label className="message-filter-field" htmlFor="message-risk-filter">
                <span>Risk level</span>
                <select id="message-risk-filter" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
                  <option value="all">All risk levels</option>
                  <option value="high">High risk</option>
                  <option value="medium">Medium risk</option>
                  <option value="low">Low risk</option>
                  <option value="pending">No forecast</option>
                </select>
              </label>
              <div className="message-filter-summary">
                <span role="status">{loading ? "Loading students…" : `${visibleCount} of ${totalCount} students`}</span>
                {hasFilters && <button type="button" onClick={() => { setStudentSearch(""); setRiskFilter("all"); }}>Clear filters</button>}
              </div>
            </div>
          )}
          {filteredStudents.length > 0 && (
            <div className="message-center__start">
              <strong>
                {user.role === "professor"
                  ? "Start supportive outreach"
                  : "Start a conversation"}
              </strong>
              {filteredStudents.map(({ student }) => (
                <button
                  type="button"
                  onClick={() => begin(student.id)}
                  key={student.id}
                >
                  <UserRoundPlus size={15} />
                  <span className="message-outreach-person">
                    <span className="message-outreach-name">{student.fullName}</span>
                    {user.role === "professor" && riskBadge(student.id)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p>Loading conversations…</p>
          ) : filteredConversations.length ? (
            filteredConversations.map((conversation) => (
              <button
                className={`conversation-row ${selected?.id === conversation.id ? "is-selected" : ""} ${conversation.unreadCount > 0 ? "is-unread" : "is-read"}`}
                type="button"
                aria-current={selected?.id === conversation.id ? "true" : undefined}
                aria-label={`${conversation.peer.fullName}, ${conversation.unreadCount > 0 ? `${conversation.unreadCount} unread messages` : "no unread messages"}`}
                onClick={() => open(conversation)}
                key={conversation.id}
              >
                <ProfileAvatar person={conversation.peer} />
                <span>
                  <strong>{conversation.peer.fullName}</strong>
                  <small className="conversation-preview">
                    {conversation.lastMessage
                      ? `${String(conversation.lastMessage.sender) === String(user._id || user.id) ? "You: " : ""}${conversation.lastMessage.body}`
                      : "No messages yet"}
                  </small>
                  <small>
                    <span className="chat-role">{peerRole}</span>{" "}
                    {time(conversation.lastMessageAt)}
                  </small>
                  {user.role === "professor" && riskBadge(conversation.peer.id)}
                </span>
                {conversation.unreadCount > 0 && (
                  <i
                    className="conversation-unread-dot"
                    aria-hidden="true"
                    title={`${conversation.unreadCount} unread messages`}
                  >
                  </i>
                )}
              </button>
            ))
          ) : isProfessor && hasFilters ? (
            visibleCount === 0 && <p className="message-center__empty">No students match these filters. Try another risk level or search, or clear the filters.</p>
          ) : (
            <p className="message-center__empty">
              No messages yet.
              {user.role === "professor"
                ? " Start a supportive outreach with a connected student."
                : " Your professors can invite you to a support conversation."}
            </p>
          )}
        </aside>

        <div className="message-center__thread">
          {selected ? (
            <>
              <div className="message-center__thread-header">
                <button
                  type="button"
                  className="message-back-button"
                  onClick={() => setShowMobileThread(false)}
                >
                  ← Conversations
                </button>
                <ProfileAvatar person={selected.peer} />
                <div>
                  <strong>
                    {selected.peer.fullName}{" "}
                    <span className="chat-role">{peerRole}</span>
                  </strong>
                  <small>Connected academic support conversation</small>
                  {user.role === "professor" && riskBadge(selected.peer.id)}
                </div>
              </div>

              <div className="message-list" aria-live="polite">
                {messages.length ? (
                  messages.map((msg) => {
                    const isMine =
                      String(msg.sender.id) === String(user._id || user.id);
                    return (
                      <article className={isMine ? "mine" : "theirs"} key={msg.id}>
                        <ProfileAvatar person={isMine ? user : selected.peer} className="message-author-avatar" />
                        {msg.replyTo && (
                          <div className="message-reply-preview">
                            <strong>{msg.replyTo.senderName}</strong>
                            <span>{msg.replyTo.body}</span>
                          </div>
                        )}
                        <p>{msg.body}</p>
                        <small>
                          {time(msg.createdAt)}
                          {isMine && (
                            <span
                              className={`message-read-state ${
                                msg.readAt ? "is-read" : ""
                              }`}
                            >
                              {msg.readAt ? "Read" : "Sent"}
                            </span>
                          )}
                        </small>
                        <button
                          type="button"
                          className="message-menu-toggle"
                          onClick={() =>
                            setOpenMenu(openMenu === msg.id ? null : msg.id)
                          }
                          aria-label="Message actions"
                        >
                          <Ellipsis size={16} />
                        </button>
                        {openMenu === msg.id && (
                          <div className="message-menu">
                            <button
                              type="button"
                              onClick={() => {
                                setReplyTo(msg);
                                setOpenMenu(null);
                              }}
                            >
                              <Reply size={13} /> Reply
                            </button>
                            {isMine && (
                              <button
                                type="button"
                                className="message-menu__delete"
                                onClick={() => deleteMessage(msg.id)}
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <p className="message-center__empty">
                    Start with a supportive, practical invitation to talk.
                  </p>
                )}
              </div>

              <form onSubmit={send}>
                {replyTo && (
                  <div className="replying-to">
                    <span>Replying to: {replyTo.body}</span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      aria-label="Cancel reply"
                    >
                      ×
                    </button>
                  </div>
                )}
                {user.role === "professor" && (
                  <button
                    className="message-template"
                    type="button"
                    onClick={useCheckInTemplate}
                  >
                    Use supportive check-in template
                  </button>
                )}
                <label className="sr-only" htmlFor="message-body">
                  Message
                </label>
                <textarea
                  id="message-body"
                  maxLength="2000"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={sendOnEnter}
                  placeholder="Write a supportive message…"
                />
                <div>
                  <small>
                    Enter to send · Shift+Enter for a new line · {draft.length}/2000
                  </small>
                  <button
                    className="dashboard-action"
                    disabled={sending || !draft.trim()}
                  >
                    <Send size={16} /> {sending ? "Sending…" : "Send message"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="message-center__placeholder">
              <MessageCircle size={30} />
              <h3>Select a conversation</h3>
              <p>
                Messages are human-led and meant to offer practical academic
                support.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
