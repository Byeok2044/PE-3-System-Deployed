import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Logout() {
  const { logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const hasLoggedOut = useRef(false);

  useEffect(() => {
    if (hasLoggedOut.current) return;
    hasLoggedOut.current = true;
    logout();
  }, [logout]);

  useEffect(() => {
    if (!isAuthenticated) navigate("/login", { replace: true, state: null });
  }, [isAuthenticated, navigate]);

  return <p className="auth-loading" role="status">Signing out...</p>;
}
