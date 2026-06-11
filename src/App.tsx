import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import MethodologyPage from './pages/MethodologyPage'
import PrivacyPage from './pages/PrivacyPage'
import LoginPage from './pages/LoginPage'
import HowItWorksPage from './pages/HowItWorksPage'
import NotFoundPage from './pages/NotFoundPage'
import AppDashboardPage from './pages/app/AppDashboardPage'
import AppCaseQueuePage from './pages/app/AppCaseQueuePage'
import AppCaseDetailPage from './pages/app/AppCaseDetailPage'
import AppWorkflowPage from './pages/app/AppWorkflowPage'
import AppTorontoWardContextPage from './pages/app/AppTorontoWardContextPage'
import AppWorkloadInsightsPage from './pages/app/AppWorkloadInsightsPage'
import AppV2MlResultsPage from './pages/app/AppV2MlResultsPage'
import AppClosureReviewPage from './pages/app/AppClosureReviewPage'

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

      {/* Authenticated app (live Supabase data) */}
      <Route path="/app" element={<ProtectedRoute />}>
        <Route index element={<Navigate to="/app/closure-review" replace />} />
        <Route path="dashboard" element={<AppDashboardPage />} />
        <Route path="workflow" element={<AppWorkflowPage />} />
        <Route path="wards" element={<AppTorontoWardContextPage />} />
        <Route path="insights" element={<AppWorkloadInsightsPage />} />
        <Route path="v2-ml" element={<AppV2MlResultsPage />} />
        <Route path="closure-review" element={<AppClosureReviewPage />} />
        <Route path="cases" element={<AppCaseQueuePage />} />
        <Route path="cases/:id" element={<AppCaseDetailPage />} />
      </Route>
    </Routes>
  )
}
