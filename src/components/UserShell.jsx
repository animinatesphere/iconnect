import React, { useEffect, useState } from 'react'
import { Bell, Bot, BriefcaseBusiness, ChevronDown, CircleEllipsis, Home, Menu, MessageCircle, PenLine, Plus, Search, UserRound, Users, WalletCards, X } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import Avatar from './Avatar.jsx'
import Brand from './Brand.jsx'
import { demoAvatar, getDemoProfile } from '../utils/demoAccount.js'

const primaryLinks = [
  { to: '/app/home', label: 'Home', icon: Home },
  { to: '/app/chat', label: 'Messages', icon: MessageCircle, count: '2' },
  { to: '/app/create', label: 'Create', icon: PenLine },
]

const mobileLinks = [
  { to: '/app/home', label: 'Home', icon: Home, end: true },
  { to: '/app/connect', label: 'Connect', icon: Users },
  { to: '/app/create', label: 'Create', icon: Plus },
  { to: '/app/chat', label: 'Messages', icon: MessageCircle },
  { label: 'More', icon: CircleEllipsis, action: 'more' },
]

const exploreLinks = [
  { to: '/app/jobs', label: 'Job hub', icon: BriefcaseBusiness },
  { to: '/app/connect', label: 'Connect', icon: Users },
  { to: '/app/invest', label: 'Invest', icon: WalletCards },
  { to: '/app/assistant', label: 'AI assistant', icon: Bot },
]

function NavigationGroup({ title, links, onNavigate }) {
  return (
    <div className="app-nav-group">
      <span className="app-nav-heading">{title}</span>
      {links.map(({ to, label, icon: Icon, count }) => (
        <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => `app-nav-link ${isActive ? 'app-nav-link-active' : ''}`}>
          <span className="app-nav-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span>
          <span>{label}</span>
          {count && <span className="app-nav-count">{count}</span>}
        </NavLink>
      ))}
    </div>
  )
}

export default function UserShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const profile = getDemoProfile()
  const demoUser = { name: profile?.name ?? 'Taylor Reed', image: profile?.avatar ?? demoAvatar }
  const location = useLocation()
  const currentLabel = [...primaryLinks, ...exploreLinks].find((item) => item.to === location.pathname)?.label ?? 'Home'

  function closeSidebar() {
    setSidebarOpen(false)
  }

  function closeMore() {
    setMoreOpen(false)
  }

  useEffect(() => {
    if (!moreOpen) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') closeMore()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [moreOpen])

  const isMoreActive = !['/app/home', '/app/connect', '/app/create', '/app/chat'].includes(location.pathname)

  return (
    <div className="user-app min-h-screen">
      <aside className={`app-sidebar ${sidebarOpen ? 'app-sidebar-open' : ''}`}>
        <div className="app-sidebar-brand"><Brand to="/app/home" /></div>
        <div className="demo-workspace"><span className="workspace-avatar">i</span><span><strong>My iConnect</strong><small>Personal space</small></span><ChevronDown size={15} /></div>
        <NavigationGroup title="YOUR SPACE" links={primaryLinks} onNavigate={closeSidebar} />
        <NavigationGroup title="DISCOVER" links={exploreLinks} onNavigate={closeSidebar} />
        <div className="sidebar-communities">
          <div className="sidebar-section-heading"><span>YOUR COMMUNITIES</span><button aria-label="Explore communities" onClick={closeSidebar}><Plus size={15} /></button></div>
          <Link to="/app/connect" onClick={closeSidebar}><span className="community-dot dot-green" /> Outside, eventually</Link>
          <Link to="/app/connect" onClick={closeSidebar}><span className="community-dot dot-purple" /> The reading nook</Link>
          <Link to="/app/connect" onClick={closeSidebar}><span className="community-dot dot-peach" /> Camera roll club</Link>
        </div>
        <div className="sidebar-bottom">
          <div className="preview-notice"><span>PREVIEW MODE</span><p>Sample content only. Your account is not connected.</p></div>
          <NavLink to="/app/profile" onClick={closeSidebar} className={({ isActive }) => `app-profile-link ${isActive ? 'app-nav-link-active' : ''}`}>
            <Avatar person={demoUser} />
            <span><strong>{demoUser.name}</strong><small>{profile ? 'Your demo profile' : 'Demo profile'}</small></span>
            <ChevronDown size={15} />
          </NavLink>
          <Link className="back-to-site" to="/">← Back to iConnect</Link>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={closeSidebar} />}
      <div className="app-main-column">
        <header className="app-topbar">
          <button className="app-mobile-menu" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}>
            {sidebarOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="app-mobile-brand"><Brand to="/app/home" /></div>
          <div className="app-breadcrumb">Your space <span>/</span> <strong>{currentLabel}</strong></div>
          <label className="app-search"><Search size={16} /><input placeholder="Search iConnect" aria-label="Search iConnect" /><kbd>⌘ K</kbd></label>
          <button className="app-notification" aria-label="Notifications"><Bell size={18} /><i /></button>
          <Avatar person={demoUser} className="app-topbar-avatar" />
        </header>
        <main className="app-page-content"><Outlet /></main>
      </div>
      {moreOpen && <button className="app-more-scrim" aria-label="Close more navigation" onClick={closeMore} />}
      {moreOpen && <section id="app-more-sheet" className="app-more-sheet" aria-label="All iConnect sections">
        <div className="app-more-sheet-heading"><div><span className="app-page-eyebrow">EXPLORE iCONNECT</span><h2>Everything in one place</h2></div><button type="button" onClick={closeMore} aria-label="Close navigation"><X size={19} /></button></div>
        <div className="app-more-links">
          {[...primaryLinks, ...exploreLinks, { to: '/app/profile', label: 'Profile & settings', icon: UserRound }].map(({ to, label, icon: Icon, count }) => (
            <NavLink key={to} to={to} onClick={closeMore} className={({ isActive }) => `app-more-link ${isActive ? 'app-more-link-active' : ''}`}>
              <span><Icon size={18} /></span><strong>{label}</strong>{count && <small>{count}</small>}
            </NavLink>
          ))}
        </div>
        <div className="app-more-sheet-footer"><span>PREVIEW MODE · Sample content only</span><Link to="/" onClick={closeMore}>Back to iConnect website <X size={14} /></Link></div>
      </section>}
      <nav className="app-bottom-nav" aria-label="Main app navigation">
        {mobileLinks.map(({ to, label, icon: Icon, end, action }) => action === 'more'
          ? <button key={label} type="button" aria-expanded={moreOpen} aria-controls="app-more-sheet" onClick={() => setMoreOpen((open) => !open)} className={`app-bottom-nav-link ${moreOpen || isMoreActive ? 'app-bottom-nav-active' : ''}`}>
              <span><Icon size={20} strokeWidth={1.9} /></span><small>{label}</small>
            </button>
          : <NavLink key={to} to={to} end={end} onClick={closeMore} className={({ isActive }) => `app-bottom-nav-link ${isActive ? 'app-bottom-nav-active' : ''}`}>
              <span className={label === 'Create' ? 'app-bottom-nav-create' : ''}><Icon size={20} strokeWidth={label === 'Create' ? 2.4 : 1.9} /></span>
              <small>{label}</small>
            </NavLink>)}
      </nav>
    </div>
  )
}
