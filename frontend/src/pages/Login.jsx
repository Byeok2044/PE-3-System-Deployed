import React, { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandLogo from "../components/BrandLogo";
import "../styles/Login.css";

const Login = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [isResending, setIsResending] = useState(false);
  const from = location.state?.from;
  const destination = from?.pathname?.startsWith("/dashboard")
    ? `${from.pathname}${from.search || ""}${from.hash || ""}`
    : "/dashboard";

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.email.trim()) {
      newErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Enter a valid email address.";
    }
    if (!formData.password) {
      newErrors.password = "Password is required.";
    }
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError("");
    setNeedsVerification(false);
    setResendMessage("");

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          remember: rememberMe,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.code === "EMAIL_NOT_VERIFIED") setNeedsVerification(true);
        throw new Error(data.message || "Invalid email or password.");
      }

      const data = await response.json();
      login(data, rememberMe);
      navigate(destination, { replace: true });
    } catch (err) {
      setServerError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendVerification = async () => {
    setIsResending(true);
    setResendMessage("");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not resend the verification email.");
      setResendMessage(data.message);
    } catch (error) {
      setResendMessage(error.message || "Could not resend the verification email.");
    } finally {
      setIsResending(false);
    }
  };

  if (isLoading) return <div className="auth-loading">Checking your session.</div>;
  if (isAuthenticated) return <Navigate to={destination} replace />;

  return (
    <div className="login-page">
      {/* Brand Panel */}
      <div className="login-brand-panel">
        <div className="login-brand-content">
          <BrandLogo className="login-logo" inverse />
          <h1>Welcome back to Retainify.</h1>
          <p>
            Sign in to manage your academic information, review available
            forecasts, and stay connected with your academic support contacts.
          </p>
          <ul className="login-brand-points">
            <li>Academic record and personal forecast tools</li>
            <li>Professor–student connection requests</li>
            <li>Private messages for accepted connections</li>
          </ul>
        </div>
      </div>

      {/* Form Panel */}
      <div className="login-form-panel">
        <div className="login-form-wrapper">
          <div className="login-form-header">
            <h2>Log In</h2>
            <p>Enter your credentials to access your account.</p>
          </div>

          {location.state?.successMessage && (
            <div className="login-success" role="status">
              {location.state.successMessage}
            </div>
          )}

          {serverError && (
            <div className="login-alert" role="alert">
              {serverError}
            </div>
          )}
          {needsVerification && (
            <div className="login-success" role="status">
              <p>Didn&apos;t receive it?</p>
              <button type="button" className="resend-verification" onClick={resendVerification} disabled={isResending}>
                {isResending ? "Sending…" : "Resend verification email"}
              </button>
              {resendMessage && <span>{resendMessage}</span>}
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
                value={formData.email}
                onChange={handleChange}
                className={errors.email ? "input-error" : ""}
              />
              {errors.email && (
                <span className="field-error">{errors.email}</span>
              )}
            </div>

            <div className="form-group">
              <div className="form-label-row">
                <label htmlFor="password">Password</label>
                <Link to="/forgot-password" className="forgot-link">
                  Forgot password?
                </Link>
              </div>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  className={errors.password ? "input-error" : ""}
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {errors.password && (
                <span className="field-error">{errors.password}</span>
              )}
            </div>

            <div className="form-remember-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Remember me
              </label>
            </div>

            <button
              type="submit"
              className="btn-login-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Signing In…" : "Log In"}
            </button>
          </form>

          <p className="login-signup-prompt">
            Don&apos;t have an account? <Link to="/register">Sign up</Link>
          </p>

          <Link to="/" className="login-back-home">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
