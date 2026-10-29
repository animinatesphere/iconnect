import React, { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, BadgeDollarSign, BarChart3, Check, CircleHelp, FileVideo, Flag, LayoutDashboard, LogOut, PackagePlus, Pencil, Search, Settings, ShieldAlert, ShoppingBag, Users, Video, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { demoPeople, demoPosts } from '../../data/demoContent.js'
import { demoProductImages, demoProducts } from '../../data/demoCommerce.js'
import { emptyDemoServicesState, readDemoServicesState } from '../../utils/demoServices.js'
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
  { id: 'Products', icon: ShoppingBag },
  { id: 'Orders', icon: PackagePlus },
  { id: 'Content', icon: FileVideo },
  { id: 'Reports', icon: Flag },
  { id: 'Promotions', icon: BadgeDollarSign },
  { id: 'Settings', icon: Settings },
  { id: 'Analytics', icon: BarChart3 },
]

const featureSettings = [
  ['walletsEnabled', 'Enable wallet previews', 'Wallet and multichain account screens'],
  ['paymentsEnabled', 'Enable payment previews', 'Simulated transfers, remittance, conversion, and card mockup'],
  ['tradingEnabled', 'Enable iTrade preview', 'Paper trading and mock market charts'],
  ['marketplaceEnabled', 'Enable iBuy preview', 'Product browsing and demo checkout'],
  ['bookingsEnabled', 'Enable iBook preview', 'Flight, taxi, and car booking previews'],
  ['socialEnabled', 'Enable social updates', 'Text posts, likes, and reposts in this browser'],
  ['liveVideoEnabled', 'Enable live video preview', 'On-device camera preview; no broadcast'],
  ['videoUploadsEnabled', 'Enable video uploads', 'Local MP4/WebM video library'],
  ['campaignDraftsEnabled', 'Enable promotion drafts', 'Mock campaign setup only; no billing or ad delivery'],
]

