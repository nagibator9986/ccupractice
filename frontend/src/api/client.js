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

client.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("ccu_token");
      localStorage.removeItem("ccu_user");
      if (!window.location.pathname.endsWith("/login")) {
        window.location.replace("/login");
      }
    }
    return Promise.reject(error);
  },
);

export default client;
