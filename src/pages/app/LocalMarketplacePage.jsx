import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, MapPin, MessageCircle, Plus, Search, Sprout, Store, Wrench } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { apiRequest } from '../../utils/api.js'
import { createLocalMarketplaceListing, getLocalMarketplaceListing, getLocalMarketplaceListings } from '../../utils/localMarketplaceApi.js'
import { openConversation } from '../../utils/messageApi.js'

const categories = [
  { id: 'Homes', label: 'Homes', icon: Building2 },
  { id: 'Services', label: 'Services', icon: Wrench },
  { id: 'Farm', label: 'Farm', icon: Sprout },
]
const emptyForm = { category: 'Homes', title: '', price: '', location: '', detail: '', description: '', imageUrl: '' }

export default function LocalMarketplacePage() {
  const { listingId } = useParams()
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState('Homes')
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [listings, setListings] = useState([])
  const [selectedListing, setSelectedListing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [messagingSeller, setMessagingSeller] = useState(false)
  const [error, setError] = useState('')
  const [searchHint, setSearchHint] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [currentUserId, setCurrentUserId] = useState('')

  useEffect(() => {
    let active = true
    if (listingId) {
      setLoading(false)
      return () => { active = false }
    }
    if (query.trim().length === 1) {
      setListings([])
      setError('')
      setSearchHint('Enter at least two characters to search.')
      setLoading(false)
      return () => { active = false }
    }
    setSearchHint('')
    setLoading(true)
    getLocalMarketplaceListings({ category: activeCategory, query, location })
      .then((loadedListings) => {
        if (active) {
          setListings(loadedListings)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load marketplace listings.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [activeCategory, listingId, location, query, retry])

  useEffect(() => {
    if (!listingId) {
      setSelectedListing(null)
      return undefined
    }
    let active = true
    setLoadingDetail(true)
    getLocalMarketplaceListing(listingId)
      .then((listing) => {
        if (active) {
          setSelectedListing(listing)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) {
          setSelectedListing(null)
          setError(loadError instanceof Error ? loadError.message : 'Could not load this listing.')
        }
      })
      .finally(() => {
        if (active) setLoadingDetail(false)
      })
    return () => { active = false }
  }, [listingId])

  useEffect(() => {
    let active = true
    apiRequest('/api/auth/me')
      .then((payload) => {
        if (active) setCurrentUserId(payload.user.id)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not verify your account.')
      })
    return () => { active = false }
  }, [])

  async function submitListing(event) {
    event.preventDefault()
    setPublishing(true)
    try {
      const created = await createLocalMarketplaceListing(form)
      setListings((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setForm(emptyForm)
      setFormOpen(false)
      setNotice('Your listing is live in the local marketplace.')
      setError('')
      navigate(`/app/marketplace/${created.id}`)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Your listing could not be published.')
    } finally {
      setPublishing(false)
    }
  }

  async function contactSeller(listing) {
    setMessagingSeller(true)
    try {
      const conversationId = await openConversation(listing.seller.id)
      navigate('/app/chat', { state: { conversationId } })
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : 'Could not open a conversation with this provider.')
    } finally {
      setMessagingSeller(false)
    }
  }

  if (listingId) {
    return (
      <div className="app-content-width product-detail-page marketplace-detail-page">
        <PageMeta title={selectedListing ? `${selectedListing.title} | iConnect marketplace` : 'Marketplace listing | iConnect'} description={selectedListing?.description ?? 'Member listing in the iConnect local marketplace.'} />
        <Link to="/app/marketplace" className="app-back-link"><ArrowLeft size={14} /> Back to marketplace</Link>
        {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
        {loadingDetail && <p className="inbox-empty-state">Loading listing…</p>}
        {!loadingDetail && selectedListing && <section className="marketplace-detail-layout">
          <div className="marketplace-detail-gallery"><div className="marketplace-detail-main-image">{selectedListing.imageUrl ? <img src={selectedListing.imageUrl} alt={selectedListing.title} /> : <div className="ibuy-image-placeholder"><Store size={32} /></div>}</div><div className="marketplace-detail-gallery-caption"><span><MapPin size={14} />{selectedListing.location}</span><span>{selectedListing.category} listing</span></div></div>
          <div className="marketplace-detail-information"><span className="app-page-eyebrow">{selectedListing.category.toUpperCase()} · LISTING</span><h1>{selectedListing.title}</h1><p className="marketplace-detail-price">{selectedListing.price}</p><div className="marketplace-detail-location"><MapPin size={15} />{selectedListing.location}</div><p className="marketplace-detail-description">{selectedListing.description}</p><div className="marketplace-detail-facts"><h2>Listing details</h2><ul>{selectedListing.detail.split(' · ').filter(Boolean).map((line) => <li key={line}>{line}</li>)}</ul></div><div className="marketplace-detail-actions">{currentUserId === selectedListing.seller.id ? <span className="product-detail-secondary-button">Your listing</span> : <button type="button" className="app-primary-button" disabled={messagingSeller} onClick={() => contactSeller(selectedListing)}><MessageCircle size={15} /> {messagingSeller ? 'Opening chat…' : 'Message provider'}</button>}</div><div className="marketplace-detail-provider"><span className="marketplace-provider-avatar">{selectedListing.seller.name.slice(0, 1)}</span><div><span>LISTED BY</span><strong>{selectedListing.seller.name}</strong><small>@{selectedListing.seller.username}</small></div></div></div>
        </section>}
        {!loadingDetail && !selectedListing && !error && <section className="product-detail-not-found"><h1>This listing is not available.</h1><p>It may have been removed or is no longer published.</p><Link to="/app/marketplace" className="app-primary-button">Browse marketplace</Link></section>}
        <section className="marketplace-detail-safety"><MessageCircle size={17} /><div><strong>Confirm details directly</strong><p>Contact the provider to verify price, availability, and terms. Payments and bookings are arranged outside iConnect.</p></div></section>
      </div>
    )
  }

  return (
    <div className="app-content-width local-marketplace">
      <AppPageHeader eyebrow="LOCAL DISCOVERY · MEMBER LISTINGS" title="Find your next move." description="Browse homes, local services, and farm goods listed by iConnect members.">
        <button type="button" className="app-primary-button" onClick={() => { setForm((current) => ({ ...current, category: activeCategory })); setFormOpen((open) => !open) }}><Plus size={16} /> {formOpen ? 'Close form' : 'Create a listing'}</button>
      </AppPageHeader>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {formOpen && <form className="ibuy-listing-form" onSubmit={submitListing}>
        <h2>Create a local listing</h2>
        <div className="ibuy-listing-fields">
          <label>Category<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Title<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength={120} required /></label>
          <label>Price or quote<input value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} maxLength={80} required /></label>
          <label>Location<input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} maxLength={120} required /></label>
          <label>Short details<input value={form.detail} onChange={(event) => setForm((current) => ({ ...current, detail: event.target.value }))} maxLength={280} required /></label>
        </div>
        <label>Description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={2000} rows={4} required /></label>
        <label>Image URL (optional)<input type="url" value={form.imageUrl} onChange={(event) => setForm((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="https://…" /></label>
        <button type="submit" className="app-primary-button" disabled={publishing}>{publishing ? 'Publishing…' : 'Publish listing'}</button>
      </form>}
      <div className="marketplace-category-grid" aria-label="Marketplace categories">{categories.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`marketplace-category-card ${activeCategory === id ? 'marketplace-category-active' : ''}`} onClick={() => setActiveCategory(id)}><span className="marketplace-category-icon"><Icon size={18} /></span><span className="marketplace-category-copy"><strong>{label}</strong><small>Explore member listings</small></span></button>)}</div>
      <section id="marketplace-browse" className="marketplace-browse">
        <div className="marketplace-section-heading"><div><span className="app-page-eyebrow">DISCOVER ON iCONNECT</span><h2>{activeCategory}</h2></div><span className="marketplace-preview-tag"><Store size={13} /> MEMBER LISTINGS</span></div>
        <div className="marketplace-search-row"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${activeCategory.toLowerCase()}`} aria-label={`Search ${activeCategory.toLowerCase()}`} /></label><label><MapPin size={16} /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Filter by city or area" aria-label="Filter by location" /></label><button type="button" className="marketplace-location-button" onClick={() => setLocation('Lagos')}><MapPin size={14} /> Lagos</button></div>
        <div className="marketplace-results-heading"><div><h3>{activeCategory === 'Homes' ? 'Places to call home' : activeCategory === 'Services' ? 'People who can help' : 'Fresh from the farm'}</h3><p>{listings.length} {listings.length === 1 ? 'listing' : 'listings'}</p></div><button type="button" onClick={() => { setQuery(''); setLocation('') }}>Clear filters</button></div>
        {searchHint && <p className="connect-empty-state">{searchHint}</p>}
        {loading && <p className="inbox-empty-state">Loading listings…</p>}
        {!loading && error && <section className="feed-empty-state"><h2>Listings couldn’t be loaded.</h2><p>{error}</p><button type="button" className="app-primary-button" onClick={() => setRetry((current) => current + 1)}>Try again</button></section>}
        {!loading && !error && !searchHint && listings.length === 0 && <div className="marketplace-empty"><Search size={22} /><strong>No member listings yet.</strong><span>Try another search or create the first listing.</span><button type="button" onClick={() => setFormOpen(true)}>Create a listing</button></div>}
        {!loading && !error && listings.length > 0 && <div className="marketplace-listing-grid">{listings.map((item) => <article className="marketplace-listing-card" key={item.id}>
          <div className="marketplace-listing-image"><Link to={`/app/marketplace/${item.id}`} className="marketplace-listing-image-link" aria-label={`View details for ${item.title}`}>{item.imageUrl ? <img src={item.imageUrl} alt={item.title} loading="lazy" /> : <div className="ibuy-image-placeholder"><Store size={24} /></div>}<span>{item.category}</span></Link></div>
          <div className="marketplace-listing-content"><div className="marketplace-listing-title-row"><div><span>{item.category}</span><Link to={`/app/marketplace/${item.id}`} className="marketplace-listing-title-link">{item.title}</Link></div><strong>{item.price}</strong></div><p className="marketplace-listing-location"><MapPin size={13} />{item.location}</p><p className="marketplace-listing-detail">{item.detail}</p><div className="marketplace-listing-footer"><span><span className="marketplace-provider-avatar">{item.seller.name.slice(0, 1)}</span>{item.seller.name}</span><Link to={`/app/marketplace/${item.id}`} className="marketplace-view-details">View details <ArrowRight size={13} /></Link></div></div>
        </article>)}</div>}
        <p className="marketplace-disclaimer"><MessageCircle size={14} />Contact providers to verify availability and terms. Payments and bookings are handled outside iConnect.</p>
      </section>
    </div>
  )
}
