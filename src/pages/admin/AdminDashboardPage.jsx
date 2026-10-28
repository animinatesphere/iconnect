import React, { useEffect, useMemo, useState } from 'react'
import { Activity, BadgeDollarSign, BarChart3, Check, CircleHelp, FileVideo, Flag, LayoutDashboard, LogOut, Search, Settings, ShieldAlert, Users, Video } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { demoPeople, demoPosts } from '../../data/demoContent.js'
import { endDemoAdminSession, readDemoAdminState, writeDemoAdminState, defaultAdminSettings } from '../../utils/demoAdmin.js'
import { emptyDemoFeedState, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'

const sampleUsers = [
  { ...demoPeople[0], status: 'Active', joined: 'Oct 18', posts: 12, reports: 0 },
  { ...demoPeople[1], status: 'Active', joined: 'Oct 21', posts: 8, reports: 0 },
  { ...demoPeople[2], status: 'Review', joined: 'Oct 23', posts: 4, reports: 1 },
  { id: 'kai', name: 'Kai Bennett', handle: '@kaibennett', avatar: 'photo-1506794778202-cad84cf45f1d', status: 'Active', joined: 'Oct 26', posts: 6, reports: 0 },
]

const sampleReports = [
  { id: 'report-profile-jules', subject: 'Jules Morgan', type: 'Profile', reason: 'Sample community report', date: 'Today' },
  { id: 'report-video-example', subject: 'Creator video', type: 'Video', reason: 'Illustrative content review', date: 'Yesterday' },
  { id: 'report-community-example', subject: 'Community post', type: 'Post', reason: 'Sample spam report', date: 'Oct 24' },
]

const sections = [
  { id: 'Overview', icon: LayoutDashboard },
  { id: 'Users', icon: Users },
  { id: 'Content', icon: FileVideo },
  { id: 'Reports', icon: Flag },
  { id: 'Promotions', icon: BadgeDollarSign },
  { id: 'Settings', icon: Settings },
  { id: 'Analytics', icon: BarChart3 },
]

function makeAuditEntry(description) {
  return { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, description, time: new Date().toLocaleString() }
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const [section, setSection] = useState('Overview')
  const [search, setSearch] = useState('')
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [adminState, setAdminState] = useState({
    userStatuses: {},
    reviewedReportIds: [],
    settings: defaultAdminSettings,
    campaignStatuses: {},
    auditLog: [],
  })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
      setAdminState(readDemoAdminState())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load browser-local admin preview data.')
    }
  }, [])

  const users = useMemo(() => sampleUsers.map((user) => ({
    ...user,
    status: adminState.userStatuses[user.id] ?? user.status,
  })).filter((user) => `${user.name} ${user.handle} ${user.status}`.toLowerCase().includes(search.trim().toLowerCase())), [adminState.userStatuses, search])
  const contentItems = [...feedState.posts, ...demoPosts].filter((post) => `${post.name} ${post.videoTitle ?? ''} ${post.text}`.toLowerCase().includes(search.trim().toLowerCase()))
  const localVideos = feedState.posts.filter((post) => post.mediaType === 'video')
  const campaigns = feedState.promotionCampaigns.map((campaign) => ({
    ...campaign,
    status: adminState.campaignStatuses[campaign.id] ?? campaign.status,
  }))
  const pendingReports = sampleReports.filter((report) => !adminState.reviewedReportIds.includes(report.id))

  function persistAdmin(nextState, message) {
    try {
      const withAudit = { ...nextState, auditLog: [makeAuditEntry(message), ...nextState.auditLog].slice(0, 20) }
      writeDemoAdminState(withAudit)
      setAdminState(withAudit)
      setNotice(message)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The admin preview change could not be saved.')
    }
  }

  function updateUserStatus(user) {
    const currentStatus = adminState.userStatuses[user.id] ?? user.status
    const nextStatus = currentStatus === 'Suspended demo' ? 'Active' : 'Suspended demo'
    persistAdmin({
      ...adminState,
      userStatuses: { ...adminState.userStatuses, [user.id]: nextStatus },
    }, `${user.name} marked ${nextStatus.toLowerCase()} in this browser demo.`)
  }

  function toggleContentVisibility(post) {
    try {
      const current = readDemoFeedState()
      const isHidden = current.hiddenPostIds.includes(post.id)
      const hiddenPostIds = isHidden
        ? current.hiddenPostIds.filter((id) => id !== post.id)
        : [...current.hiddenPostIds, post.id]
      const updatedFeed = { ...current, hiddenPostIds }
      writeDemoFeedState(updatedFeed)
      setFeedState(updatedFeed)
      persistAdmin(adminState, `${post.name}'s sample post ${isHidden ? 'restored to' : 'hidden from'} this browser's feed.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update local feed visibility.')
    }
  }

  function reviewReport(report) {
    persistAdmin({
      ...adminState,
      reviewedReportIds: [...new Set([...adminState.reviewedReportIds, report.id])],
    }, `Sample report for ${report.subject} marked reviewed.`)
  }

  function updateCampaign(campaign, status) {
    try {
      const current = readDemoFeedState()
      const promotionCampaigns = current.promotionCampaigns.map((item) => item.id === campaign.id ? { ...item, status } : item)
      const updated = { ...current, promotionCampaigns }
      writeDemoFeedState(updated)
      setFeedState(updated)
      persistAdmin({
        ...adminState,
        campaignStatuses: { ...adminState.campaignStatuses, [campaign.id]: status },
      }, `Campaign draft ${status.toLowerCase()} locally. No payment or delivery occurred.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update the local campaign draft.')
    }
  }

  function updateSettings(key) {
    persistAdmin({
      ...adminState,
      settings: { ...adminState.settings, [key]: !adminState.settings[key] },
    }, `Demo setting ${key === 'videoUploadsEnabled' ? 'video uploads' : 'campaign drafts'} ${adminState.settings[key] ? 'disabled' : 'enabled'}.`)
  }

  function signOut() {
    try {
      endDemoAdminSession()
      navigate('/admin/login', { replace: true })
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Could not close the local admin preview.')
    }
  }

  function openSection(nextSection) {
    setSection(nextSection)
    setSearch('')
    setNotice('')
  }

  const userTotal = sampleUsers.length
  const contentTotal = demoPosts.length + feedState.posts.length
  const title = section === 'Overview' ? 'Dashboard overview' : section

  return (
    <div className="admin-portal">
      <PageMeta title="Admin dashboard" description="Browser-only iConnect admin preview controls." />
      <aside className="admin-portal-sidebar">
        <Link to="/admin/dashboard" className="admin-portal-brand">iConnect<span>ADMIN PREVIEW</span></Link>
        <div className="admin-portal-account"><span className="admin-portal-avatar">A</span><span><strong>Demo administrator</strong><small>Local preview session</small></span><i /></div>
        <span className="admin-portal-nav-label">WORKSPACE</span>
        <nav className="admin-portal-nav" aria-label="Admin dashboard navigation">
          {sections.map(({ id, icon: Icon }) => <button key={id} type="button" className={section === id ? 'admin-portal-nav-active' : ''} onClick={() => openSection(id)}><Icon size={16} /><span>{id}</span>{id === 'Reports' && pendingReports.length > 0 && <small>{pendingReports.length}</small>}</button>)}
        </nav>
        <div className="admin-portal-sidebar-footer"><div className="admin-portal-local-note"><ShieldAlert size={15} /><span>Browser-only controls. Not real site administration.</span></div><button type="button" onClick={signOut}><LogOut size={15} /> Sign out of preview</button><Link to="/">Return to public site</Link></div>
      </aside>

      <div className="admin-portal-main">
        <header className="admin-portal-topbar"><div><span>iConnect admin</span><b>/</b><strong>{title}</strong></div><div className="admin-portal-topbar-actions"><span className="admin-preview-chip"><i /> LOCAL DEMO</span><button type="button" onClick={signOut}><LogOut size={14} /> Sign out</button></div></header>
        <main className="admin-portal-content">
          <div className="admin-portal-page-heading"><div><span className="app-page-eyebrow">WEBSITE OPERATIONS · DEMO</span><h1>{title}</h1><p>Manage sample records and this browser's local preview state.</p></div>{['Users', 'Content'].includes(section) && <label className="admin-user-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${section.toLowerCase()}`} aria-label={`Search ${section.toLowerCase()}`} /></label>}</div>
          <div className="admin-safety-banner"><ShieldAlert size={18} /><span><strong>Separate demo portal—not secure access control.</strong> The sign-in is client-side only. Changes affect sample or browser-local records; they do not control the public website or real users.</span></div>
          {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
          {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}

          {section === 'Overview' && <>
            <div className="admin-metric-grid">
              <article className="admin-metric-card"><span><Users size={16} /> Sample users</span><strong>{userTotal}</strong><small>Fictional directory records</small></article>
              <article className="admin-metric-card"><span><Video size={16} /> Local videos</span><strong>{localVideos.length}</strong><small>Stored in this browser only</small></article>
              <article className="admin-metric-card"><span><Activity size={16} /> Feed items</span><strong>{contentTotal}</strong><small>Sample + local posts</small></article>
              <article className="admin-metric-card"><span><Flag size={16} /> Reports pending</span><strong>{pendingReports.length}</strong><small>Illustrative moderation queue</small></article>
            </div>
            <div className="admin-overview-grid">
              <section className="admin-panel admin-chart-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">PAYMENTS NOT CONNECTED</span><h2>Revenue</h2></div><BadgeDollarSign size={17} /></div><div className="admin-chart-total"><strong>$0.00</strong><small>No actual payments or earnings are available in this demo.</small></div><div className="admin-revenue-state"><BarChart3 size={21} /><p>Connect verified billing and server-side transaction records before reporting revenue.</p></div></section>
              <section className="admin-panel admin-queue-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">RECENT ACTIVITY</span><h2>Local admin log</h2></div><Activity size={17} /></div>{adminState.auditLog.length ? adminState.auditLog.slice(0, 5).map((entry) => <div className="admin-audit-entry" key={entry.id}><span /><div><strong>{entry.description}</strong><small>{entry.time}</small></div></div>) : <div className="admin-content-empty"><CircleHelp size={18} /><p>No local admin actions yet.</p><small>Changes made in this preview will appear here.</small></div>}</section>
            </div>
            <div className="admin-preview-footnote"><CircleHelp size={15} /> Metrics are computed from sample/local data. They are not production analytics, user counts, or revenue.</div>
          </>}

          {section === 'Users' && <section className="admin-panel admin-users-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">SAMPLE ACCOUNT DIRECTORY</span><h2>{users.length} demo profiles</h2></div></div><div className="admin-user-table-wrap"><table className="admin-user-table"><thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Posts</th><th>Reports</th><th>Demo action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="admin-user-cell"><Avatar person={{ name: user.name, image: user.avatar }} /><span><strong>{user.name}</strong><small>{user.handle}</small></span></div></td><td><span className={`admin-user-status ${user.status !== 'Active' ? 'status-review' : ''}`}>{user.status}</span></td><td>{user.joined}</td><td>{user.posts}</td><td>{user.reports}</td><td><button type="button" className="admin-row-action" onClick={() => updateUserStatus(user)}>{user.status === 'Suspended demo' ? 'Reactivate' : 'Suspend demo'}</button></td></tr>)}</tbody></table>{!users.length && <p className="admin-no-users">No sample users match that search.</p>}</div><p className="admin-panel-note">Suspend/reactivate changes only a local sample status; it cannot block or change a real account.</p></section>}

          {section === 'Content' && <section className="admin-panel admin-content-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">LOCAL FEED MODERATION PREVIEW</span><h2>{contentItems.length} sample and local posts</h2></div></div>{contentItems.length ? <div className="admin-content-list">{contentItems.map((post) => { const hidden = feedState.hiddenPostIds.includes(post.id); return <article key={post.id}><div className="admin-content-item-type">{post.mediaType === 'video' ? <Video size={16} /> : <FileVideo size={16} />}</div><div className="admin-content-copy"><strong>{post.videoTitle ?? post.name}</strong><small>{post.name} · {post.mediaType === 'video' ? 'Video' : 'Post'} · {post.text}</small></div><span className={hidden ? 'admin-hidden-status' : 'admin-visible-status'}>{hidden ? 'Hidden locally' : 'Visible in demo'}</span><button type="button" className="admin-row-action" onClick={() => toggleContentVisibility(post)}>{hidden ? 'Restore' : 'Hide'}</button></article>})}</div> : <p className="admin-no-users">No posts match that search.</p>}<p className="admin-panel-note">Hide/restore updates this browser's demo feed only. It does not remove a public post or notify its author.</p></section>}

          {section === 'Reports' && <section className="admin-panel admin-reports-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">ILLUSTRATIVE MODERATION QUEUE</span><h2>{pendingReports.length} reports need review</h2></div><Flag size={17} /></div>{sampleReports.map((report) => { const reviewed = adminState.reviewedReportIds.includes(report.id); return <article className="admin-report-row" key={report.id}><span className={`admin-report-icon ${reviewed ? 'is-reviewed' : ''}`}>{reviewed ? <Check size={16} /> : <Flag size={16} />}</span><div><strong>{report.subject}</strong><small>{report.type} · {report.reason} · {report.date}</small><small>{reviewed ? 'Reviewed in this browser' : 'Sample report — no user submitted this'}</small></div><button type="button" className="admin-row-action" onClick={() => reviewReport(report)} disabled={reviewed}>{reviewed ? 'Reviewed' : 'Mark reviewed'}</button></article>})}<p className="admin-panel-note">Reports are illustrative fixtures. No real user report or moderation case is connected.</p></section>}

          {section === 'Promotions' && <section className="admin-panel admin-promotions-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">CAMPAIGN REVIEW</span><h2>{campaigns.length} local campaign drafts</h2></div><BadgeDollarSign size={17} /></div>{campaigns.length ? campaigns.map((campaign) => <article className="admin-promotion-row" key={campaign.id}><div><strong>{feedState.posts.find((post) => post.id === campaign.postId)?.videoTitle ?? 'Local video campaign'}</strong><small>{campaign.objective} · {campaign.dailyBudget} demo credits/day · {campaign.days} days</small><span>{campaign.status} · not charged, delivered, or guaranteed to gain viewers</span></div><div className="admin-promotion-actions"><button type="button" className="admin-row-action" onClick={() => updateCampaign(campaign, 'Reviewed in demo')}>Review</button><button type="button" className="admin-row-action is-danger" onClick={() => updateCampaign(campaign, 'Rejected in demo')}>Reject</button></div></article>) : <div className="admin-content-empty"><BadgeDollarSign size={18} /><p>No local campaign drafts.</p><small>Drafts created in the video studio will appear here.</small></div>}<p className="admin-panel-note">Review/reject changes only the browser-local draft label. There is no ad system, billing, or viewer guarantee.</p></section>}

          {section === 'Settings' && <section className="admin-panel admin-settings-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">LOCAL PREVIEW SETTINGS</span><h2>Demo feature controls</h2></div><Settings size={17} /></div><button type="button" className="admin-setting-row" onClick={() => updateSettings('videoUploadsEnabled')}><span><strong>Allow video uploads in this browser</strong><small>Controls the local upload form in Video Studio.</small></span><span className={adminState.settings.videoUploadsEnabled ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={adminState.settings.videoUploadsEnabled ? 'On' : 'Off'} /></button><button type="button" className="admin-setting-row" onClick={() => updateSettings('campaignDraftsEnabled')}><span><strong>Allow campaign draft previews</strong><small>Controls saving simulated reach-campaign drafts; no charge or delivery.</small></span><span className={adminState.settings.campaignDraftsEnabled ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={adminState.settings.campaignDraftsEnabled ? 'On' : 'Off'} /></button><p className="admin-panel-note">These are browser-local preview switches, not global website configuration or production feature flags.</p></section>}

          {section === 'Analytics' && <section className="admin-panel admin-analytics-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">LOCAL DEMO COUNTS</span><h2>Preview analytics</h2></div><BarChart3 size={17} /></div><div className="admin-analytics-grid"><article><span>Fictional sample profiles</span><strong>{userTotal}</strong></article><article><span>Sample posts</span><strong>{demoPosts.length}</strong></article><article><span>Local posts</span><strong>{feedState.posts.length}</strong></article><article><span>Local video uploads</span><strong>{localVideos.length}</strong></article><article><span>Campaign drafts</span><strong>{campaigns.length}</strong></article><article><span>Revenue connected</span><strong>No</strong></article></div><div className="admin-revenue-state"><BadgeDollarSign size={19} /><p>Actual revenue is $0.00 in this prototype because no payment processor or transactions are connected.</p></div></section>}
        </main>
      </div>
    </div>
  )
}
