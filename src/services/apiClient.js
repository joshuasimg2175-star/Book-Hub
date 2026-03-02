import axios from 'axios';
import { AUTH_SESSION_TOKEN_KEY } from '../utils/authKeys';

const DEFAULT_API_TIMEOUT_MS = 10000;
const API_PREFIX_REGEX = /^\/api(\/|$)/i;

export const resolveApiBaseUrl = () => {
  const configuredBaseUrl = String(process.env.REACT_APP_API_BASE_URL || '').trim();
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, '');

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:4000`;
  }

  return '';
};

export const isBackendEnabled = () => {
  if (process.env.NODE_ENV === 'test') return false;
  return String(process.env.REACT_APP_ENABLE_BACKEND || 'true') !== 'false';
};

export const canUseBackend = () => isBackendEnabled() && Boolean(resolveApiBaseUrl());

export const getStoredSessionToken = () => {
  try {
    return localStorage.getItem(AUTH_SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const normalizeRequestPath = (path) => {
  const requestPath = path.startsWith('/') ? path : `/${path}`;
  return requestPath || '/';
};

const resolveRequestUrl = (baseUrl, requestPath) => {
  const baseHasApiSuffix = /\/api$/i.test(baseUrl);
  const pathHasApiPrefix = API_PREFIX_REGEX.test(requestPath);
  let normalizedPath = requestPath;

  // Support base URLs configured like ".../api" while callers still pass "/api/..."
  if (baseHasApiSuffix && pathHasApiPrefix) {
    normalizedPath = normalizedPath.replace(/^\/api/i, '') || '/';
    if (!normalizedPath.startsWith('/')) normalizedPath = `/${normalizedPath}`;
  }

  return `${baseUrl}${normalizedPath}`;
};

const getRetryPath = (requestPath) => {
  if (API_PREFIX_REGEX.test(requestPath)) {
    const stripped = requestPath.replace(/^\/api/i, '');
    return stripped ? stripped : '/';
  }
  return `/api${requestPath}`;
};

export const apiRequest = async ({
  method = 'GET',
  path = '/',
  data,
  token,
  timeoutMs = DEFAULT_API_TIMEOUT_MS
}) => {
  if (!canUseBackend()) {
    const disabledError = new Error('Backend disabled');
    disabledError.code = 'backend_disabled';
    throw disabledError;
  }

  const baseUrl = resolveApiBaseUrl();
  const requestPath = normalizeRequestPath(path);
  const headers = {
    'Content-Type': 'application/json'
  };

  const authToken = token || getStoredSessionToken();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const requestOnce = (candidatePath) =>
    axios({
      method,
      url: resolveRequestUrl(baseUrl, candidatePath),
      data,
      headers,
      timeout: timeoutMs
    });

  try {
    return await requestOnce(requestPath);
  } catch (error) {
    const status = error?.response?.status;
    const backendMessage = String(error?.response?.data?.error || '').trim().toLowerCase();
    const shouldRetry = status === 404 && backendMessage.includes('not found');
    if (!shouldRetry) throw error;

    const retryPath = getRetryPath(requestPath);
    if (retryPath === requestPath) throw error;
    return requestOnce(retryPath);
  }
};
