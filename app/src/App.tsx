import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import ModuleGate from './components/ModuleGate';
import Landing from './pages/Landing';
import MorningBrief from './pages/MorningBrief';
import CommandCentre from './pages/CommandCentre';
import Deadlines from './pages/Deadlines';
import DeadlineClients from './pages/DeadlineClients';
import ComplianceDetail from './pages/ComplianceDetail';
import AskCaos from './pages/AskCaos';
import ReviewQueue from './pages/ReviewQueue';
import MyWork from './pages/MyWork';
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
        {/* IMP-060 — Morning Brief, Command Centre, and the Deadlines board
            are wired to live data behind @/data (fixture mode unchanged);
            deliberately NOT behind ModuleGate. */}
        <Route path="/brief" element={<MorningBrief />} />
        <Route path="/command" element={<CommandCentre />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:clientId" element={<Client360Page />} />
        <Route path="/deadlines" element={<Deadlines />} />
        <Route path="/deadlines/:id/clients" element={<DeadlineClients />} />
        <Route path="/compliance/:id" element={<ModuleGate title="Compliance Detail" detail="Compliance instances arrive with the Compliance Engine release."><ComplianceDetail /></ModuleGate>} />
        <Route path="/ask" element={<ModuleGate title="Ask CAOS" detail="The natural-language assistant arrives with the AI release; no provider is wired to hosted data yet."><AskCaos /></ModuleGate>} />
        <Route path="/review" element={<ReviewQueue />} />
        {/* IMP-042 — My Work is wired to live data (DEC-L / API-R0-MWK);
            deliberately NOT behind ModuleGate. */}
        <Route path="/my-work" element={<MyWork />} />
        <Route path="/dependency" element={<ModuleGate title="Client Dependency" detail="Cross-client dependency analytics arrive with a later release."><ClientDependency /></ModuleGate>} />
        <Route path="/alerts" element={<ModuleGate title="Risk Alerts" detail="Risk alerts are raised by the Compliance Engine and risk modules, which arrive in a later release."><RiskAlerts /></ModuleGate>} />
        <Route path="/reports" element={<ModuleGate title="Reports" detail="Board-ready reports are composed from modules that arrive in later releases."><Reports /></ModuleGate>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
