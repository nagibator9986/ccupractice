import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/endpoints";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const initialUser = (() => {
    try {
      const raw = localStorage.getItem("ccu_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [user, setUser] = useState(initialUser);
  // Start in the loading state when we have a token but no usable cached user
  // (absent OR corrupt JSON) — otherwise the first render sees user=null,
  // loading=false and ProtectedRoute bounces a legitimately-logged-in user to
  // /login on hard refresh before the me() revalidation in the effect can run.
  const [loading, setLoading] = useState(
    () => !!localStorage.getItem("ccu_token") && !initialUser,
  );

  useEffect(() => {
    const token = localStorage.getItem("ccu_token");
    if (token && !user) {
      setLoading(true);
      authApi
        .me()
        .then(({ user }) => {
          setUser(user);
          localStorage.setItem("ccu_user", JSON.stringify(user));
        })
        .catch(() => {
          localStorage.removeItem("ccu_token");
          localStorage.removeItem("ccu_user");
        })
        .finally(() => setLoading(false));
    }
  }, []); // eslint-disable-line

  async function login(email, password) {
    const { token, user } = await authApi.login(email, password);
    localStorage.setItem("ccu_token", token);
    localStorage.setItem("ccu_user", JSON.stringify(user));
    setUser(user);
    return user;
  }

  function logout() {
    localStorage.removeItem("ccu_token");
    localStorage.removeItem("ccu_user");
    setUser(null);
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      isAdmin: user?.role === "admin",
      login,
      logout,
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
