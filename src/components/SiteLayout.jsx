import React, { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import SiteFooter from './SiteFooter.jsx'
import SiteHeader from './SiteHeader.jsx'

// Elements with the "reveal" class fade up as they scroll into view.
// Content is only hidden once the observer is running, so nothing stays invisible
// if the browser lacks IntersectionObserver.
function useScrollReveal(pathname) {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined
    const root = document.documentElement
    root.classList.add('reveal-ready')
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll('.reveal:not(.is-visible)').forEach((element) => observer.observe(element))
    })
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [pathname])
}

export default function SiteLayout() {
  const { pathname } = useLocation()
  useScrollReveal(pathname)

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
