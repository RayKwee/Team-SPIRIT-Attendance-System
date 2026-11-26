import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import teamSpiritEmblem from '../assets/team-spirit-emblem.png';
import {
  classifySupabaseAuthError,
  classifySupabaseSignUpError,
  type AuthLoginError,
} from '../hooks/useSupabaseAuth';
import {
  PixelAlertIcon,
  PixelChevronIcon,
  PixelCloseIcon,
  PixelEyeIcon,
  PixelEyeOffIcon,
  PixelLockIcon,
  PixelShieldIcon,
  PixelUserIcon,
} from './PixelIcons';
import { TeamSpiritWordmark } from './TeamSpiritWordmark';

export type AuthModalMode = 'login' | 'register';

interface CloudSyncModalProps {
  isOpen: boolean;
  initialMode?: AuthModalMode;
  hasLocalRecords: boolean;
  localMemberCount: number;
  localSessionCount: number;
  onClose: () => void;
  onConnect: (
    email: string,
    password: string,
    mergeLocalRecords: boolean,
  ) => Promise<{ error: AuthLoginError | null }>;
  onRegisterAdmin: (
    email: string,
    password: string,
    mergeLocalRecords: boolean,
  ) => Promise<{ error: AuthLoginError | null }>;
}

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dismissible authentication modal supporting Login and Self-Service Admin Registration
 * (auto-verified without email confirmation), while preserving optional Local-Only usage.
 */