function makeAuditEntry(description) {
  return { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, description, time: new Date().toLocaleString() }
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const { productId } = useParams()
  const [section, setSection] = useState('Overview')
  const [search, setSearch] = useState('')
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [servicesState, setServicesState] = useState(emptyDemoServicesState)
  const [adminState, setAdminState] = useState({
    userStatuses: {},
    reviewedReportIds: [],
    settings: defaultAdminSettings,
    campaignStatuses: {},
    auditLog: [],
    productCatalog: [],
    productOverrides: {},
    orderStatuses: {},
  })
  const [selectedUser, setSelectedUser] = useState(null)
  const [productForm, setProductForm] = useState(null)
  const [editingProductId, setEditingProductId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
      setServicesState(readDemoServicesState())
      setAdminState(readDemoAdminState())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load browser-local admin preview data.')
    }
  }, [])

  useEffect(() => {
    if (productId) setSection('Products')
  }, [productId])

  const users = useMemo(() => sampleUsers.map((user) => ({
    ...user,
    status: adminState.userStatuses[user.id] ?? user.status,
  })).filter((user) => `${user.name} ${user.handle} ${user.status}`.toLowerCase().includes(search.trim().toLowerCase())), [adminState.userStatuses, search])
  const managedProducts = [
    ...demoProducts.map((product) => ({ ...product, ...adminState.productOverrides[product.id], isSample: true })),
    ...(adminState.productCatalog ?? []).map((product) => ({ ...product, isSample: false })),
  ].filter((product) => `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  const detailProduct = productId
    ? [...demoProducts.map((product) => ({ ...product, ...adminState.productOverrides[product.id], isSample: true })), ...(adminState.productCatalog ?? []).map((product) => ({ ...product, isSample: false }))].find((product) => product.id === productId)
    : null
  const openOrders = servicesState.orders.map((order) => ({
    ...order,
    status: adminState.orderStatuses[order.id] ?? order.status,
  }))
  const contentItems = [...feedState.posts, ...demoPosts].filter((post) => `${post.name} ${post.videoTitle ?? ''} ${post.text}`.toLowerCase().includes(search.trim().toLowerCase()))
  const localVideos = feedState.posts.filter((post) => post.mediaType === 'video')
  const campaigns = feedState.promotionCampaigns.map((campaign) => ({
    ...campaign,
    status: adminState.campaignStatuses[campaign.id] ?? campaign.status,
  }))
  const pendingReports = sampleReports.filter((report) => !adminState.reviewedReportIds.includes(report.id))
  const activityChartData = [
    { label: 'Posts', value: feedState.posts.length },
    { label: 'Reactions', value: feedState.likedPostIds.length },
    { label: 'Payments', value: servicesState.transactions.length },
    { label: 'Trades', value: servicesState.trades.length },
    { label: 'Orders', value: servicesState.orders.length },
    { label: 'Bookings', value: servicesState.bookings.length },
  ]
  const maxActivity = Math.max(1, ...activityChartData.map((item) => item.value))

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

  function userDetails(user) {
    setSelectedUser(user)
  }

  function startProductForm(product = null) {
    setEditingProductId(product?.id ?? '')
    setProductForm(product
      ? { name: product.name, category: product.category, price: String(product.price), stock: String(product.stock), description: product.description }
      : { name: '', category: 'Home', price: '', stock: '1', description: '' })
    setNotice('')
    setError('')
  }

  function saveProduct(event) {
    event.preventDefault()
    const price = Number(productForm.price)
    const stock = Number(productForm.stock)
    if (!productForm.name.trim() || !productForm.description.trim() || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
      setError('Enter a product name, description, positive demo price, and whole-number inventory of zero or more.')
      return
    }

    const existing = editingProductId ? managedProducts.find((product) => product.id === editingProductId) : null
    const record = {
      id: editingProductId || `admin-product-${Date.now()}`,
      name: productForm.name.trim(),
      category: productForm.category,
      price,
      stock,
      description: productForm.description.trim(),
      rating: existing?.rating ?? 'New',
      image: existing?.image ?? demoProductImages[productForm.category] ?? demoProductImages.Other,
      published: existing?.published ?? true,
      archived: existing?.archived ?? false,
    }
    if (existing?.isSample) {
      persistAdmin({
        ...adminState,
        productOverrides: { ...adminState.productOverrides, [record.id]: record },
      }, `Product listing “${record.name}” updated in this browser demo.`)
    } else {
      const productCatalog = editingProductId
        ? adminState.productCatalog.map((item) => item.id === record.id ? record : item)
        : [record, ...adminState.productCatalog]
      persistAdmin({ ...adminState, productCatalog }, `${editingProductId ? 'Product listing updated' : 'Product listed'}: “${record.name}”.`)
    }
    setProductForm(null)
    setEditingProductId('')
  }

  function toggleProductPublished(product) {
    const published = product.published === false
    const updatedProduct = { ...product, published }
    if (product.isSample) {
      persistAdmin({
        ...adminState,
        productOverrides: { ...adminState.productOverrides, [product.id]: updatedProduct },
      }, `Sample listing “${product.name}” ${published ? 'published' : 'unpublished'} in this browser.`)
      return
    }
    persistAdmin({
      ...adminState,
      productCatalog: adminState.productCatalog.map((item) => item.id === product.id ? updatedProduct : item),
    }, `Listing “${product.name}” ${published ? 'published' : 'unpublished'} in this browser.`)
  }

  function archiveProduct(product) {
    if (product.isSample) {
      persistAdmin({
        ...adminState,
        productOverrides: { ...adminState.productOverrides, [product.id]: { ...product, published: false, archived: true } },
      }, `Sample listing “${product.name}” archived from this demo store.`)
      return
    }
    persistAdmin({
      ...adminState,
      productCatalog: adminState.productCatalog.map((item) => item.id === product.id ? { ...item, published: false, archived: true } : item),
    }, `Listing “${product.name}” archived from this demo store.`)
  }

  function restoreProduct(product) {
    if (product.isSample) {
      persistAdmin({
        ...adminState,
        productOverrides: { ...adminState.productOverrides, [product.id]: { ...product, published: false, archived: false } },
      }, `Sample listing “${product.name}” restored as an unpublished listing.`)
      return
    }
    persistAdmin({
      ...adminState,
      productCatalog: adminState.productCatalog.map((item) => item.id === product.id ? { ...item, published: false, archived: false } : item),
    }, `Listing “${product.name}” restored as an unpublished listing.`)
  }

  function updateOrderStatus(order, status) {
    const previousStatus = adminState.orderStatuses[order.id] ?? order.status
    const stockDirection = status === 'Cancelled demo' && previousStatus !== 'Cancelled demo'
      ? 1
      : status !== 'Cancelled demo' && previousStatus === 'Cancelled demo'
        ? -1
        : 0
    const productOverrides = { ...adminState.productOverrides }
    let productCatalog = adminState.productCatalog
    if (stockDirection) {
      productCatalog = adminState.productCatalog.map((product) => ({ ...product }))
      for (const item of order.items ?? []) {
        const sample = demoProducts.find((product) => product.id === item.productId)
        const custom = productCatalog.find((product) => product.id === item.productId)
        const currentStock = sample
          ? productOverrides[item.productId]?.stock ?? sample.stock
          : custom?.stock
        if (!Number.isInteger(currentStock) || (stockDirection < 0 && currentStock < item.quantity)) {
          setError(`Could not update order ${order.id}: demo inventory is unavailable for ${item.name}.`)
          return
        }
        const stock = currentStock + stockDirection * item.quantity
        if (sample) {
          productOverrides[item.productId] = { ...productOverrides[item.productId], stock }
        } else if (custom) {
          productCatalog = productCatalog.map((product) => product.id === item.productId ? { ...product, stock } : product)
        }
      }
    }
    persistAdmin({
      ...adminState,
      productOverrides,
      productCatalog,
      orderStatuses: { ...adminState.orderStatuses, [order.id]: status },
    }, `Demo order ${order.id} marked ${status.toLowerCase()}.`)
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
    const settingLabel = featureSettings.find(([settingKey]) => settingKey === key)?.[1] ?? key
    persistAdmin({
      ...adminState,
      settings: { ...adminState.settings, [key]: !adminState.settings[key] },
    }, `Demo setting “${settingLabel}” ${adminState.settings[key] ? 'disabled' : 'enabled'}.`)
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
  const title = productId ? detailProduct?.name ?? 'Product details' : section === 'Overview' ? 'Dashboard overview' : section

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
          <div className="admin-portal-page-heading"><div><span className="app-page-eyebrow">WEBSITE OPERATIONS · DEMO</span><h1>{title}</h1><p>Manage sample records and this browser's local preview state.</p></div>{['Users', 'Products', 'Content'].includes(section) && <label className="admin-user-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${section.toLowerCase()}`} aria-label={`Search ${section.toLowerCase()}`} /></label>}</div>
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
              <section className="admin-panel admin-chart-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">LOCAL DEMO ACTIVITY</span><h2>Activity chart</h2></div><span>Events in this browser</span></div><div className="admin-activity-chart" role="img" aria-label="Local demo activity counts for posts, reactions, payments, trades, orders and bookings">{activityChartData.map((item) => <div key={item.label}><strong>{item.value}</strong><span style={{ height: `${Math.max(7, item.value / maxActivity * 100)}%` }} /><small>{item.label}</small></div>)}</div><p className="admin-panel-note">Counts update from local demo actions. They are not real user or business analytics.</p></section>
              <section className="admin-panel admin-chart-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">PAYMENTS NOT CONNECTED</span><h2>Revenue</h2></div><BadgeDollarSign size={17} /></div><div className="admin-chart-total"><strong>$0.00</strong><small>No actual payments or earnings are available in this demo.</small></div><div className="admin-revenue-state"><BarChart3 size={21} /><p>Connect verified billing and server-side transaction records before reporting revenue.</p></div></section>
              <section className="admin-panel admin-queue-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">RECENT ACTIVITY</span><h2>Local admin log</h2></div><Activity size={17} /></div>{adminState.auditLog.length ? adminState.auditLog.slice(0, 5).map((entry) => <div className="admin-audit-entry" key={entry.id}><span /><div><strong>{entry.description}</strong><small>{entry.time}</small></div></div>) : <div className="admin-content-empty"><CircleHelp size={18} /><p>No local admin actions yet.</p><small>Changes made in this preview will appear here.</small></div>}</section>
            </div>
            <div className="admin-preview-footnote"><CircleHelp size={15} /> Metrics are computed from sample/local data. They are not production analytics, user counts, or revenue.</div>
          </>}

          {section === 'Users' && <section className="admin-panel admin-users-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">SAMPLE ACCOUNT DIRECTORY</span><h2>{users.length} demo profiles</h2></div></div><div className="admin-user-table-wrap"><table className="admin-user-table"><thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Posts</th><th>Reports</th><th>Demo actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="admin-user-cell"><Avatar person={{ name: user.name, image: user.avatar }} /><span><strong>{user.name}</strong><small>{user.handle}</small></span></div></td><td><span className={`admin-user-status ${user.status !== 'Active' ? 'status-review' : ''}`}>{user.status}</span></td><td>{user.joined}</td><td>{user.posts}</td><td>{user.reports}</td><td><div className="admin-row-actions"><button type="button" className="admin-row-action" onClick={() => userDetails(user)}>Details</button><button type="button" className="admin-row-action" onClick={() => updateUserStatus(user)}>{user.status === 'Suspended demo' ? 'Reactivate' : 'Suspend'}</button></div></td></tr>)}</tbody></table>{!users.length && <p className="admin-no-users">No sample users match that search.</p>}</div><p className="admin-panel-note">Only fictional sample records are available. Private credentials, messages, bank details, and wallet keys are never shown or managed.</p></section>}

          {section === 'Products' && (productId ? <section className="admin-panel admin-product-detail-panel">{detailProduct ? <><button type="button" className="admin-product-back" onClick={() => { setSection('Products'); navigate('/admin/dashboard') }}><ArrowLeft size={14} /> Back to product catalog</button><div className="admin-product-detail-layout"><img src={`https://images.unsplash.com/${detailProduct.image}?auto=format&fit=crop&w=1200&h=1000&q=85`} alt={detailProduct.name} /><div className="admin-product-detail-copy"><span className="app-page-eyebrow">IBUY · {detailProduct.isSample ? 'SAMPLE LISTING' : 'ADMIN LISTING'}</span><div className="admin-product-detail-title"><h2>{detailProduct.name}</h2><span className={detailProduct.archived || detailProduct.published === false ? 'admin-hidden-status' : 'admin-visible-status'}>{detailProduct.archived ? 'Archived' : detailProduct.published === false ? 'Unpublished' : 'Published'}</span></div><p>{detailProduct.description}</p><strong className="admin-product-detail-price">₦{new Intl.NumberFormat('en-NG').format(detailProduct.price)}</strong><dl><div><dt>Product ID</dt><dd>{detailProduct.id}</dd></div><div><dt>Category</dt><dd>{detailProduct.category}</dd></div><div><dt>Inventory</dt><dd>{detailProduct.stock} demo units</dd></div><div><dt>Rating</dt><dd>{detailProduct.rating ?? 'New'}</dd></div><div><dt>Seller</dt><dd>iBuy sample store</dd></div><div><dt>Listing source</dt><dd>{detailProduct.isSample ? 'Fictional sample catalog' : 'Created in this browser demo'}</dd></div></dl><div className="admin-product-detail-actions"><button type="button" className="admin-row-action" onClick={() => startProductForm(detailProduct)}><Pencil size={13} /> Edit product</button>{detailProduct.archived ? <button type="button" className="admin-row-action" onClick={() => restoreProduct(detailProduct)}>Restore listing</button> : <button type="button" className="admin-row-action" onClick={() => toggleProductPublished(detailProduct)}>{detailProduct.published === false ? 'Publish listing' : 'Unpublish listing'}</button>}</div><p className="admin-panel-note">This page shows sample data held only in this browser. It does not represent a real seller, inventory system, or sale.</p></div></div></> : <div className="admin-content-empty"><PackagePlus size={18} /><p>We couldn't find this product.</p><button type="button" className="admin-row-action" onClick={() => { setSection('Products'); navigate('/admin/dashboard') }}>Return to product catalog</button></div>}</section> : <section className="admin-panel admin-products-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">IBUY CATALOG MANAGEMENT</span><h2>{managedProducts.length} listings</h2></div><button type="button" className="app-primary-button admin-add-product" onClick={() => startProductForm()}><PackagePlus size={15} /> Add product</button></div><div className="admin-product-list">{managedProducts.map((product) => <article key={product.id}><button type="button" className="admin-product-thumbnail" aria-label={`View ${product.name} details`} onClick={() => navigate(`/admin/dashboard/products/${encodeURIComponent(product.id)}`)}><img src={`https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=140&h=120&q=70`} alt="" /></button><div className="admin-product-copy"><button type="button" className="admin-product-open" onClick={() => navigate(`/admin/dashboard/products/${encodeURIComponent(product.id)}`)}>{product.name}</button><small>{product.category} · {product.isSample ? 'Sample listing' : 'Admin-created listing'}</small><small>{product.description}</small></div><div className="admin-product-metrics"><b>₦{new Intl.NumberFormat('en-NG').format(product.price)}</b><small>{product.stock} in demo stock</small></div><span className={product.archived || product.published === false ? 'admin-hidden-status' : 'admin-visible-status'}>{product.archived ? 'Archived' : product.published === false ? 'Unpublished' : 'Published'}</span><div className="admin-row-actions"><button type="button" className="admin-row-action" onClick={() => startProductForm(product)}><Pencil size={12} /> Edit</button>{product.archived ? <button type="button" className="admin-row-action" onClick={() => restoreProduct(product)}>Restore</button> : <button type="button" className="admin-row-action" onClick={() => toggleProductPublished(product)}>{product.published === false ? 'Publish' : 'Unpublish'}</button>}{!product.isSample && !product.archived && <button type="button" className="admin-row-action is-danger" onClick={() => archiveProduct(product)}>Archive</button>}</div></article>)}</div><p className="admin-panel-note">Product listings are created by the demo administrator and appear in iBuy on this browser. Inventory, prices, and orders are mock records; no sales or deliveries occur.</p></section>)}

          {section === 'Orders' && <section className="admin-panel admin-orders-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">IBUY ORDER PREVIEW</span><h2>{openOrders.length} local orders</h2></div><ShoppingBag size={17} /></div>{openOrders.length ? <div className="admin-order-list">{openOrders.map((order) => <article key={order.id}><div className="admin-order-heading"><div><strong>Order {order.id}</strong><small>{new Date(order.createdAt).toLocaleString()} · demo customer</small></div><span>{order.status}</span></div><div className="admin-order-items">{(order.items ?? []).map((item) => <div key={item.productId}><span>{item.name} × {item.quantity}</span><b>₦{new Intl.NumberFormat('en-NG').format(item.price * item.quantity)}</b></div>)}</div><div className="admin-order-footer"><span>Total · ₦{new Intl.NumberFormat('en-NG').format(order.total)} · Payment not collected</span><div className="admin-row-actions"><button type="button" className="admin-row-action" onClick={() => updateOrderStatus(order, 'Processing demo')}>Mark processing</button><button type="button" className="admin-row-action" onClick={() => updateOrderStatus(order, 'Completed demo')}>Complete demo</button><button type="button" className="admin-row-action is-danger" onClick={() => updateOrderStatus(order, 'Cancelled demo')}>Cancel demo</button></div></div><p className="admin-order-private-note">Shipping address and payment details were not collected.</p></article>)}</div> : <div className="admin-content-empty"><ShoppingBag size={18} /><p>No local demo orders yet.</p><small>Demo checkout records appear here. No payment is processed.</small></div>}<p className="admin-panel-note">Order status changes are local mock updates only. No seller, customer, payment provider, or carrier is notified.</p></section>}

          {section === 'Content' && <section className="admin-panel admin-content-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">LOCAL FEED MODERATION PREVIEW</span><h2>{contentItems.length} sample and local posts</h2></div></div>{contentItems.length ? <div className="admin-content-list">{contentItems.map((post) => { const hidden = feedState.hiddenPostIds.includes(post.id); return <article key={post.id}><div className="admin-content-item-type">{post.mediaType === 'video' ? <Video size={16} /> : <FileVideo size={16} />}</div><div className="admin-content-copy"><strong>{post.videoTitle ?? post.name}</strong><small>{post.name} · {post.mediaType === 'video' ? 'Video' : 'Post'} · {post.text}</small></div><span className={hidden ? 'admin-hidden-status' : 'admin-visible-status'}>{hidden ? 'Hidden locally' : 'Visible in demo'}</span><button type="button" className="admin-row-action" onClick={() => toggleContentVisibility(post)}>{hidden ? 'Restore' : 'Hide'}</button></article>})}</div> : <p className="admin-no-users">No posts match that search.</p>}<p className="admin-panel-note">Hide/restore updates this browser's demo feed only. It does not remove a public post or notify its author.</p></section>}

          {section === 'Reports' && <section className="admin-panel admin-reports-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">ILLUSTRATIVE MODERATION QUEUE</span><h2>{pendingReports.length} reports need review</h2></div><Flag size={17} /></div>{sampleReports.map((report) => { const reviewed = adminState.reviewedReportIds.includes(report.id); return <article className="admin-report-row" key={report.id}><span className={`admin-report-icon ${reviewed ? 'is-reviewed' : ''}`}>{reviewed ? <Check size={16} /> : <Flag size={16} />}</span><div><strong>{report.subject}</strong><small>{report.type} · {report.reason} · {report.date}</small><small>{reviewed ? 'Reviewed in this browser' : 'Sample report — no user submitted this'}</small></div><button type="button" className="admin-row-action" onClick={() => reviewReport(report)} disabled={reviewed}>{reviewed ? 'Reviewed' : 'Mark reviewed'}</button></article>})}<p className="admin-panel-note">Reports are illustrative fixtures. No real user report or moderation case is connected.</p></section>}

          {section === 'Promotions' && <section className="admin-panel admin-promotions-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">CAMPAIGN REVIEW</span><h2>{campaigns.length} local campaign drafts</h2></div><BadgeDollarSign size={17} /></div>{campaigns.length ? campaigns.map((campaign) => <article className="admin-promotion-row" key={campaign.id}><div><strong>{feedState.posts.find((post) => post.id === campaign.postId)?.videoTitle ?? 'Local video campaign'}</strong><small>{campaign.objective} · {campaign.dailyBudget} demo credits/day · {campaign.days} days</small><span>{campaign.status} · not charged, delivered, or guaranteed to gain viewers</span></div><div className="admin-promotion-actions"><button type="button" className="admin-row-action" onClick={() => updateCampaign(campaign, 'Reviewed in demo')}>Review</button><button type="button" className="admin-row-action is-danger" onClick={() => updateCampaign(campaign, 'Rejected in demo')}>Reject</button></div></article>) : <div className="admin-content-empty"><BadgeDollarSign size={18} /><p>No local campaign drafts.</p><small>Drafts created in the video studio will appear here.</small></div>}<p className="admin-panel-note">Review/reject changes only the browser-local draft label. There is no ad system, billing, or viewer guarantee.</p></section>}

          {section === 'Settings' && <section className="admin-panel admin-settings-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">LOCAL PREVIEW SETTINGS</span><h2>Demo feature controls</h2></div><Settings size={17} /></div>{featureSettings.map(([key, label, description]) => <button type="button" className="admin-setting-row" key={key} onClick={() => updateSettings(key)}><span><strong>{label}</strong><small>{description}</small></span><span className={adminState.settings[key] ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={adminState.settings[key] ? 'On' : 'Off'} /></button>)}<p className="admin-panel-note">These browser-local preview switches gate the matching feature screens on this device. They are not global production website controls.</p></section>}

          {section === 'Analytics' && <section className="admin-panel admin-analytics-panel"><div className="admin-panel-heading"><div><span className="app-page-eyebrow">LOCAL DEMO COUNTS</span><h2>Preview analytics</h2></div><BarChart3 size={17} /></div><div className="admin-analytics-grid"><article><span>Fictional sample profiles</span><strong>{userTotal}</strong></article><article><span>Sample posts</span><strong>{demoPosts.length}</strong></article><article><span>Local posts</span><strong>{feedState.posts.length}</strong></article><article><span>Local video uploads</span><strong>{localVideos.length}</strong></article><article><span>Campaign drafts</span><strong>{campaigns.length}</strong></article><article><span>Demo payments / trades / orders</span><strong>{servicesState.transactions.length} / {servicesState.trades.length} / {servicesState.orders.length}</strong></article><article><span>Demo bookings</span><strong>{servicesState.bookings.length}</strong></article><article><span>Actual revenue connected</span><strong>$0.00</strong></article></div><div className="admin-activity-chart admin-analytics-chart" role="img" aria-label="Local demo activity chart">{activityChartData.map((item) => <div key={item.label}><strong>{item.value}</strong><span style={{ height: `${Math.max(7, item.value / maxActivity * 100)}%` }} /><small>{item.label}</small></div>)}</div><div className="admin-revenue-state"><BadgeDollarSign size={19} /><p>Actual revenue is $0.00 in this prototype because no payment processor or transactions are connected.</p></div></section>}
          {productForm && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setProductForm(null); setEditingProductId('') } }}><section className="admin-modal-card" role="dialog" aria-modal="true" aria-labelledby="product-form-title"><div className="admin-modal-heading"><div><span className="app-page-eyebrow">IBUY CATALOG</span><h2 id="product-form-title">{editingProductId ? 'Edit product listing' : 'Create a product listing'}</h2></div><button type="button" aria-label="Close product form" onClick={() => { setProductForm(null); setEditingProductId('') }}><X size={17} /></button></div><p className="admin-modal-note">This listing will appear in the local iBuy demo store. Do not enter real payment or customer details.</p><form className="admin-product-form" onSubmit={saveProduct}><label>Product name<input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} maxLength={70} required /></label><div className="admin-product-form-row"><label>Category<select value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })}><option>Home</option><option>Style</option><option>Tech</option><option>Other</option></select></label><label>Price (demo NGN)<input type="number" min="1" step="1" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} required /></label><label>Inventory<input type="number" min="0" step="1" value={productForm.stock} onChange={(event) => setProductForm({ ...productForm, stock: event.target.value })} required /></label></div><label>Description<textarea value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} maxLength={240} rows={3} required /></label><div className="admin-modal-actions"><button type="button" className="admin-row-action" onClick={() => { setProductForm(null); setEditingProductId('') }}>Cancel</button><button type="submit" className="app-primary-button">{editingProductId ? 'Save product' : 'Publish product'}</button></div></form></section></div>}
          {selectedUser && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedUser(null) }}><section className="admin-modal-card admin-user-detail-modal" role="dialog" aria-modal="true" aria-labelledby="user-detail-title"><div className="admin-modal-heading"><div><span className="app-page-eyebrow">FICTIONAL SAMPLE ACCOUNT</span><h2 id="user-detail-title">User details</h2></div><button type="button" aria-label="Close user details" onClick={() => setSelectedUser(null)}><X size={17} /></button></div><div className="admin-user-detail-head"><Avatar person={{ name: selectedUser.name, image: selectedUser.avatar }} /><div><strong>{selectedUser.name}</strong><small>{selectedUser.handle}</small></div><span className={`admin-user-status ${(adminState.userStatuses[selectedUser.id] ?? selectedUser.status) !== 'Active' ? 'status-review' : ''}`}>{adminState.userStatuses[selectedUser.id] ?? selectedUser.status}</span></div><dl className="admin-user-detail-list"><div><dt>Demo profile ID</dt><dd>{selectedUser.id}</dd></div><div><dt>Joined (sample date)</dt><dd>{selectedUser.joined}</dd></div><div><dt>Sample posts</dt><dd>{selectedUser.posts}</dd></div><div><dt>Sample reports</dt><dd>{selectedUser.reports}</dd></div><div><dt>Interests</dt><dd>{selectedUser.interests ?? 'Not included in this sample record'}</dd></div><div><dt>Profile note</dt><dd>{selectedUser.note ?? 'No sample bio provided'}</dd></div></dl><p className="admin-modal-note">No real account data, private messages, passwords, financial details, or wallet keys exist in this sample record.</p><button type="button" className="app-primary-button" onClick={() => { updateUserStatus(selectedUser); setSelectedUser(null) }}>{(adminState.userStatuses[selectedUser.id] ?? selectedUser.status) === 'Suspended demo' ? 'Reactivate sample account' : 'Suspend sample account'}</button></section></div>}
        </main>
      </div>
    </div>
  )
}
