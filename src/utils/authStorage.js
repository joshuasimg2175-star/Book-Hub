import { apiRequest, canUseBackend } from '../services/apiClient';
import {
  AUTH_CURRENT_USER_STORAGE_KEY,
  AUTH_SESSION_TOKEN_KEY,
  AUTH_USERS_STORAGE_KEY
} from './authKeys';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const normalizeUsername = (username) => String(username || '').trim().toLowerCase();
const normalizeUsernameInput = (username) => normalizeUsername(String(username || '').replace(/^@+/, ''));
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 24;

const isValidUsername = (username) => /^[a-z0-9]{3,24}$/.test(normalizeUsername(username));

const usernameSeed = (value) => {
  const cleaned = normalizeUsername(value).replace(/[^a-z0-9]/g, '');
  if (cleaned.length >= USERNAME_MIN_LENGTH) return cleaned.slice(0, USERNAME_MAX_LENGTH);
  const fallback = `reader${cleaned}`.replace(/[^a-z0-9]/g, '');
  return (fallback.length >= USERNAME_MIN_LENGTH ? fallback : 'reader').slice(0, USERNAME_MAX_LENGTH);
};

const generateLocalUsername = (preferredValue, users, excludeUserId = '') => {
  const taken = new Set(
    users
      .filter((user) => String(user.id) !== String(excludeUserId))
      .map((user) => normalizeUsername(user.username))
      .filter(Boolean)
  );
  const base = usernameSeed(preferredValue);
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    const suffixText = String(suffix++);
    candidate = `${base.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
  }
  return candidate;
};

const readJson = (key, fallbackValue) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
};

const writeJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const dispatchAuthUpdated = () => {
  window.dispatchEvent(new Event('authUpdated'));
};

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  email: user.email,
  authProvider: user.authProvider || 'password',
  createdAt: user.createdAt
});

const parseAuthError = (error, fallbackMessage) => {
  const backendMessage = error?.response?.data?.error;
  if (backendMessage) return backendMessage;
  if (error?.code === 'ECONNABORTED' || error?.message === 'Network Error') {
    return 'Could not reach the account server. Make sure backend API is running.';
  }
  return fallbackMessage;
};

const setSession = ({ user, token = '' }) => {
  if (user && typeof user === 'object') {
    writeJson(AUTH_CURRENT_USER_STORAGE_KEY, user);
  } else {
    localStorage.removeItem(AUTH_CURRENT_USER_STORAGE_KEY);
  }

  if (token) {
    localStorage.setItem(AUTH_SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_SESSION_TOKEN_KEY);
  }
};

const applyServerAuthResponse = (response) => {
  const user = response?.data?.user;
  const token = response?.data?.token;
  if (!user || !token) {
    throw new Error('Invalid authentication response from server.');
  }
  setSession({ user, token });
  dispatchAuthUpdated();
  return user;
};

const localGetUsers = () => {
  const users = readJson(AUTH_USERS_STORAGE_KEY, []);
  return Array.isArray(users) ? users : [];
};

const localSignUpUser = ({ name, email, password, username }) => {
  const safeName = String(name || '').trim();
  const safeEmail = normalizeEmail(email);
  const safePassword = String(password || '');
  const requestedUsername = normalizeUsernameInput(username);

  if (safeName.length < 2) {
    throw new Error('Name must be at least 2 characters.');
  }
  if (!safeEmail) {
    throw new Error('Email is required.');
  }
  if (safePassword.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const users = localGetUsers();
  const existing = users.find((user) => normalizeEmail(user.email) === safeEmail);
  if (existing) {
    throw new Error('An account with that email already exists.');
  }

  if (requestedUsername) {
    if (!isValidUsername(requestedUsername)) {
      throw new Error(`Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} letters/numbers.`);
    }
    const usernameConflict = users.some((user) => normalizeUsername(user.username) === requestedUsername);
    if (usernameConflict) {
      throw new Error('That username is already taken.');
    }
  }

  const resolvedUsername = requestedUsername || generateLocalUsername(safeName || safeEmail, users);

  const newUser = {
    id: `u-${Date.now()}`,
    name: safeName,
    username: resolvedUsername,
    email: safeEmail,
    password: safePassword,
    createdAt: new Date().toISOString()
  };

  writeJson(AUTH_USERS_STORAGE_KEY, [...users, newUser]);
  const sessionUser = sanitizeUser(newUser);
  setSession({ user: sessionUser, token: `local-${newUser.id}` });
  dispatchAuthUpdated();
  return sessionUser;
};

const localSignInUser = ({ email, password }) => {
  const safeEmail = normalizeEmail(email);
  const safePassword = String(password || '');
  if (!safeEmail || !safePassword) {
    throw new Error('Email and password are required.');
  }

  const users = localGetUsers();
  const matchedUser = users.find(
    (user) => normalizeEmail(user.email) === safeEmail && String(user.password) === safePassword
  );
  if (!matchedUser) {
    throw new Error('Incorrect email or password.');
  }

  const sessionUser = sanitizeUser(matchedUser);
  setSession({ user: sessionUser, token: `local-${matchedUser.id}` });
  dispatchAuthUpdated();
  return sessionUser;
};

export const getUsers = () => localGetUsers();

export const getCurrentUser = () => {
  const stored = readJson(AUTH_CURRENT_USER_STORAGE_KEY, null);
  return stored && typeof stored === 'object' ? stored : null;
};

export const getSessionToken = () => {
  try {
    return localStorage.getItem(AUTH_SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const refreshCurrentUserFromServer = async () => {
  if (!canUseBackend()) return getCurrentUser();

  const token = getSessionToken();
  if (!token || token.startsWith('local-')) return getCurrentUser();

  try {
    const response = await apiRequest({
      method: 'GET',
      path: '/api/auth/me',
      token
    });
    const user = response.data?.user;
    if (user) {
      setSession({ user, token });
      dispatchAuthUpdated();
      return user;
    }
    return getCurrentUser();
  } catch (error) {
    if (error?.response?.status === 401) {
      setSession({ user: null, token: '' });
      dispatchAuthUpdated();
      return null;
    }
    return getCurrentUser();
  }
};

export const signUpUser = async ({ name, email, password, username }) => {
  if (!canUseBackend()) {
    return localSignUpUser({ name, email, password, username });
  }

  try {
    const requestedUsername = normalizeUsernameInput(username);
    const response = await apiRequest({
      method: 'POST',
      path: '/api/auth/signup',
      data: { name, email, password, username: requestedUsername || undefined }
    });
    const user = response.data?.user;
    const token = response.data?.token;
    if (!user || !token) {
      throw new Error('Invalid account response from server.');
    }
    setSession({ user, token });
    dispatchAuthUpdated();
    return user;
  } catch (error) {
    if (error?.code === 'backend_disabled') {
      return localSignUpUser({ name, email, password, username });
    }
    throw new Error(parseAuthError(error, 'Could not create account. Please try again.'));
  }
};

export const signInUser = async ({ email, password }) => {
  if (!canUseBackend()) {
    return localSignInUser({ email, password });
  }

  try {
    const response = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      data: { email, password }
    });
    return applyServerAuthResponse(response);
  } catch (error) {
    if (error?.code === 'backend_disabled') {
      return localSignInUser({ email, password });
    }
    throw new Error(parseAuthError(error, 'Could not sign in. Please try again.'));
  }
};

const signInWithOAuthProvider = async ({ provider, payload }) => {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (normalizedProvider !== 'google' && normalizedProvider !== 'apple') {
    throw new Error('Unsupported sign-in provider.');
  }

  if (!canUseBackend()) {
    throw new Error('Social sign-in requires the BookHub backend API.');
  }

  try {
    const response = await apiRequest({
      method: 'POST',
      path: `/api/auth/oauth/${normalizedProvider}`,
      data: payload || {}
    });
    return applyServerAuthResponse(response);
  } catch (error) {
    if (error?.code === 'backend_disabled') {
      throw new Error('Social sign-in requires the BookHub backend API.');
    }
    throw new Error(parseAuthError(error, `Could not sign in with ${normalizedProvider}. Please try again.`));
  }
};

export const signInWithGoogle = async ({ accessToken = '', idToken = '' } = {}) =>
  signInWithOAuthProvider({
    provider: 'google',
    payload: {
      accessToken: String(accessToken || '').trim() || undefined,
      idToken: String(idToken || '').trim() || undefined
    }
  });

export const signInWithApple = async ({ idToken = '', name = '', email = '' } = {}) =>
  signInWithOAuthProvider({
    provider: 'apple',
    payload: {
      idToken: String(idToken || '').trim() || undefined,
      name: typeof name === 'string' ? name : undefined,
      email: String(email || '').trim() || undefined
    }
  });

export const signOutUser = async () => {
  if (canUseBackend()) {
    const token = getSessionToken();
    if (token && !token.startsWith('local-')) {
      try {
        await apiRequest({
          method: 'POST',
          path: '/api/auth/logout',
          token
        });
      } catch {
        // Best effort; still clear local session.
      }
    }
  }

  setSession({ user: null, token: '' });
  localStorage.removeItem('bookHubBooks');
  window.dispatchEvent(new Event('booksUpdated'));
  dispatchAuthUpdated();
};

export const updateCurrentUserProfile = async ({ name, username }) => {
  const currentUser = getCurrentUser();
  if (!currentUser?.id) {
    throw new Error('Sign in to update your profile.');
  }

  const hasName = typeof name !== 'undefined';
  const hasUsername = typeof username !== 'undefined';
  if (!hasName && !hasUsername) {
    throw new Error('No profile changes were provided.');
  }

  const nextName = hasName ? String(name || '').trim() : String(currentUser.name || '');
  const nextUsername = hasUsername ? normalizeUsernameInput(username) : normalizeUsername(currentUser.username);

  if (hasName) {
    if (nextName.length < 2) {
      throw new Error('Name must be at least 2 characters.');
    }
    if (nextName.length > 80) {
      throw new Error('Name must be 80 characters or fewer.');
    }
  }

  if (hasUsername) {
    if (!isValidUsername(nextUsername)) {
      throw new Error(`Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} letters/numbers.`);
    }
  }

  if (canUseBackend()) {
    const token = getSessionToken();
    if (token && !token.startsWith('local-')) {
      try {
        const payload = {};
        if (hasName) payload.name = nextName;
        if (hasUsername) payload.username = nextUsername;

        const methods = ['PUT', 'PATCH'];
        let lastError = null;
        for (const method of methods) {
          try {
            const response = await apiRequest({
              method,
              path: '/api/auth/profile',
              token,
              data: payload
            });
            const updatedUser = response.data?.user;
            if (!updatedUser) {
              throw new Error('Invalid profile response from server.');
            }
            setSession({ user: updatedUser, token });
            dispatchAuthUpdated();
            return updatedUser;
          } catch (error) {
            if (error?.code === 'backend_disabled') {
              throw error;
            }
            lastError = error;
            if (method === 'PUT' && (error?.response?.status === 404 || error?.response?.status === 405)) {
              continue;
            }
            throw error;
          }
        }

        if (lastError) {
          throw lastError;
        }
      } catch (error) {
        if (error?.code !== 'backend_disabled') {
          throw new Error(parseAuthError(error, 'Could not update profile right now.'));
        }
      }
    }
  }

  const users = localGetUsers();
  if (hasUsername) {
    const usernameTaken = users.some(
      (user) => String(user.id) !== String(currentUser.id) && normalizeUsername(user.username) === nextUsername
    );
    if (usernameTaken) {
      throw new Error('That username is already taken.');
    }
  }

  const resolvedUsername = hasUsername
    ? nextUsername
    : generateLocalUsername(currentUser.username || currentUser.name || currentUser.email, users, currentUser.id);

  const updatedUsers = users.map((user) => {
    if (String(user.id) !== String(currentUser.id)) return user;
    return {
      ...user,
      name: hasName ? nextName : user.name,
      username: resolvedUsername
    };
  });
  writeJson(AUTH_USERS_STORAGE_KEY, updatedUsers);

  const updatedCurrentUser = {
    ...currentUser,
    name: hasName ? nextName : currentUser.name,
    username: resolvedUsername
  };
  setSession({ user: updatedCurrentUser, token: getSessionToken() });
  dispatchAuthUpdated();
  return updatedCurrentUser;
};

export const updateCurrentUserName = async (nextName) =>
  updateCurrentUserProfile({ name: nextName });
