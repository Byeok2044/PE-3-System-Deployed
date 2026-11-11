import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createSessionChannel } from "./sessionChannel.js";
import { validateSession } from "./validateSession.js";

const AuthContext = createContext(null);
const STORAGE_KEY = "eduforecaster_session";

const getStoredSession = () => {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const value = storage.getItem(STORAGE_KEY);
      if (value) return { session: JSON.parse(value), storage };
    } catch {
      storage.removeItem(STORAGE_KEY);
    }
  }
  return null;
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(
    () => getStoredSession()?.session ?? null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const restoreSessionRef = useRef(null);
  const retrySession = useCallback(() => restoreSessionRef.current?.(), []);
  const sessionChannel = useRef(null);
  const sessionVersion = useRef(0);

  const clearSession = useCallback(() => {
    sessionVersion.current += 1;
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setSessionError("");
    setIsLoading(false);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    sessionChannel.current?.announceLogout();
  }, [clearSession]);

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      const version = ++sessionVersion.current;
      const isCurrent = () => active && sessionVersion.current === version;
      setIsLoading(true);
      try {
        let stored = getStoredSession();
        if (!stored?.session?.token) {
          const shared = await channel.requestSession();
          if (!isCurrent()) return;
          if (shared?.token) stored = { session: shared, storage: sessionStorage };
        }
        if (!stored?.session?.token) {
          if (isCurrent()) setSession(null);
          return;
        }
        const result = await validateSession(stored.session.token);
        if (!isCurrent()) return;
        if (result.status === "invalid") { logout(); return; }
        if (result.status === "unavailable") {
          setSession(stored.session);
          setSessionError(result.message);
          return;
        }
        setSessionError("");
        const updated = { ...stored.session, user: result.user };
        stored.storage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setSession(updated);
      } catch {
        if (isCurrent()) logout();
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    };

    restoreSessionRef.current = restoreSession;
    const channel = createSessionChannel({
      readSession: () => getStoredSession()?.session,
      onSessionAvailable: () => {
        if (!getStoredSession()?.session?.token) restoreSession();
      },
      onLogout: clearSession,
    });
    sessionChannel.current = channel;
    restoreSession();
    return () => {
      active = false;
      restoreSessionRef.current = null;
      channel.close();
      if (sessionChannel.current === channel) sessionChannel.current = null;
    };
  }, [clearSession, logout]);

  const login = useCallback((data, remember = false) => {
    sessionVersion.current += 1;
    const nextSession = { token: data.token, user: data.user };
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    (remember ? localStorage : sessionStorage).setItem(
      STORAGE_KEY,
      JSON.stringify(nextSession),
    );
    setSession(nextSession);
    setSessionError("");
    setIsLoading(false);
    sessionChannel.current?.announceSession();
  }, []);

  const apiFetch = useCallback(
    (url, options = {}) => {
      const headers = new Headers(options.headers);
      if (session?.token)
        headers.set("Authorization", `Bearer ${session.token}`);
      return fetch(url, { ...options, headers }).then((response) => {
        // An invalid/expired token cannot access protected data. Clear it so
        // the protected-route flow returns the user to sign in cleanly.
        if (response.status === 401) logout();
        return response;
      });
    },
    [logout, session?.token],
  );

  const updateUser = useCallback((user) => {
    const stored = getStoredSession();
    if (!stored) return;
    const updated = { ...stored.session, user };
    stored.storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSession(updated);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      isLoading,
      sessionError,
      retrySession,
      isAuthenticated: Boolean(session?.token),
      login,
      logout,
      apiFetch,
      updateUser,
    }),
    [apiFetch, isLoading, login, logout, session, sessionError, retrySession, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
