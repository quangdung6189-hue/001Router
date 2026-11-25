import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi, setUnauthorizedHandler } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState(false);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const handleUnauthorized = useCallback(() => {
    setAuthenticated(false);
    setDefaultPassword(false);
    setPasswordChangeRequired(false);
    if (location.pathname !== '/login' && location.pathname !== '/landing') {
      const from = `${location.pathname}${location.search || ''}${location.hash || ''}`;
      navigate('/login', { replace: true, state: { from } });
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, [handleUnauthorized]);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authApi.me();
      setAuthenticated(Boolean(res?.authenticated));
      setDefaultPassword(Boolean(res?.defaultPassword));
      setPasswordChangeRequired(Boolean(res?.passwordChangeRequired));
    } catch {
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (password) => {
    const res = await authApi.login(password);
    let defPwd = Boolean(res?.defaultPassword);
    let reqChange = Boolean(res?.passwordChangeRequired);
    if (res?.passwordChangeRequired === undefined) {
      try {
        const me = await authApi.me();
        defPwd = Boolean(me?.defaultPassword);
        reqChange = Boolean(me?.passwordChangeRequired);
      } catch {
        // fallback to login payload
      }
    }
    setDefaultPassword(defPwd);
    setPasswordChangeRequired(reqChange);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAuthenticated(false);
      setDefaultPassword(false);
      setPasswordChangeRequired(false);
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  const value = useMemo(
    () => ({
      authenticated,
      defaultPassword,
      setDefaultPassword,
      passwordChangeRequired,
      setPasswordChangeRequired,
      loading,
      login,
      logout,
      checkAuth,
    }),
    [authenticated, defaultPassword, passwordChangeRequired, loading, login, logout, checkAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
