import React, { useEffect, useRef, useState } from 'react'
import { Banknote, Bell, Bitcoin, Bot, BriefcaseBusiness, ChevronDown, CircleEllipsis, Home, Menu, MessageCircle, PenLine, Plane, Plus, Search, ShoppingBag, Store, UserRound, Users, Video, WalletCards, X } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Avatar from './Avatar.jsx'
import Brand from './Brand.jsx'
import { apiRequest } from '../utils/api.js'
import { getCommunities } from '../utils/communityApi.js'
import { getPeople } from '../utils/peopleApi.js'
import { getSocialPosts } from '../utils/socialApi.js'

const primaryLinks = [
  { to: '/app/home', label: 'Home', icon: Home },
  { to: '/app/chat', label: 'Messages', icon: MessageCircle },
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
  { to: '/app/videos', label: 'Videos & Studio', icon: Video },
  { to: '/app/social', label: 'Social updates', icon: MessageCircle },
  { to: '/app/wallet', label: 'Wallet', icon: WalletCards },
  { to: '/app/payments', label: 'Payments', icon: Banknote },
  { to: '/app/itrade', label: 'iTrade', icon: Bitcoin },
  { to: '/app/ibuy', label: 'iBuy market', icon: ShoppingBag },
  { to: '/app/marketplace', label: 'Homes & local services', icon: Store },
  { to: '/app/ibook', label: 'iBook journeys', icon: Plane },
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [joinedCommunities, setJoinedCommunities] = useState([])
  const searchInputRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const currentLabel = location.pathname.startsWith('/app/marketplace')
    ? 'Homes & local services'
    : [...primaryLinks, ...exploreLinks].find((item) => item.to === location.pathname)?.label ?? 'Home'
  const normalizedSearch = searchTerm.trim().toLowerCase()

  useEffect(() => {
    let active = true
    apiRequest('/api/auth/me')
      .then(({ user }) => { if (active) setCurrentUser(user) })
      .catch(() => { if (active) setCurrentUser(null) })
    getCommunities()
      .then((communities) => {
        if (active) setJoinedCommunities(communities.filter((community) => community.joinedByMe).slice(0, 3))
      })
      .catch(() => { if (active) setJoinedCommunities([]) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const updateCurrentUser = (event) => setCurrentUser(event.detail)
    window.addEventListener('iconnect:profile-updated', updateCurrentUser)
    return () => window.removeEventListener('iconnect:profile-updated', updateCurrentUser)
  }, [])

  useEffect(() => {
    if (normalizedSearch.length < 2) {
      setSearchResults([])
      setSearchError('')
      setSearchLoading(false)
      return undefined
    }
    let active = true
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      Promise.all([getPeople({ query: searchTerm }), getCommunities({ query: searchTerm }), getSocialPosts()])
        .then(([people, communities, posts]) => {
          if (!active) return
          const results = [
            ...posts
              .filter((post) => `${post.name} ${post.text}`.toLowerCase().includes(normalizedSearch))
              .map((post) => ({ id: `post-${post.id}`, title: post.name, detail: post.text, to: `/app/post/${post.id}`, type: 'Post' })),
            ...people.map((person) => ({ id: `person-${person.id}`, title: person.name, detail: person.handle, to: '/app/connect', type: 'Person', tab: 'People', query: person.name })),
            ...communities.map((community) => ({ id: `community-${community.id}`, title: community.name, detail: community.description, to: '/app/connect', type: 'Community', tab: 'Communities', query: community.name })),
          ]
          setSearchResults(results.slice(0, 6))
          setSearchError('')
        })
        .catch((error) => {
          if (active) setSearchError(error instanceof Error ? error.message : 'Could not search iConnect.')
        })
        .finally(() => { if (active) setSearchLoading(false) })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [normalizedSearch, searchTerm])

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

  useEffect(() => {
    function handleKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        window.requestAnimationFrame(() => searchInputRef.current?.focus())
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setNotificationsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    setSearchOpen(false)
    setSearchTerm('')
    setNotificationsOpen(false)
  }, [location.pathname])

  function openSearchResult(result) {
    setSearchOpen(false)
    setSearchTerm('')
    navigate(result.to, result.query ? { state: { search: result.query, activeTab: result.tab } } : undefined)
  }

  const isMoreActive = !['/app/home', '/app/connect', '/app/create', '/app/chat'].includes(location.pathname)

  return (
    <div className="user-app min-h-screen">
      <aside className={`app-sidebar ${sidebarOpen ? 'app-sidebar-open' : ''}`}>
        <div className="app-sidebar-brand"><Brand to="/app/home" /></div>
        <div className="app-workspace"><span className="workspace-avatar">i</span><span><strong>My iConnect</strong><small>Personal space</small></span><ChevronDown size={15} /></div>
        <NavigationGroup title="YOUR SPACE" links={primaryLinks} onNavigate={closeSidebar} />
        <NavigationGroup title="DISCOVER" links={exploreLinks} onNavigate={closeSidebar} />
        <div className="sidebar-communities">
          <div className="sidebar-section-heading"><span>YOUR COMMUNITIES</span><button aria-label="Explore communities" onClick={closeSidebar}><Plus size={15} /></button></div>
          {joinedCommunities.map((community, index) => <Link key={community.id} to="/app/connect" onClick={closeSidebar}><span className={`community-dot ${['dot-green', 'dot-purple', 'dot-peach'][index]}`} /> {community.name}</Link>)}
          {!joinedCommunities.length && <Link to="/app/connect" onClick={closeSidebar}><span className="community-dot dot-green" /> Discover communities</Link>}
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/app/profile" onClick={closeSidebar} className={({ isActive }) => `app-profile-link ${isActive ? 'app-nav-link-active' : ''}`}>
            <Avatar person={{ name: currentUser?.name ?? 'Your account' }} />
            <span><strong>{currentUser?.name ?? 'Your account'}</strong><small>@{currentUser?.username ?? 'profile'}</small></span>
            <ChevronDown size={15} />
          </NavLink>
          <Link className="admin-portal-entry" to="/admin/login">Open admin portal ↗</Link>
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
          <div className="app-search-wrap">
            <label className={`app-search ${searchOpen ? 'app-search-active' : ''}`}><Search size={16} /><input ref={searchInputRef} value={searchTerm} onFocus={() => setSearchOpen(true)} onChange={(event) => { setSearchTerm(event.target.value); setSearchOpen(true) }} placeholder="Search iConnect" aria-label="Search iConnect" /><kbd>⌘ K</kbd></label>
            {searchOpen && normalizedSearch && <div className="app-search-results" role="listbox" aria-label="Search results">
              {searchLoading ? <p>Searching iConnect…</p> : searchError ? <p role="alert">{searchError}</p> : !searchResults.length ? <p>No matching posts, people, or communities.</p> : searchResults.map((result) => (
                <button type="button" key={result.id} role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => openSearchResult(result)}>
                  <span className="app-search-result-type">{result.type}</span><strong>{result.title}</strong><small>{result.detail}</small>
                </button>
              ))}
            </div>}
          </div>
          <div className="app-notification-wrap">
            <button className="app-notification" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => {
              setNotificationsOpen((open) => !open)
            }}><Bell size={18} /></button>
            {notificationsOpen && <section className="app-notifications-panel" aria-label="Notifications">
              <div className="app-notifications-heading"><strong>Notifications</strong></div>
              <p className="app-notifications-empty">Notifications are not available yet.</p>
            </section>}
          </div>
          <Avatar person={{ name: currentUser?.name ?? 'Your account', image: currentUser?.image }} className="app-topbar-avatar" />
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
        <div className="app-more-sheet-footer"><Link to="/admin/login" onClick={closeMore}>Open admin portal <X size={14} /></Link><Link to="/" onClick={closeMore}>Back to iConnect website <X size={14} /></Link></div>
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
