import { Routes, Route } from 'react-router-dom';
import { RequireAuth, RequireRole, RoleRedirect } from './auth/guards.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AccessDeniedPage from './pages/AccessDeniedPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import AdminLayout from './components/layout/AdminLayout.jsx';
import UsherLayout from './components/layout/UsherLayout.jsx';
import OverviewPage from './pages/admin/OverviewPage.jsx';
import AttendancePage from './pages/admin/AttendancePage.jsx';
import MembersPage from './pages/admin/MembersPage.jsx';
import MemberDetailPage from './pages/admin/MemberDetailPage.jsx';
import ServicesPage from './pages/admin/ServicesPage.jsx';
import ServiceDetailPage from './pages/admin/ServiceDetailPage.jsx';
import ReportsPage from './pages/admin/ReportsPage.jsx';
import UsersPage from './pages/admin/UsersPage.jsx';
import SettingsPage from './pages/admin/SettingsPage.jsx';
import UsherHomePage from './pages/usher/UsherHomePage.jsx';
import UsherMarkPage from './pages/usher/UsherMarkPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/denied" element={<AccessDeniedPage />} />
      <Route path="/" element={<RoleRedirect />} />

      <Route element={<RequireAuth />}>
        <Route element={<RequireRole allow={['admin']} />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="members/:id" element={<MemberDetailPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="services/:id" element={<ServiceDetailPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>

        {/* Admins may also help record attendance; ushers see only this area. */}
        <Route element={<RequireRole allow={['admin', 'usher']} />}>
          <Route path="/usher" element={<UsherLayout />}>
            <Route index element={<UsherHomePage />} />
            <Route path="mark/:serviceId" element={<UsherMarkPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}