import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { canUseBackend } from '../services/apiClient';
import { signInUser, signInWithApple, signInWithGoogle } from '../utils/authStorage';

const GOOGLE_GSI_SCRIPT_ID = 'google-gsi-script';
const GOOGLE_GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const APPLE_AUTH_SCRIPT_ID = 'apple-auth-script';
const APPLE_AUTH_SCRIPT_URL = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

const loadExternalScript = (id, src) =>
  new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Browser environment is unavailable.'));
      return;
    }

    const existingScript = document.getElementById(id);
    if (existingScript) {
      if (existingScript.getAttribute('data-loaded') === 'true') {
        resolve();
        return;
      }
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load authentication script.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.setAttribute('data-loaded', 'true');
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load authentication script.'));
    document.body.appendChild(script);
  });

const createNonce = () => {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
};

const Login = ({ currentUser, onAuthSuccess }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isAppleSubmitting, setIsAppleSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState(null);
  const appleAuthInitializedRef = useRef(false);
  const googleClientId = String(process.env.REACT_APP_GOOGLE_CLIENT_ID || '').trim();
  const appleClientId = String(process.env.REACT_APP_APPLE_CLIENT_ID || '').trim();
  const appleRedirectUri = String(
    process.env.REACT_APP_APPLE_REDIRECT_URI || (typeof window !== 'undefined' ? `${window.location.origin}` : '')
  ).trim();
  const backendAvailable = canUseBackend();
  const canUseGoogleSignIn = backendAvailable && Boolean(googleClientId);
  const canUseAppleSignIn = backendAvailable && Boolean(appleClientId) && Boolean(appleRedirectUri);

  useEffect(() => {
    if (currentUser) {
      navigate('/');
    }
  }, [currentUser, navigate]);

  const handleAuthSuccess = (user) => {
    if (onAuthSuccess) onAuthSuccess(user);
    navigate('/');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFormMessage(null);

    try {
      const user = await signInUser({ email, password });
      handleAuthSuccess(user);
    } catch (error) {
      setFormMessage({ type: 'error', text: error?.message || 'Could not sign in. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!canUseGoogleSignIn) {
      if (!backendAvailable) {
        setFormMessage({ type: 'error', text: 'Start the backend API to use Google sign-in.' });
        return;
      }
      setFormMessage({ type: 'error', text: 'Google sign-in is not configured. Add REACT_APP_GOOGLE_CLIENT_ID to .env.local.' });
      return;
    }

    if (isGoogleSubmitting || isSubmitting || isAppleSubmitting) return;
    setIsGoogleSubmitting(true);
    setFormMessage(null);

    try {
      await loadExternalScript(GOOGLE_GSI_SCRIPT_ID, GOOGLE_GSI_SCRIPT_URL);
      if (!window.google?.accounts?.oauth2?.initTokenClient) {
        throw new Error('Google sign-in SDK did not initialize.');
      }

      const accessToken = await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'openid email profile',
          callback: (tokenResponse) => {
            if (tokenResponse?.error) {
              reject(new Error(tokenResponse.error_description || 'Google sign-in was canceled.'));
              return;
            }
            if (!tokenResponse?.access_token) {
              reject(new Error('Google sign-in did not return an access token.'));
              return;
            }
            resolve(tokenResponse.access_token);
          }
        });

        try {
          tokenClient.requestAccessToken({ prompt: 'select_account' });
        } catch {
          reject(new Error('Could not open Google sign-in window.'));
        }
      });

      const user = await signInWithGoogle({ accessToken });
      handleAuthSuccess(user);
    } catch (error) {
      setFormMessage({ type: 'error', text: error?.message || 'Google sign-in failed. Please try again.' });
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (!canUseAppleSignIn) {
      if (!backendAvailable) {
        setFormMessage({ type: 'error', text: 'Start the backend API to use Apple sign-in.' });
        return;
      }
      if (!appleClientId) {
        setFormMessage({ type: 'error', text: 'Apple sign-in is not configured. Add REACT_APP_APPLE_CLIENT_ID to .env.local.' });
        return;
      }
      setFormMessage({ type: 'error', text: 'Apple sign-in needs REACT_APP_APPLE_REDIRECT_URI in .env.local.' });
      return;
    }

    if (isAppleSubmitting || isSubmitting || isGoogleSubmitting) return;
    setIsAppleSubmitting(true);
    setFormMessage(null);

    try {
      await loadExternalScript(APPLE_AUTH_SCRIPT_ID, APPLE_AUTH_SCRIPT_URL);
      if (!window.AppleID?.auth?.signIn) {
        throw new Error('Apple sign-in SDK did not initialize.');
      }

      if (!appleAuthInitializedRef.current) {
        window.AppleID.auth.init({
          clientId: appleClientId,
          scope: 'name email',
          redirectURI: appleRedirectUri,
          usePopup: true,
          state: `bookhub-${Date.now()}`,
          nonce: createNonce()
        });
        appleAuthInitializedRef.current = true;
      }

      const response = await window.AppleID.auth.signIn();
      const idToken = String(response?.authorization?.id_token || '').trim();
      if (!idToken) {
        throw new Error('Apple sign-in did not return an identity token.');
      }

      const appleName = [response?.user?.name?.firstName, response?.user?.name?.lastName]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
      const appleEmail = String(response?.user?.email || '').trim();

      const user = await signInWithApple({
        idToken,
        name: appleName,
        email: appleEmail
      });
      handleAuthSuccess(user);
    } catch (error) {
      setFormMessage({ type: 'error', text: error?.message || 'Apple sign-in failed. Please try again.' });
    } finally {
      setIsAppleSubmitting(false);
    }
  };

  return (
    <div className="glass-container d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <div className="w-100" style={{ maxWidth: '400px' }}>
        <h2 className="text-center mb-4">Sign In</h2>
        {formMessage && (
          <div className={`friends-notice ${formMessage.type === 'error' ? 'error' : 'success'}`} role="alert">
            {formMessage.text}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="email" className="form-label">Email</label>
            <input
              type="email"
              className="form-control"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="mb-3">
            <label htmlFor="password" className="form-label">Password</label>
            <input
              type="password"
              className="form-control"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
            {isSubmitting ? 'Signing In...' : 'Sign In'}
          </button>
          <div className="text-center my-3">or</div>
          <button
            type="button"
            className="btn social-btn btn-google w-100 mb-2"
            disabled={!canUseGoogleSignIn || isGoogleSubmitting || isSubmitting || isAppleSubmitting}
            onClick={handleGoogleSignIn}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="18" height="18" className="me-2" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.3 1.2 8.2 2.9l6.1-6.1C34.9 3.1 29.9 1 24 1 14.8 1 7 6 3.4 13.2l7.3 5.7C12.8 14.1 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.2c0-1.6-.1-3.1-.4-4.6H24v8.7h12.6c-.5 2.8-2 5.1-4.3 6.6l6.9 5.3C44.6 36.1 46.5 30.6 46.5 24.2z"/><path fill="#FBBC05" d="M10.7 28.9c-.8-2.3-1.3-4.7-1.3-7.2s.5-4.9 1.3-7.2L3.4 9.7C1.2 13.5 0 18 0 23s1.2 9.5 3.4 13.3l7.3-7.4z"/><path fill="#34A853" d="M24 46c6.1 0 11.3-2 15-5.5l-7.3-5.9c-2.1 1.4-4.7 2.2-7.7 2.2-6.2 0-11.2-4.6-12.6-10.8L3.4 34.8C7 42 14.8 47 24 47z"/></svg>
            {isGoogleSubmitting ? 'Connecting Google...' : 'Sign in with Google'}
          </button>
          <button
            type="button"
            className="btn social-btn btn-apple w-100"
            disabled={!canUseAppleSignIn || isAppleSubmitting || isSubmitting || isGoogleSubmitting}
            onClick={handleAppleSignIn}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" className="me-2" aria-hidden="true"><path fill="#ffffff" d="M16.365 1.43c-.975.064-2.078.667-2.756 1.46-.594.706-1.11 1.847-.92 2.948 1.02.08 2.064-.52 2.68-1.305.56-.72 1.01-1.902.996-2.999zM12.02 4.9c-1.498 0-3.1.962-4.03 2.53-1.07 1.9-.58 4.9 1.02 6.86.72.86 1.49 1.78 2.67 1.78 1.18 0 1.76-.83 2.77-.83 1.01 0 1.6.83 2.77.83 1.3 0 2.21-.92 2.93-1.78.43-.53.8-1.1 1.06-1.7-2.78-1.08-3.82-3.98-3.82-6.14 0-2.07 1.17-3.4 2.62-4.32-1.34-.23-2.74-.18-3.9.25-.94.35-1.78.57-2.76.57z"/></svg>
            {isAppleSubmitting ? 'Connecting Apple...' : 'Sign in with Apple'}
          </button>
          {!backendAvailable && (
            <small className="settings-file-help d-block mt-2 text-center">
              Start the backend API to use social sign-in.
            </small>
          )}
        </form>
        <p className="text-center mt-3">
          Don't have an account? <Link to="/signup">Sign Up</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
