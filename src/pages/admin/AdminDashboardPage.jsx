import React, { useEffect, useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, LogOut, Search, ShieldAlert, Users, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import PageMeta from '../../components/PageMeta.jsx'
import { adminLogout, getAdminAuditLog, getAdminOverview, getAdminSession, getAdminUserDetails, getAdminUsers } from '../../utils/adminApi.js'

const pageSize = 100

const overviewItems = [
  ['users', 'Accounts'],
  ['verifiedUsers', 'Verified accounts'],
  ['posts', 'Posts'],
  ['comments', 'Comments'],
  ['messages', 'Private messages'],
  ['products', 'iBuy products'],
  ['localListings', 'Local listings'],
  ['jobs', 'Job listings'],
  ['applications', 'Applications'],
  ['communities', 'Communities'],
  ['memberships', 'Memberships'],
  ['likes', 'Likes'],
  ['bookmarks', 'Bookmarks'],
]

const activityLabels = [
  ['posts', 'Posts'],
  ['comments', 'Comments'],
  ['likes', 'Likes'],
  ['bookmarks', 'Bookmarks'],
  ['messages', 'Private messages'],
  ['products', 'iBuy listings'],
  ['localListings', 'Local marketplace listings'],
  ['jobs', 'Job listings'],
  ['applications', 'Job applications'],
  ['communitiesJoined', 'Communities joined'],
  ['communitiesCreated', 'Communities created'],
  ['following', 'Following'],
  ['followers', 'Followers'],
]

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatRecord(key, item) {
  switch (key) {
    case 'posts':
      return item.text
    case 'comments':
      return `Comment: ${item.text} · On: ${item.postText}`
    case 'likes':
      return `Liked @${item.author.username}’s post: ${item.postText}`
    case 'bookmarks':
      return `Saved @${item.author.username}’s post: ${item.postText}`
    case 'messages':
      return `${item.sender.name} → ${item.recipient.name}: ${item.text}`
    case 'products':
      return `${item.name} · ${item.category} · ₦${new Intl.NumberFormat('en-NG').format(item.price)} · Stock ${item.stock} · ${item.published ? 'Published' : 'Unpublished'} · ${item.description}`
    case 'localListings':
      return `${item.title} · ${item.category} · ${item.location} · ${item.price} · ${item.published ? 'Published' : 'Unpublished'} · ${item.description}`
    case 'jobs':
      return `${item.title} · ${item.company} · ${item.location} · ${item.workplaceType} · ${item.description}`
    case 'applications':
      return `Applied for ${item.jobTitle} at ${item.company} · ${item.status}${item.coverLetter ? ` · ${item.coverLetter}` : ''}`
    case 'communitiesJoined':
      return `Joined ${item.name} · ${item.memberCount} members · ${item.description}`
    case 'communitiesCreated':
      return `Created ${item.name} · ${item.memberCount} members · ${item.description}`
    case 'following':
      return `Follows ${item.name} (@${item.username})`
    case 'followers':
      return `${item.name} (@${item.username}) follows this account`
    default:
      return ''
  }
}

function UserDetails({ user, loading, error, onClose, onLoadOlder, loadingOlder, hasMore }) {
  if (!user) return null
  return (
    <div className="admin-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="admin-detail-panel" role="dialog" aria-modal="true" aria-labelledby="admin-user-detail-title">
        <header className="admin-detail-header">
          <div><span className="app-page-eyebrow">ACCOUNT DETAILS</span><h2 id="admin-user-detail-title">{user.name}</h2><p>@{user.username} · {user.email}</p></div>
          <button type="button" className="admin-detail-close" aria-label="Close user details" onClick={onClose}><X size={18} /></button>
        </header>
        {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
        <div className="admin-detail-profile">
          <p>{user.bio || 'No bio provided.'}</p>
          <div><span>{user.emailVerified ? 'Email verified' : 'Email not verified'}</span><span>{user.profileVisible ? 'Profile visible' : 'Profile hidden'}</span><span>{user.discoverable ? 'Discoverable' : 'Not discoverable'}</span></div>
          <p>Joined {formatDate(user.createdAt)} · Last profile update {formatDate(user.updatedAt)}</p>
          {!!user.interests?.length && <p>Interests: {user.interests.join(', ')}</p>}
        </div>
        <section className="admin-detail-counts" aria-label="Account activity totals">
          {activityLabels.map(([key, label]) => <div key={key}><strong>{user.counts[key] ?? 0}</strong><span>{label}</span></div>)}
        </section>
        <div className="admin-detail-privacy-note"><ShieldAlert size={16} /><p>Private conversation contents are included at your direction. Each time an admin opens these user details, access is recorded in the audit log.</p></div>
        {loading && <p className="admin-detail-loading">Loading all account activity…</p>}
        {!loading && user.activity && <div className="admin-detail-activity">
          {activityLabels.map(([key, label]) => {
            const records = user.activity[key] ?? []
            if (!records.length) return null
            return <section key={key}><h3>{label} <span>{user.counts[key] ?? records.length}</span></h3><div>{records.map((item, index) => <article key={item.id ?? item.postId ?? `${key}-${index}`}><p>{formatRecord(key, item)}</p>{item.imageUrls?.length > 0 && <div className="admin-activity-images">{item.imageUrls.map((image, imageIndex) => <img key={`${image}-${imageIndex}`} src={image} alt={`User activity photo ${imageIndex + 1}`} loading="lazy" />)}</div>}<time>{formatDate(item.createdAt ?? item.joinedAt)}</time></article>)}</div></section>
          })}
          {hasMore && <button type="button" className="admin-load-older" onClick={onLoadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load older activity'}</button>}
        </div>}
      </section>
    </div>
  )
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const [admin, setAdmin] = useState(null)
  const [section, setSection] = useState('Overview')
  const [overview, setOverview] = useState(null)
  const [users, setUsers] = useState([])
  const [userTotal, setUserTotal] = useState(0)
  const [userOffset, setUserOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [auditEvents, setAuditEvents] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getAdminSession(), getAdminOverview(), getAdminAuditLog(20)])
      .then(([session, stats, events]) => {
        if (!active) return
        setAdmin(session.admin)
        setOverview(stats)
        setAuditEvents(events)
        setError('')
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load admin data.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (section !== 'Users') return undefined
    let active = true
    const timer = window.setTimeout(() => {
      setLoadingUsers(true)
      getAdminUsers({ query: search, limit: 50, offset: userOffset })
        .then((result) => {
          if (active) {
            setUsers(result.users)
            setUserTotal(result.total)
            setError('')
          }
        })
        .catch((loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load accounts.')
        })
        .finally(() => {
          if (active) setLoadingUsers(false)
        })
    }, search.trim() ? 250 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search, section, userOffset])

  useEffect(() => {
    if (!selectedUser?.id) return undefined
    let active = true
    setDetailError('')
    getAdminUserDetails(selectedUser.id, { limit: pageSize, offset: 0 })
      .then((details) => {
        if (!active) return
        setSelectedUser(details)
        return getAdminAuditLog(20).then((events) => {
          if (active) setAuditEvents(events)
        })
      })
      .catch((loadError) => {
        if (active) setDetailError(loadError instanceof Error ? loadError.message : 'Could not load user details.')
      })
    return () => { active = false }
  }, [selectedUser?.id])

  async function loadOlderActivity() {
    if (!selectedUser || loadingOlder) return
    setLoadingOlder(true)
    try {
      const offset = selectedUser.page.offset + selectedUser.page.limit
      const next = await getAdminUserDetails(selectedUser.id, { limit: pageSize, offset })
      const activity = Object.fromEntries(
        Object.keys(selectedUser.activity).map((key) => [
          key,
          [...selectedUser.activity[key], ...(next.activity[key] ?? [])],
        ]),
      )
      setSelectedUser({ ...next, activity, page: { limit: pageSize, offset } })
      setDetailError('')
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : 'Could not load older activity.')
    } finally {
      setLoadingOlder(false)
    }
  }

  async function refreshAudit() {
    setLoadingAudit(true)
    try {
      setAuditEvents(await getAdminAuditLog(100))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the admin audit log.')
    } finally {
      setLoadingAudit(false)
    }
  }

  async function signOut() {
    try {
      await adminLogout()
      navigate('/admin/login', { replace: true })
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Could not sign out.')
    }
  }

  async function openUser(user) {
    setSelectedUser({ ...user, activity: null, page: { limit: pageSize, offset: 0 } })
    setDetailError('')
  }

  function chooseSection(nextSection) {
    setSection(nextSection)
    setError('')
    setNotice('')
    if (nextSection === 'Audit log') refreshAudit()
  }

  const olderOffset = selectedUser?.page ? selectedUser.page.offset + selectedUser.page.limit : 0
  const hasMore = Boolean(selectedUser?.counts && activityLabels.some(([key]) => (selectedUser.activity?.[key]?.length ?? 0) < selectedUser.counts[key]))

  return (
    <div className="admin-portal">
      <PageMeta title="Admin dashboard" description="iConnect administrator dashboard and account activity." />
      <aside className="admin-portal-sidebar">
        <Link to="/admin/dashboard" className="admin-portal-brand">iConnect<span>ADMIN PORTAL</span></Link>
        <div className="admin-portal-account"><span className="admin-portal-avatar">{admin?.name?.slice(0, 1) ?? 'A'}</span><span><strong>{admin?.name ?? 'Administrator'}</strong><small>{admin?.email}</small></span><i /></div>
        <span className="admin-portal-nav-label">WORKSPACE</span>
        <nav className="admin-portal-nav" aria-label="Admin dashboard navigation">
          {[['Overview', Activity], ['Users', Users], ['Audit log', ShieldAlert]].map(([label, Icon]) => <button key={label} type="button" className={section === label ? 'admin-portal-nav-active' : ''} onClick={() => chooseSection(label)}><Icon size={16} /><span>{label}</span></button>)}
        </nav>
        <div className="admin-portal-sidebar-footer"><div className="admin-portal-local-note"><ShieldAlert size={15} /><span>Admin access is server-authorized and audited.</span></div><Link to="/app/ibuy">Open iBuy to list a product</Link><button type="button" onClick={signOut}><LogOut size={15} /> Sign out</button><Link to="/">Return to public site</Link></div>
      </aside>
      <div className="admin-portal-main">
        <header className="admin-portal-topbar"><div><span>iConnect admin</span><b>/</b><strong>{section}</strong></div><div className="admin-portal-topbar-actions"><span className="admin-preview-chip"><i /> SECURE ADMIN</span><button type="button" onClick={signOut}><LogOut size={14} /> Sign out</button></div></header>
        <main className="admin-portal-content">
          <div className="admin-portal-page-heading"><div><span className="app-page-eyebrow">WEBSITE OPERATIONS</span><h1>{section === 'Overview' ? 'Dashboard overview' : section}</h1><p>{section === 'Users' ? 'Search accounts and open a user to review their complete account activity.' : section === 'Audit log' ? 'Review recorded administrator access to user details and private conversations.' : 'Live counts and user activity loaded from the iConnect database.'}</p></div>{section === 'Users' && <label className="admin-user-search"><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setUserOffset(0) }} placeholder="Search name, username, or email" aria-label="Search users" /></label>}</div>
          <div className="admin-safety-banner"><ShieldAlert size={18} /><span><strong>Restricted administrator data.</strong> User profile details and private conversations are visible to allowlisted admins. User-detail access is recorded in the audit log.</span></div>
          {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
          {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
          {loading && <p className="admin-detail-loading">Loading administrator data…</p>}
          {!loading && section === 'Overview' && overview && <>
            <div className="admin-metric-grid">{overviewItems.map(([key, label]) => <article className="admin-metric-card" key={key}><span>{label}</span><strong>{overview[key].toLocaleString()}</strong><small>Live database total</small></article>)}</div>
            <section className="admin-panel admin-queue-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">ADMIN ACCESS</span><h2>Recent audit events</h2></div><button type="button" className="admin-row-action" onClick={() => chooseSection('Audit log')}>View all</button></div>{auditEvents.length ? auditEvents.slice(0, 8).map((event) => <div className="admin-audit-entry" key={event.id}><span /><div><strong>{event.admin.name} accessed {event.action.replaceAll('_', ' ')}</strong><small>{event.subject ? `${event.subject.name} · ${event.subject.email} · ` : ''}{formatDate(event.createdAt)}</small></div></div>) : <div className="admin-content-empty"><Activity size={18} /><p>No administrator detail access recorded yet.</p></div>}</section>
          </>}
          {!loading && section === 'Users' && <section className="admin-panel admin-users-panel">
            <div className="admin-panel-heading"><div><span className="app-page-eyebrow">REGISTERED ACCOUNTS</span><h2>{userTotal.toLocaleString()} users</h2></div></div>
            {loadingUsers && <p className="admin-detail-loading">Loading accounts…</p>}
            {!loadingUsers && <div className="admin-live-user-list">{users.map((user) => <button type="button" className="admin-live-user-row" key={user.id} onClick={() => openUser(user)}>
              <span className="admin-live-user-avatar">{user.name.slice(0, 1)}</span>
              <span className="admin-live-user-identity"><strong>{user.name}</strong><small>@{user.username} · {user.email}</small></span>
              <span className={`admin-user-status ${user.emailVerified ? '' : 'status-review'}`}>{user.emailVerified ? 'Verified' : 'Unverified'}</span>
              <span className="admin-live-user-counts">{user.counts.posts} posts · {user.counts.messages} messages</span><ChevronRight size={16} />
            </button>)}
            {!users.length && <p className="admin-no-users">No accounts match your search.</p>}</div>}
            <div className="admin-users-pagination"><span>Showing {userTotal ? userOffset + 1 : 0}–{Math.min(userOffset + 50, userTotal)} of {userTotal}</span><div><button type="button" aria-label="Previous users" disabled={userOffset === 0 || loadingUsers} onClick={() => setUserOffset((offset) => Math.max(0, offset - 50))}><ChevronLeft size={15} /></button><button type="button" aria-label="Next users" disabled={userOffset + 50 >= userTotal || loadingUsers} onClick={() => setUserOffset((offset) => offset + 50)}><ChevronRight size={15} /></button></div></div>
          </section>}
          {!loading && section === 'Audit log' && <section className="admin-panel admin-queue-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">RECORDED ADMIN ACCESS</span><h2>Latest 100 events</h2></div><button type="button" className="admin-row-action" onClick={refreshAudit} disabled={loadingAudit}>{loadingAudit ? 'Loading…' : 'Refresh'}</button></div>{auditEvents.map((event) => <div className="admin-audit-entry" key={event.id}><span /><div><strong>{event.admin.name} ({event.admin.email}) · {event.action.replaceAll('_', ' ')}</strong><small>{event.subject ? `User: ${event.subject.name} (${event.subject.email}) · ` : ''}{formatDate(event.createdAt)}</small></div></div>)}{!auditEvents.length && <div className="admin-content-empty"><Activity size={18} /><p>No audit events recorded.</p></div>}</section>}
        </main>
      </div>
      {selectedUser && <UserDetails
        user={selectedUser}
        loading={!selectedUser.activity}
        error={detailError}
        onClose={() => setSelectedUser(null)}
        onLoadOlder={loadOlderActivity}
        loadingOlder={loadingOlder}
        hasMore={hasMore && olderOffset > 0}
      />}
    </div>
  )
}
