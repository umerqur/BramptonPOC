import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import MethodologyPage from './pages/MethodologyPage'
import PrivacyPage from './pages/PrivacyPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import AppCaseDetailPage from './pages/app/AppCaseDetailPage'
import AppNycCasePage from './pages/app/AppNycCasePage'
// Clean staff journey: Work Queue → Case Workbench → Closure Review, plus Insights.
import AppStaffInboxPage from './pages/app/AppStaffInboxPage'
import AppCaseWorkbenchPage from './pages/app/AppCaseWorkbenchPage'
import AppClosureDraftsPage from './pages/app/AppClosureDraftsPage'
import AppInsightsPage from './pages/app/AppInsightsPage'
import AppOfficerConsolePage from './pages/app/AppOfficerConsolePage'
import AppOfficerCasePage from './pages/app/AppOfficerCasePage'
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
        {/* Methodology is the single public explanation page; old links redirect. */}
        <Route path="/how-it-works" element={<Navigate to="/methodology" replace />} />
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

      {/* Authenticated app. The product surface is intentionally small: staff
          land on the Work Queue and open a case into the Case Workbench, then
          Closure Review (both drilldowns, not top nav tabs). Insights is the NYC
          311 workload heat map. The old demo-only routes are redirected to keep
          the staff journey clean. */}
      <Route path="/app" element={<ProtectedRoute />}>
        {/* Work Queue — staff home: the service-request queue. */}
        <Route index element={<AppStaffInboxPage />} />
        {/* Drilldown workflow pages, opened from a selected case (not in nav). */}
        <Route path="workbench" element={<AppCaseWorkbenchPage />} />
        <Route path="closure" element={<AppClosureDraftsPage />} />
        {/* Insights — NYC 311 workload heat map only. */}
        <Route path="insights" element={<AppInsightsPage />} />
        {/* Officer Field Console — By-law Officer landing: only their assigned
            cases and the field outcome they record. */}
        <Route path="field" element={<AppOfficerConsolePage />} />
        <Route path="field/:caseId" element={<AppOfficerCasePage />} />
        {/* Case detail — internal drilldown, not in nav. */}
        <Route path="cases/:id" element={<AppCaseDetailPage />} />
        {/* Full NYC 311 case page — opened from Insights Case Explorer + Open
            cases rows (replaces the old side drawer). */}
        <Route path="nyc_case/:caseId" element={<AppNycCasePage />} />

        {/* Removed demo-only routes — redirected so old links don't 404 and the
            product story stays focused. */}
        <Route path="walkthrough" element={<Navigate to="/app" replace />} />
        <Route path="intake" element={<Navigate to="/app" replace />} />
        <Route path="triage" element={<Navigate to="/app" replace />} />
        <Route path="audit" element={<Navigate to="/app" replace />} />
        <Route path="workflow" element={<Navigate to="/app" replace />} />
        <Route path="resident-intake" element={<Navigate to="/app" replace />} />
        <Route path="cases" element={<Navigate to="/app" replace />} />
        <Route path="legacy-insights" element={<Navigate to="/app/insights" replace />} />
        <Route path="wards" element={<Navigate to="/app/insights" replace />} />
        <Route path="closure-review" element={<Navigate to="/app/closure" replace />} />

        {/* Backward-compatible redirects for former routes. */}
        <Route path="home" element={<Navigate to="/app" replace />} />
        <Route path="dashboard" element={<Navigate to="/app/insights" replace />} />
        <Route path="supervisor" element={<Navigate to="/app/insights" replace />} />
        <Route path="statistical-insights" element={<Navigate to="/app" replace />} />
        <Route path="v2-ml" element={<Navigate to="/app" replace />} />
      </Route>
    </Routes>
  )
}
