import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../styles/Login.css";
import BrandLogo from "../components/BrandLogo";
import { requestAuthEmailAction } from "../utils/authEmailActions";

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleChange = (e) => {
    setEmail(e.target.value);
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestAuthEmailAction("/api/auth/forgot-password", { email: email.trim() });

      setIsSubmitted(true);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      {/* Brand Panel */}
      <div className="login-brand-panel">
        <div className="login-brand-content">
          <BrandLogo className="login-logo" inverse />
          <h1>Let&apos;s get you back into your account.</h1>
          <p>
            Enter the email tied to your account and we&apos;ll send you a link
            to reset your password and get back to your dashboards.
          </p>
          <ul className="login-brand-points">
            <li>Real-time attrition risk flags</li>
            <li>Predictive GPA &amp; course forecasting</li>
            <li>University-wide analytics dashboards</li>
          </ul>
        </div>
      </div>

      {/* Form Panel */}
      <div className="login-form-panel">
        <div className="login-form-wrapper">
          {!isSubmitted ? (
            <>
              <div className="login-form-header">
                <h2>Forgot Password</h2>
                <p>Enter your email and we&apos;ll send you a reset link.</p>
              </div>

              {error && (
                <div className="login-alert" role="alert">
                  {error}
                </div>
              )}

              <form className="login-form" onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="email">Email address</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@university.edu"
                    value={email}
                    onChange={handleChange}
                    className={error ? "input-error" : ""}
                  />
                  {error && <span className="field-error">{error}</span>}
                </div>

                <button
                  type="submit"
                  className="btn-login-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending Link…" : "Send Reset Link"}
                </button>
              </form>
            </>
          ) : (
            <div className="login-form-header">
              <h2>Check Your Email</h2>
              <p>
                If an account exists for <strong>{email}</strong>, a password
                reset link is on its way. It may take a few minutes to arrive.
              </p>
            </div>
          )}

          <p className="login-signup-prompt">
            Remembered your password? <Link to="/login">Log in</Link>
          </p>

          <button
            type="button"
            className="login-back-home"
            onClick={() => navigate("/login")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              width: "100%",
            }}
          >
            Back to log in
          </button>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
