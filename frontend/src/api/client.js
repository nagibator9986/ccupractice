import axios from "axios";

// In production with backend serving the SPA we use a relative `/api` base.
// When the frontend is hosted on a different origin, set `VITE_API_BASE_URL`
// at build time (e.g. `https://api.ccu.example.com`).
const baseURL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "") + "/api";

// Safe-storage shim: Safari/Firefox private modes, sandboxed iframes and
// browsers with site-data blocked can throw on localStorage access. Wrap every
// access so a thrown DOMException can't reject every API request before it
// leaves the page.
const safeStorage = {
  get(key) {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  remove(key) {
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const client = axios.create({
  baseURL,
  timeout: 60_000,
});

client.interceptors.request.use((config) => {
  const token = safeStorage.get("ccu_token");
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
const PUBLIC_PATHS = ["/signing/public/", "/enrollments/public/", "/auth/login"];

client.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || "";
    const isPublic = PUBLIC_PATHS.some((p) => url.includes(p));
    // Narrowed to 401 only: a generic 422 from Flask validation, marshmallow,
    // or any other code path should NOT silently log the admin out and hide
    // the original error. Only an explicit JWT-expired/invalid 401 logs out.
    const isJwt401 = status === 401;
    // Some Flask-JWT configs return 422 with a code like "token_expired" /
    // "token_invalid" — honour those as session-expired too, but never an
    // unrelated 422.
    const code = error.response?.data?.code;
    const isJwt422 =
      status === 422 && typeof code === "string" && /token_/.test(code);
    if (!isPublic && (isJwt401 || isJwt422)) {
      const wasLoggedIn = !!safeStorage.get("ccu_token");
      safeStorage.remove("ccu_token");
      safeStorage.remove("ccu_user");
      // Don't yank a foreground tab from a background poll that died.
      const docVisible =
        typeof document === "undefined" || document.visibilityState === "visible";
      if (wasLoggedIn && docVisible && !window.location.pathname.endsWith("/login")) {
        window.location.replace("/login");
      }
    }
    return Promise.reject(error);
  },
);

export default client;
