import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "../styles/Login.css";
import BrandLogo from "../components/BrandLogo";
import { requestAuthEmailAction } from "../utils/authEmailActions";

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestAuthEmailAction(`/api/auth/reset-password/${encodeURIComponent(token)}`, { password });
      setIsSubmitted(true);
    } catch (err) {
      setError(err.message || "Unable to reset your password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-brand-panel">
        <div className="login-brand-content">
          <BrandLogo className="login-logo" inverse />
          <h1>Choose a new password.</h1>
          <p>
            Use a unique password with at least eight characters to protect your
            account.
          </p>
        </div>
      </div>
      <div className="login-form-panel">
        <div className="login-form-wrapper">
          {isSubmitted ? (
            <div className="login-form-header">
              <h2>Password Updated</h2>
              <p>Your password has been reset successfully.</p>
              <button
                type="button"
                className="btn-login-submit"
                onClick={() => navigate("/login")}
              >
                Log In
              </button>
            </div>
          ) : (
            <>
              <div className="login-form-header">
                <h2>Reset Password</h2>
                <p>Enter and confirm your new password.</p>
              </div>
              {error && (
                <div className="login-alert" role="alert">
                  {error}
                </div>
              )}
              <form className="login-form" onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="password">New password</label>
                  <input
                    type="password"
                    id="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm new password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn-login-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Resetting Password…" : "Reset Password"}
                </button>
              </form>
            </>
          )}
          <p className="login-signup-prompt">
            <Link to="/login">← Back to log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
