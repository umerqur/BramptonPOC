import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import MethodologyPage from './pages/MethodologyPage'
import PrivacyPage from './pages/PrivacyPage'
import LoginPage from './pages/LoginPage'
import HowItWorksPage from './pages/HowItWorksPage'
import NotFoundPage from './pages/NotFoundPage'
import AppCaseQueuePage from './pages/app/AppCaseQueuePage'
import AppCaseDetailPage from './pages/app/AppCaseDetailPage'
import AppWorkflowPage from './pages/app/AppWorkflowPage'
import AppTorontoWardContextPage from './pages/app/AppTorontoWardContextPage'
import AppWorkloadInsightsPage from './pages/app/AppWorkloadInsightsPage'
import AppClosureReviewPage from './pages/app/AppClosureReviewPage'
import AppResidentIntakePage from './pages/app/AppResidentIntakePage'
// New AI-assisted closure-response demo flow (the redesigned main product).
import AppStaffInboxPage from './pages/app/AppStaffInboxPage'
import AppDemoFlowPage from './pages/app/AppDemoFlowPage'
import AppIntakeAgentPage from './pages/app/AppIntakeAgentPage'
import AppTriageAutomationPage from './pages/app/AppTriageAutomationPage'
import AppCaseWorkbenchPage from './pages/app/AppCaseWorkbenchPage'
import AppClosureDraftsPage from './pages/app/AppClosureDraftsPage'
import AppInsightsPage from './pages/app/AppInsightsPage'
import AppAuditTrailPage from './pages/app/AppAuditTrailPage'
import ResidentLayout from './components/resident/ResidentLayout'
import ResidentHomePage from './pages/resident/ResidentHomePage'
import ResidentNewRequestPage from './pages/resident/ResidentNewRequestPage'
import ResidentStatusPage from './pages/resident/ResidentStatusPage'

export default function App() {
  return (
    <Routes>
      {/* Public marketing site — explains the POC and routes authorized
          reviewers to login. No public operational data demo. */}
      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/methodology" element={<MethodologyPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* The dashboard / case demo is no longer public — route any old
            public links to login. The live versions live under /app. */}
        <Route path="/dashboard" element={<Navigate to="/login" replace />} />
        <Route path="/cases" element={<Navigate to="/login" replace />} />
        <Route path="/cases/:id" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* Public resident simulation flow — a self-serve 311 service request
          portal. Demo data only; kept separate from the benchmark dataset and
          the authenticated staff app. */}
      <Route element={<ResidentLayout />}>
        <Route path="/resident" element={<ResidentHomePage />} />
        <Route path="/resident/new-request" element={<ResidentNewRequestPage />} />
        <Route path="/resident/status/:caseId" element={<ResidentStatusPage />} />
      </Route>

      {/* Authenticated app. The redesigned main product is the end-to-end
          AI-assisted closure-response demo flow, backed by a self-contained
          synthetic workflow store (no Supabase dependency to prove the flow).
          The prior queue / dashboard / insights consoles are kept as supporting
          operational views under the merged Insights tab. */}
      <Route path="/app" element={<ProtectedRoute />}>
        {/* Staff land on the inbox of real resident submissions. */}
        <Route index element={<AppStaffInboxPage />} />
        <Route path="workbench" element={<AppCaseWorkbenchPage />} />
        <Route path="closure" element={<AppClosureDraftsPage />} />
        {/* Merged Insights tab — live complaint workload dashboard + supervisor
            workflow-impact metrics, with the NYC service request workload heat map. */}
        <Route path="insights" element={<AppInsightsPage />} />
        <Route path="audit" element={<AppAuditTrailPage />} />

        {/* POC Walkthrough — the guided synthetic end-to-end narrative. */}
        <Route path="walkthrough" element={<AppDemoFlowPage />} />
        <Route path="intake" element={<AppIntakeAgentPage />} />
        <Route path="triage" element={<AppTriageAutomationPage />} />

        {/* Supporting operational views (prior product), reachable from
            Insights and via direct URL. */}
        <Route path="legacy-insights" element={<AppWorkloadInsightsPage />} />
        <Route path="workflow" element={<AppWorkflowPage />} />
        <Route path="wards" element={<AppTorontoWardContextPage />} />
        <Route path="closure-review" element={<AppClosureReviewPage />} />
        <Route path="resident-intake" element={<AppResidentIntakePage />} />
        <Route path="cases" element={<AppCaseQueuePage />} />
        <Route path="cases/:id" element={<AppCaseDetailPage />} />

        {/* Backward-compatible redirects for former routes. The standalone
            dashboard and Supervisor Insights pages are now merged into the
            single Insights tab. */}
        <Route path="home" element={<Navigate to="/app" replace />} />
        <Route path="dashboard" element={<Navigate to="/app/insights" replace />} />
        <Route path="supervisor" element={<Navigate to="/app/insights" replace />} />
        <Route path="statistical-insights" element={<Navigate to="/app/legacy-insights" replace />} />
        <Route path="v2-ml" element={<Navigate to="/app/legacy-insights" replace />} />
      </Route>
    </Routes>
  )
}
