import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import Landing from './pages/Landing';
import MorningBrief from './pages/MorningBrief';
import CommandCentre from './pages/CommandCentre';
import Deadlines from './pages/Deadlines';
import DeadlineClients from './pages/DeadlineClients';
import ComplianceDetail from './pages/ComplianceDetail';
import AskCaos from './pages/AskCaos';
import ReviewQueue from './pages/ReviewQueue';
import ClientsPage from './pages/clients/ClientsPage';
import Client360Page from './pages/clients/Client360Page';
import ClientDependency from './pages/ClientDependency';
import RiskAlerts from './pages/RiskAlerts';
import Reports from './pages/Reports';
import SignIn from './pages/auth/SignIn';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import MfaEnroll from './pages/auth/MfaEnroll';
import MfaChallenge from './pages/auth/MfaChallenge';

export default function App() {
  return (
    <Routes>
      {/* Landing — no app shell */}
      <Route path="/" element={<Landing />} />

      {/* Staff authentication — no app shell (IMP-011) */}
      <Route path="/auth/sign-in" element={<SignIn />} />
      <Route path="/auth/forgot-password" element={<ForgotPassword />} />
      <Route path="/auth/reset-password" element={<ResetPassword />} />
      <Route path="/auth/mfa-enroll" element={<MfaEnroll />} />
      <Route path="/auth/mfa-challenge" element={<MfaChallenge />} />

      {/* App shell (sidebar + topbar) — nested-route pattern with <Outlet/>.
          Authentication-level guard only (fixture mode passes through);
          tenant authorization is RLS, not this guard (IMP-012). */}
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/brief" element={<MorningBrief />} />
        <Route path="/command" element={<CommandCentre />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:clientId" element={<Client360Page />} />
        <Route path="/deadlines" element={<Deadlines />} />
        <Route path="/deadlines/:id/clients" element={<DeadlineClients />} />
        <Route path="/compliance/:id" element={<ComplianceDetail />} />
        <Route path="/ask" element={<AskCaos />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/dependency" element={<ClientDependency />} />
        <Route path="/alerts" element={<RiskAlerts />} />
        <Route path="/reports" element={<Reports />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
