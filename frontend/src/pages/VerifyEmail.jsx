import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";
import "../styles/Login.css";
import { requestEmailVerification } from "../utils/emailVerification";

const VerifyEmail = () => {
  const { token } = useParams();
  const [status, setStatus] = useState("verifying");
  const [attempt, setAttempt] = useState(0);
  const request = useRef(null);
  const [message, setMessage] = useState("Verifying your email address…");

  useEffect(() => {
    let active = true;
    setStatus("verifying");
    const key = `${token}:${attempt}`;
    // Reuse the in-flight request when StrictMode replays the effect.
    if (request.current?.key !== key) request.current = { key, promise: requestEmailVerification(token) };
    const verify = async () => {
      try {
        const result = await request.current.promise;
        if (!active) return;
        setStatus("success");
        setMessage(result);
      } catch (error) {
        if (!active) return;
        setStatus("error");
        setMessage(error.message || "Unable to verify this email address.");
      }
    };

    verify();
    return () => { active = false; };
  }, [token, attempt]);

  return (
    <div className="login-page">
      <div className="login-brand-panel">
        <div className="login-brand-content">
          <BrandLogo className="login-logo" inverse />
          <h1>Secure your account before you begin.</h1>
        </div>
      </div>
      <div className="login-form-panel">
        <div className="login-form-wrapper">
          <div className="login-form-header">
            <h2>{status === "success" ? "Email verified" : "Verify your email"}</h2>
            <p>{message}</p>
          </div>
          {status === "verifying" && <div className="login-success" role="status">Please wait…</div>}
          {status === "error" && <div className="login-alert" role="alert">{message}</div>}
          {status === "error" && <>
            <button type="button" className="btn-login-submit" onClick={() => setAttempt(value => value + 1)}>Try verifying again</button>
            <p><Link to="/login">Go to log in to resend a verification email</Link></p>
          </>}
          {status === "success" && (
            <Link to="/login" className="btn-login-submit verify-email-login-link">
              Continue to log in
            </Link>
          )}
          <Link to="/" className="login-back-home">← Back to home</Link>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
