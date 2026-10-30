import React, { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import SiteLayout from './components/SiteLayout.jsx'
import HomePage from './pages/HomePage.jsx'
import ProductPage from './pages/ProductPage.jsx'
import CommunitiesPage from './pages/CommunitiesPage.jsx'
import RoadmapPage from './pages/RoadmapPage.jsx'
import EarlyAccessPage from './pages/EarlyAccessPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import UserAppLayout from './components/UserAppLayout.jsx'
import UserShell from './components/UserShell.jsx'
import OnboardingPage from './pages/app/OnboardingPage.jsx'
import AuthPage from './pages/app/AuthPage.jsx'
import VerifyEmailPage from './pages/app/VerifyEmailPage.jsx'
import ProfileSetupPage from './pages/app/ProfileSetupPage.jsx'
import FeedPage from './pages/app/FeedPage.jsx'
import PostDetailPage from './pages/app/PostDetailPage.jsx'
import InboxPage from './pages/app/InboxPage.jsx'
import CreatePage from './pages/app/CreatePage.jsx'
import JobsPage from './pages/app/JobsPage.jsx'
import ConnectPage from './pages/app/ConnectPage.jsx'
import InvestPage from './pages/app/InvestPage.jsx'
import AssistantPage from './pages/app/AssistantPage.jsx'
import AccountPage from './pages/app/AccountPage.jsx'
import VideoHubPage from './pages/app/VideoHubPage.jsx'
import MoneyHubPage from './pages/app/MoneyHubPage.jsx'
import CommercePage from './pages/app/CommercePage.jsx'
import LocalMarketplacePage from './pages/app/LocalMarketplacePage.jsx'
import SocialPage from './pages/app/SocialPage.jsx'
import AdminLoginPage from './pages/admin/AdminLoginPage.jsx'
import AdminDashboardPage from './pages/admin/AdminDashboardPage.jsx'
import { apiRequest } from './utils/api.js'
import { isDemoAdminSessionActive } from './utils/demoAdmin.js'

function RouteEffects() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])

  return null
}

function RequireDemoSession() {
  const [status, setStatus] = useState('checking')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setStatus('checking')
    apiRequest('/api/auth/me', { signal: controller.signal })
      .then(() => setStatus('authenticated'))
      .catch((error) => {
        if (controller.signal.aborted) return
        setStatus(error.code === 'not_authenticated' ? 'unauthenticated' : 'unavailable')
      })
    return () => controller.abort()
  }, [retry])

  if (status === 'checking') {
    return <main className="auth-screen"><p className="backend-auth-status" role="status">Checking your account…</p></main>
  }
  if (status === 'unauthenticated') return <Navigate to="/app/onboarding" replace />
  if (status === 'unavailable') {
    return (
      <main className="auth-screen">
        <section className="backend-auth-error" role="alert">
          <h1>We can’t reach iConnect right now.</h1>
          <p>Your sign-in could not be verified. Check your connection and try again.</p>
          <button type="button" className="app-primary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
        </section>
      </main>
    )
  }
  return <Outlet />
}

function RequireDemoAdminSession() {
  return isDemoAdminSessionActive() ? <Outlet /> : <Navigate to="/admin/login" replace />
}

function AppRoutes() {
  return (
    <>
      <RouteEffects />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="product" element={<ProductPage />} />
          <Route path="communities" element={<CommunitiesPage />} />
          <Route path="roadmap" element={<RoadmapPage />} />
          <Route path="early-access" element={<EarlyAccessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="app" element={<UserAppLayout />}>
          <Route index element={<Navigate to="onboarding" replace />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route path="login" element={<AuthPage />} />
          <Route path="signup" element={<AuthPage />} />
          <Route path="verify-email" element={<VerifyEmailPage />} />
          <Route path="setup" element={<ProfileSetupPage />} />
          <Route element={<RequireDemoSession />}>
            <Route element={<UserShell />}>
              <Route path="home" element={<FeedPage />} />
              <Route path="post/:postId" element={<PostDetailPage />} />
              <Route path="chat" element={<InboxPage />} />
              <Route path="create" element={<CreatePage />} />
              <Route path="videos" element={<VideoHubPage />} />
              <Route path="wallet" element={<MoneyHubPage />} />
              <Route path="payments" element={<MoneyHubPage />} />
              <Route path="itrade" element={<MoneyHubPage />} />
              <Route path="ibuy" element={<CommercePage />} />
              <Route path="ibuy/:productId" element={<CommercePage />} />
              <Route path="ibook" element={<CommercePage />} />
              <Route path="marketplace" element={<LocalMarketplacePage />} />
              <Route path="marketplace/:listingId" element={<LocalMarketplacePage />} />
              <Route path="social" element={<SocialPage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="connect" element={<ConnectPage />} />
              <Route path="invest" element={<InvestPage />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="profile" element={<AccountPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route element={<RequireDemoAdminSession />}>
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
          <Route path="/admin/dashboard/products/:productId" element={<AdminDashboardPage />} />
        </Route>
        <Route path="join" element={<Navigate to="/early-access" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
