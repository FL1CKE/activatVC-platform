import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import PlaceholderPage from "./pages/Placeholder";
import ApplicationForm from "./pages/founder/ApplicationForm";
import FounderPortalPage from "./pages/founder/Portal";
import ProcessingPage from "./pages/founder/Processing";
import InvestorDashboardPage from "./pages/investor/Dashboard";
import SettingsPage from "./pages/admin/Settings";
import AgentReportPage from "./pages/reports/AgentReport";
import InternalReportPage from "./pages/reports/InternalReport";
import FounderReportPage from "./pages/reports/FounderReport";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/apply" element={<ApplicationForm />} />
        <Route path="/processing" element={<ProcessingPage />} />
        <Route path="/magic/:token" element={<FounderPortalPage />} />
        <Route path="/dashboard" element={<InvestorDashboardPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/report/agent/:applicationId/:runId" element={<AgentReportPage />} />
        <Route path="/report/internal/:applicationId" element={<InternalReportPage />} />
        <Route path="/report/founder/:applicationId" element={<FounderReportPage />} />
        <Route path="/stub/:section" element={<PlaceholderPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
