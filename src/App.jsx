import React, { useEffect } from 'react'
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
import { isDemoSessionActive } from './utils/demoAccount.js'

function RouteEffects() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])

  return null
}

function RequireDemoSession() {
  return isDemoSessionActive() ? <Outlet /> : <Navigate to="/app/onboarding" replace />
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
          <Route path="setup" element={<ProfileSetupPage />} />
          <Route element={<RequireDemoSession />}>
            <Route element={<UserShell />}>
              <Route path="home" element={<FeedPage />} />
              <Route path="post/:postId" element={<PostDetailPage />} />
              <Route path="chat" element={<InboxPage />} />
              <Route path="create" element={<CreatePage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="connect" element={<ConnectPage />} />
              <Route path="invest" element={<InvestPage />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="profile" element={<AccountPage />} />
            </Route>
          </Route>
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