export function CloudSyncModal({
  isOpen,
  initialMode = 'login',
  hasLocalRecords,
  localMemberCount,
  localSessionCount,
  onClose,
  onConnect,
  onRegisterAdmin,
}: CloudSyncModalProps) {
  const titleId = useId();
  const emailInputId = useId();
  const passwordInputId = useId();
  const confirmPasswordInputId = useId();
  const mergeToggleId = useId();
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mergeLocalRecords, setMergeLocalRecords] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<AuthLoginError | null>(null);
  const [errorPulseKey, setErrorPulseKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    setMode(initialMode);
    setAuthError(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setMergeLocalRecords(true);

    const focusTimer = window.setTimeout(() => {
      emailInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [initialMode, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  const isRegisterMode = mode === 'register';

  function handleSwitchMode(nextMode: AuthModalMode) {
    if (isSubmitting || nextMode === mode) return;
    setMode(nextMode);
    setAuthError(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    window.setTimeout(() => {
      emailInputRef.current?.focus();
    }, 0);
  }

  function presentError(
    nextError: AuthLoginError,
    focusOverride?: 'email' | 'password' | 'confirm',
  ) {
    setAuthError(nextError);
    setErrorPulseKey((prev) => prev + 1);

    const target =
      focusOverride ??
      (nextError.field === 'email'
        ? 'email'
        : nextError.field === 'confirm'
          ? 'confirm'
          : nextError.field === 'password' || nextError.field === 'both'
            ? 'password'
            : undefined);

    if (!target) return;

    window.setTimeout(() => {
      if (target === 'email') {
        emailInputRef.current?.focus();
      } else if (target === 'confirm') {
        confirmPasswordInputRef.current?.focus();
      } else {
        passwordInputRef.current?.focus();
      }
    }, 0);
  }

  function handleEmailChange(nextValue: string) {
    setEmail(nextValue);
    setAuthError((prev) => {
      if (!prev) return prev;
      if (prev.field === 'email') return { ...prev, field: undefined };
      if (prev.field === 'both') return { ...prev, field: 'password' };
      return prev;
    });
  }

  function handlePasswordChange(nextValue: string) {
    setPassword(nextValue);
    setAuthError((prev) => {
      if (!prev) return prev;
      if (prev.field === 'password') return { ...prev, field: undefined };
      if (prev.field === 'both') return { ...prev, field: 'email' };
      return prev;
    });
  }

  function handleConfirmPasswordChange(nextValue: string) {
    setConfirmPassword(nextValue);
    setAuthError((prev) => {
      if (!prev) return prev;
      if (prev.field === 'confirm') return { ...prev, field: undefined };
      return prev;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail && !password) {
      presentError(
        {
          category: 'validation',
          code: 'ERR_INPUT_REQUIRED',
          title: 'Missing Credentials',
          message: isRegisterMode
            ? 'Enter an email address and password to create your Admin account.'
            : 'Enter both your account email address and password to sign in.',
          hint: 'Or click "Continue in Local-Only Mode" below to keep working offline on this device.',
          field: 'both',
        },
        'email',
      );
      return;
    }

    if (!trimmedEmail) {
      presentError({
        category: 'validation',
        code: 'ERR_EMAIL_REQUIRED',
        title: 'Email Address Required',
        message: 'Enter your Team SPIRIT account email address.',
        hint: 'Example: operator@teamspirit.club',
        field: 'email',
      });
      return;
    }

    if (!EMAIL_FORMAT_RE.test(trimmedEmail)) {
      presentError({
        category: 'validation',
        code: 'ERR_INVALID_EMAIL',
        title: 'Invalid Email Format',
        message: 'The email address entered is not formatted properly.',
        hint: 'Enter a valid email address (for example: operator@teamspirit.club).',
        field: 'email',
      });
      return;
    }

    if (!password) {
      presentError({
        category: 'validation',
        code: 'ERR_PASSWORD_REQUIRED',
        title: 'Password Required',
        message: isRegisterMode
          ? 'Choose a password for your new Admin account.'
          : 'Enter your account password to sign in.',
        hint: isRegisterMode ? 'Use at least 6 characters.' : 'Passwords are case-sensitive.',
        field: 'password',
      });
      return;
    }

    if (isRegisterMode) {
      if (password.length < 6) {
        presentError({
          category: 'weak_password',
          code: 'ERR_WEAK_PASSWORD',
          title: 'Password Too Short',
          message: 'Password must be at least 6 characters long.',
          hint: 'Enter at least 6 characters to create your Admin account.',
          field: 'password',
        });
        return;
      }

      if (!confirmPassword) {
        presentError({
          category: 'validation',
          code: 'ERR_CONFIRM_REQUIRED',
          title: 'Confirm Password',
          message: 'Re-enter your password to confirm.',
          hint: 'Both password fields must match.',
          field: 'confirm',
        });
        return;
      }

      if (password !== confirmPassword) {
        presentError({
          category: 'validation',
          code: 'ERR_PASSWORD_MISMATCH',
          title: 'Passwords Do Not Match',
          message: 'The confirmation password does not match the password entered above.',
          hint: 'Verify both fields and try again.',
          field: 'confirm',
        });
        return;
      }
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      const result = isRegisterMode
        ? await onRegisterAdmin(trimmedEmail, password, hasLocalRecords && mergeLocalRecords)
        : await onConnect(trimmedEmail, password, hasLocalRecords && mergeLocalRecords);

      if (result.error) {
        presentError(result.error);
      } else {
        setPassword('');
        setConfirmPassword('');
        onClose();
      }
    } catch (error) {
      presentError(
        isRegisterMode ? classifySupabaseSignUpError(error) : classifySupabaseAuthError(error),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isEmailInvalid = authError?.field === 'email' || authError?.field === 'both';
  const isPasswordInvalid = authError?.field === 'password' || authError?.field === 'both';
  const isConfirmInvalid = authError?.field === 'confirm';

  return (
    <div
      className="modal-backdrop cloud-sync-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="auth-gate-card cloud-sync-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <span className="preloader-corner preloader-corner-tl" aria-hidden="true" />
        <span className="preloader-corner preloader-corner-tr" aria-hidden="true" />
        <span className="preloader-corner preloader-corner-bl" aria-hidden="true" />
        <span className="preloader-corner preloader-corner-br" aria-hidden="true" />

        <button
          type="button"
          className="modal-close-btn cloud-sync-close-btn"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Close authentication dialog"
          title="Close and continue in local-only mode"
        >
          <PixelCloseIcon />
        </button>

        <div className="auth-gate-header">
          <div className="auth-gate-emblem-ring" aria-hidden="true">
            <img
              src={teamSpiritEmblem}
              alt=""
              className="auth-gate-emblem"
              width={56}
              height={56}
            />
          </div>

          <h2 id={titleId} className="sr-only">
            {isRegisterMode ? 'Create Team SPIRIT Admin Account' : 'Login to Team SPIRIT Cloud Sync'}
          </h2>
          <TeamSpiritWordmark className="auth-gate-wordmark" />

          <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegisterMode}
              className={`auth-mode-tab ${!isRegisterMode ? 'is-active' : ''}`}
              onClick={() => handleSwitchMode('login')}
              disabled={isSubmitting}
            >
              <PixelLockIcon width={12} height={12} />
              <span>Login</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegisterMode}
              className={`auth-mode-tab ${isRegisterMode ? 'is-active' : ''}`}
              onClick={() => handleSwitchMode('register')}
              disabled={isSubmitting}
            >
              <PixelShieldIcon width={12} height={12} />
              <span>Create Account</span>
            </button>
          </div>

          <div className="auth-gate-hud-row">
            <span className="hud-tag">
              {isRegisterMode ? (
                <PixelShieldIcon width={11} height={11} />
              ) : (
                <PixelLockIcon width={11} height={11} />
              )}
              <span>{isRegisterMode ? 'Admin Role' : 'Cloud Sync'}</span>
            </span>
            <span className={`auth-gate-status-chip ${isRegisterMode ? 'is-verified' : ''}`}>
              <PixelChevronIcon width={10} height={10} />
              <span>{isRegisterMode ? 'Auto-Verified' : 'Admin & Member'}</span>
            </span>
          </div>

          <p className="auth-gate-subtitle">
            {isRegisterMode
              ? 'Register a new Administrator account with instant access — verified automatically with no email confirmation required.'
              : 'Sign in with your Team SPIRIT account to sync attendance, roster profiles, and club updates across devices.'}
          </p>
        </div>

        <form className="auth-gate-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="auth-field">
            <label className="auth-field-label" htmlFor={emailInputId}>
              Account Email
            </label>
            <input
              ref={emailInputRef}
              id={emailInputId}
              type="email"
              className={`auth-input ${isEmailInvalid ? 'is-invalid' : ''}`}
              placeholder="operator@teamspirit.club"
              value={email}
              onChange={(event) => handleEmailChange(event.target.value)}
              autoComplete="email"
              aria-invalid={isEmailInvalid || undefined}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-field-label" htmlFor={passwordInputId}>
              Password
            </label>
            <div className="auth-password-wrap">
              <input
                ref={passwordInputRef}
                id={passwordInputId}
                type={showPassword ? 'text' : 'password'}
                className={`auth-input auth-input-password ${isPasswordInvalid ? 'is-invalid' : ''}`}
                placeholder={isRegisterMode ? 'Min. 6 characters' : 'Enter password'}
                value={password}
                onChange={(event) => handlePasswordChange(event.target.value)}
                autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                aria-invalid={isPasswordInvalid || undefined}
                disabled={isSubmitting}
                required
              />
              <button
                type="button"
                className="auth-visibility-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                disabled={isSubmitting}
              >
                {showPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
              </button>
            </div>
          </div>

          {isRegisterMode && (
            <div className="auth-field">
              <label className="auth-field-label" htmlFor={confirmPasswordInputId}>
                Confirm Password
              </label>
              <div className="auth-password-wrap">
                <input
                  ref={confirmPasswordInputRef}
                  id={confirmPasswordInputId}
                  type={showConfirmPassword ? 'text' : 'password'}
                  className={`auth-input auth-input-password ${isConfirmInvalid ? 'is-invalid' : ''}`}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(event) => handleConfirmPasswordChange(event.target.value)}
                  autoComplete="new-password"
                  aria-invalid={isConfirmInvalid || undefined}
                  disabled={isSubmitting}
                  required
                />
                <button
                  type="button"
                  className="auth-visibility-btn"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  title={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  disabled={isSubmitting}
                >
                  {showConfirmPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                </button>
              </div>
            </div>
          )}

          {hasLocalRecords && (
            <label className="cloud-sync-merge-option" htmlFor={mergeToggleId}>
              <input
                id={mergeToggleId}
                type="checkbox"
                checked={mergeLocalRecords}
                onChange={(event) => setMergeLocalRecords(event.target.checked)}
                disabled={isSubmitting}
              />
              <span>
                Upload &amp; merge current local-device data ({localMemberCount}{' '}
                {localMemberCount === 1 ? 'member' : 'members'}, {localSessionCount}{' '}
                {localSessionCount === 1 ? 'session' : 'sessions'})
                {isRegisterMode ? ' into this new Admin workspace' : ' if signing in as an Admin'}
              </span>
            </label>
          )}

          {authError && (
            <div
              key={errorPulseKey}
              className="auth-error-banner"
              role="alert"
              aria-live="assertive"
            >
              <div className="auth-error-header">
                <div className="auth-error-title-group">
                  <PixelAlertIcon width={14} height={14} />
                  <span className="auth-error-code-badge">[{authError.code}]</span>
                  <strong className="auth-error-title">{authError.title}</strong>
                </div>
                <button
                  type="button"
                  className="auth-error-dismiss"
                  onClick={() => setAuthError(null)}
                  aria-label="Dismiss authentication error"
                  title="Dismiss error"
                >
                  <PixelCloseIcon width={11} height={11} />
                </button>
              </div>
              <p className="auth-error-message">{authError.message}</p>
              <p className="auth-error-hint">{authError.hint}</p>
              {isRegisterMode && authError.category === 'already_exists' && (
                <button
                  type="button"
                  className="btn-secondary btn-compact auth-error-switch-btn"
                  onClick={() => handleSwitchMode('login')}
                >
                  <PixelLockIcon width={11} height={11} />
                  <span>Switch to Login</span>
                </button>
              )}
            </div>
          )}

          <div className="cloud-sync-actions">
            <button
              type="submit"
              className="btn-primary auth-submit-btn"
              disabled={isSubmitting}
            >
              {isRegisterMode ? <PixelShieldIcon /> : <PixelLockIcon />}
              <span>
                {isSubmitting
                  ? isRegisterMode
                    ? 'Creating Admin Account...'
                    : 'Signing In...'
                  : isRegisterMode
                    ? 'Create Admin Account'
                    : 'Login'}
              </span>
            </button>
            <button
              type="button"
              className="btn-secondary cloud-sync-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Continue in Local-Only Mode
            </button>
          </div>
        </form>

        <div className="auth-gate-footer auth-gate-footer-switch">
          <span className="auth-gate-footer-copy">
            <PixelUserIcon width={11} height={11} />
            <span>
              {isRegisterMode ? 'Already have an account?' : 'New administrator?'}
            </span>
          </span>
          <button
            type="button"
            className="auth-footer-switch-btn"
            onClick={() => handleSwitchMode(isRegisterMode ? 'login' : 'register')}
            disabled={isSubmitting}
          >
            {isRegisterMode ? 'Login' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
