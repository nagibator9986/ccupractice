import axios from "axios";

// In production with backend serving the SPA we use a relative `/api` base.
// When the frontend is hosted on a different origin, set `VITE_API_BASE_URL`
// at build time (e.g. `https://api.ccu.example.com`).
const baseURL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "") + "/api";

const client = axios.create({
  baseURL,
  timeout: 60_000,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("ccu_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Tell the backend which origin to embed in signing URLs (otherwise it would
  // use its own host:port which isn't reachable from the browser).
  if (typeof window !== "undefined") {
    config.headers["X-Public-Origin"] = window.location.origin;
  }
  return config;
});

// Paths that NEVER trigger an auto-logout even on 401 (public signing flow
// is intentionally token-based and lives outside the auth-protected area).
const PUBLIC_PATHS = ["/signing/public/", "/auth/login"];

client.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || "";
    const isPublic = PUBLIC_PATHS.some((p) => url.includes(p));
    // Treat 401 (and 422 from misconfigured JWT setups) on protected routes
    // as a session-expired signal — clear creds and bounce to /login.
    if (!isPublic && (status === 401 || status === 422)) {
      const wasLoggedIn = !!localStorage.getItem("ccu_token");
      localStorage.removeItem("ccu_token");
      localStorage.removeItem("ccu_user");
      if (wasLoggedIn && !window.location.pathname.endsWith("/login")) {
        window.location.replace("/login");
      }
    }
    return Promise.reject(error);
  },
);

export default client;
