import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import teamSpiritEmblem from '../assets/team-spirit-emblem.png';
import {
  classifySupabaseAuthError,
  type AuthLoginError,
} from '../hooks/useSupabaseAuth';
import {
  PixelAlertIcon,
  PixelChevronIcon,
  PixelCloseIcon,
  PixelEyeIcon,
  PixelEyeOffIcon,
  PixelLockIcon,
} from './PixelIcons';
import { TeamSpiritWordmark } from './TeamSpiritWordmark';

interface CloudSyncModalProps {
  isOpen: boolean;
  hasLocalRecords: boolean;
  localMemberCount: number;
  localSessionCount: number;
  onClose: () => void;
  onConnect: (
    email: string,
    password: string,
    mergeLocalRecords: boolean,
  ) => Promise<{ error: AuthLoginError | null }>;
}

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dismissible modal dialog enabling optional Supabase Cloud Sync from the top header.
 * Never blocks local-only usage; restricts sign-in strictly to manually provisioned accounts.
 */
export function CloudSyncModal({
  isOpen,
  hasLocalRecords,
  localMemberCount,
  localSessionCount,
  onClose,
  onConnect,
}: CloudSyncModalProps) {
  const titleId = useId();
  const emailInputId = useId();
  const passwordInputId = useId();
  const mergeToggleId = useId();
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mergeLocalRecords, setMergeLocalRecords] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<AuthLoginError | null>(null);
  const [errorPulseKey, setErrorPulseKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    setAuthError(null);
    setPassword('');
    setShowPassword(false);
    setMergeLocalRecords(true);

    const focusTimer = window.setTimeout(() => {
      emailInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

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

  function presentError(
    nextError: AuthLoginError,
    focusOverride?: 'email' | 'password',
  ) {
    setAuthError(nextError);
    setErrorPulseKey((prev) => prev + 1);

    const target =
      focusOverride ??
      (nextError.field === 'email'
        ? 'email'
        : nextError.field === 'password' || nextError.field === 'both'
          ? 'password'
          : undefined);

    if (!target) return;

    window.setTimeout(() => {
      if (target === 'email') {
        emailInputRef.current?.focus();
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail && !password) {
      presentError(
        {
          category: 'validation',
          code: 'ERR_INPUT_REQUIRED',
          title: 'Missing Credentials',
          message:
            'Enter both your account email address and password to connect Cloud Sync.',
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
        message: 'Enter your Team SPIRIT account email address before connecting.',
        hint: 'Use the email registered under Authentication → Users in your Supabase Dashboard.',
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
        message: 'Enter your account password to authenticate with Supabase Cloud Sync.',
        hint: 'Passwords are case-sensitive.',
        field: 'password',
      });
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      const result = await onConnect(
        trimmedEmail,
        password,
        hasLocalRecords && mergeLocalRecords,
      );
      if (result.error) {
        presentError(result.error);
      } else {
        setPassword('');
        onClose();
      }
    } catch (error) {
      presentError(classifySupabaseAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isEmailInvalid = authError?.field === 'email' || authError?.field === 'both';
  const isPasswordInvalid = authError?.field === 'password' || authError?.field === 'both';

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
          aria-label="Close cloud sync dialog"
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
            Enable Supabase Cloud Sync
          </h2>
          <TeamSpiritWordmark className="auth-gate-wordmark" />

          <div className="auth-gate-hud-row">
            <span className="hud-tag">
              <PixelLockIcon width={11} height={11} />
              <span>Cloud Sync</span>
            </span>
            <span className="auth-gate-status-chip">
              <PixelChevronIcon width={10} height={10} />
              <span>Optional</span>
            </span>
          </div>

          <p className="auth-gate-subtitle">
            Sign in with your admin-provisioned Team SPIRIT account to view your linked personal
            attendance record—or unlock full club management if your account is an Administrator.
            Local-only mode stores records solely on this device.
          </p>
        </div>

        <form className="auth-gate-form" onSubmit={handleSubmit} noValidate>
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
                placeholder="Enter password"
                value={password}
                onChange={(event) => handlePasswordChange(event.target.value)}
                autoComplete="current-password"
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
                {localSessionCount === 1 ? 'session' : 'sessions'}) if signing in as an Admin
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
                  aria-label="Dismiss login error"
                  title="Dismiss error"
                >
                  <PixelCloseIcon width={11} height={11} />
                </button>
              </div>
              <p className="auth-error-message">{authError.message}</p>
              <p className="auth-error-hint">{authError.hint}</p>
            </div>
          )}

          <div className="cloud-sync-actions">
            <button
              type="submit"
              className="btn-primary auth-submit-btn"
              disabled={isSubmitting}
            >
              <PixelLockIcon />
              <span>{isSubmitting ? 'Connecting Cloud Sync...' : 'Connect Cloud Sync'}</span>
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

        <div className="auth-gate-footer">
          <span className="auth-gate-dot" aria-hidden="true" />
          <span>Accounts are manually created in the Supabase Dashboard (no self-signup)</span>
        </div>
      </div>
    </div>
  );
}
