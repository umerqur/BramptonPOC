import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'
import CaseQueuePage from './pages/CaseQueuePage'
import CaseDetailPage from './pages/CaseDetailPage'
import MethodologyPage from './pages/MethodologyPage'
import PrivacyPage from './pages/PrivacyPage'
import LoginPage from './pages/LoginPage'
import HowItWorksPage from './pages/HowItWorksPage'
import NotFoundPage from './pages/NotFoundPage'
import AppDashboardPage from './pages/app/AppDashboardPage'
import AppCaseQueuePage from './pages/app/AppCaseQueuePage'
import AppCaseDetailPage from './pages/app/AppCaseDetailPage'
import AppWorkflowPage from './pages/app/AppWorkflowPage'
import AppWardContextPage from './pages/app/AppWardContextPage'

export default function App() {
  return (
    <Routes>
      {/* Public marketing + demo (mock data only) */}
      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/cases" element={<CaseQueuePage />} />
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/methodology" element={<MethodologyPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* Authenticated app (live Supabase data) */}
      <Route path="/app" element={<ProtectedRoute />}>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<AppDashboardPage />} />
        <Route path="workflow" element={<AppWorkflowPage />} />
        <Route path="wards" element={<AppWardContextPage />} />
        <Route path="cases" element={<AppCaseQueuePage />} />
        <Route path="cases/:id" element={<AppCaseDetailPage />} />
      </Route>
    </Routes>
  )
}
