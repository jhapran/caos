import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import MorningBrief from './pages/MorningBrief';
import CommandCentre from './pages/CommandCentre';
import Deadlines from './pages/Deadlines';
import DeadlineClients from './pages/DeadlineClients';
import ComplianceDetail from './pages/ComplianceDetail';
import AskCaos from './pages/AskCaos';
import ReviewQueue from './pages/ReviewQueue';
import ClientDependency from './pages/ClientDependency';
import RiskAlerts from './pages/RiskAlerts';
import Reports from './pages/Reports';

export default function App() {
  return (
    <Routes>
      {/* Landing — no app shell */}
      <Route path="/" element={<Landing />} />

      {/* App shell (sidebar + topbar) — nested-route pattern with <Outlet/> */}
      <Route element={<Layout />}>
        <Route path="/brief" element={<MorningBrief />} />
        <Route path="/command" element={<CommandCentre />} />
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
