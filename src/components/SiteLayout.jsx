import React from 'react'
import { Outlet } from 'react-router-dom'
import SiteFooter from './SiteFooter.jsx'
import SiteHeader from './SiteHeader.jsx'

export default function SiteLayout() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main className="min-h-[65vh]">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
