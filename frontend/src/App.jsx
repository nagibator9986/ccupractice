import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage.jsx";
import Layout from "./components/Layout.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import PartnersPage from "./pages/PartnersPage.jsx";
import StudentsPage from "./pages/StudentsPage.jsx";
import ContractsPage from "./pages/ContractsPage.jsx";
import ContractDetailPage from "./pages/ContractDetailPage.jsx";
import EnrollmentsPage from "./pages/EnrollmentsPage.jsx";
import EnrollmentDetailPage from "./pages/EnrollmentDetailPage.jsx";
import ArchivePage from "./pages/ArchivePage.jsx";
import DataPage from "./pages/DataPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import PublicSignPage from "./pages/PublicSignPage.jsx";
import EnrollmentSignPage from "./pages/EnrollmentSignPage.jsx";
import { useAuth } from "./context/AuthContext.jsx";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Загрузка…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/sign/:token" element={<PublicSignPage />} />
      <Route path="/enroll-sign/:token" element={<EnrollmentSignPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="contracts/:id" element={<ContractDetailPage />} />
        <Route path="enrollments" element={<EnrollmentsPage />} />
        <Route path="enrollments/:id" element={<EnrollmentDetailPage />} />
        <Route path="archive" element={<ArchivePage />} />
        <Route path="data" element={<DataPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
