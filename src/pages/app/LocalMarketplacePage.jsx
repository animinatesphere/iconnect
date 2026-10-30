import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Bookmark, Building2, Check, ChevronRight, CircleHelp, Clock3, Link2, MapPin, MessageCircle, Plus, Search, ShieldCheck, Sprout, Store, Users, Wrench, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import PageMeta from '../../components/PageMeta.jsx'

const storageKey = 'iconnect.demo.local-marketplace'

const sampleListings = [
  { id: 'home-1', category: 'Homes', title: 'Bright two-bedroom apartment', price: '₦2,400,000 / year', location: 'Lekki Phase 1, Lagos', detail: '2 beds · 2 baths · Available now', description: 'A bright, well-kept apartment with an open living area and a practical layout for everyday living. Contact the listing provider to confirm the address, inspection availability, and all move-in costs.', publisher: 'Ada Homes', image: 'photo-1600607687939-ce8a6c25118c', badge: 'Sample listing' },
  { id: 'home-2', category: 'Homes', title: 'Quiet studio near the city', price: '₦950,000 / year', location: 'Gwarinpa, Abuja', detail: 'Studio · 1 bath · 12-month lease', description: 'A compact studio option in a quieter neighborhood, suitable for someone looking for a simple place to settle. Confirm utilities, lease terms, and the exact location with the provider before arranging a visit.', publisher: 'Northside Living', image: 'photo-1600210492486-724fe5c67fb0', badge: 'New listing' },
  { id: 'service-1', category: 'Services', title: 'Brand identity & design', price: 'From ₦85,000', location: 'Lagos · Remote', detail: 'Graphic design · 5 years experience', description: 'Independent design support for small businesses and creators, from early visual direction to ready-to-use brand assets. Scope, delivery dates, and final pricing should be agreed directly with the provider.', publisher: 'Moyo Studio', image: 'photo-1523726491678-bf852e717f6a', badge: 'Available this week' },
  { id: 'service-2', category: 'Services', title: 'Home repairs & plumbing', price: 'Request a quote', location: 'Yaba, Lagos', detail: 'Repairs · Installations · Call-outs', description: 'Local repair and plumbing help for household installations and call-outs. Share the work needed and request a quote before booking; confirm materials, timing, and any call-out fee in advance.', publisher: 'Tunde Fixes', image: 'photo-1581578731548-c64695cc6952', badge: 'Local provider' },
  { id: 'farm-1', category: 'Farm', title: 'Fresh tomatoes · 50kg basket', price: '₦28,000 / basket', location: 'Jos, Plateau State', detail: 'Harvested this week · Pickup or delivery', description: 'A sample farm-produce listing for a 50kg basket of tomatoes. Availability and quality can vary by harvest; ask the farm to confirm the current price, quantity, delivery options, and harvest date.', publisher: 'Green Valley Farm', image: 'photo-1546094096-0df4bcaaa337', badge: 'Fresh harvest' },
  { id: 'farm-2', category: 'Farm', title: 'Organic eggs · crate of 30', price: '₦6,500 / crate', location: 'Abeokuta, Ogun State', detail: 'Farm fresh · Weekly availability', description: 'A sample listing for a crate of 30 farm eggs with weekly availability. Contact the farm to check the latest stock and collection or delivery arrangements before placing an order.', publisher: 'Iya Alata Farms', image: 'photo-1518569656558-1f25e69d93d7', badge: 'From the farm' },
]

const categories = [
  { id: 'Homes', label: 'Find a home', description: 'Explore rental homes and contact the listing provider.', icon: Building2, image: 'photo-1600607687939-ce8a6c25118c', fields: 'Rentals · Rooms · Apartments' },
  { id: 'Services', label: 'Find a service', description: 'Discover skilled people and independent businesses.', icon: Wrench, image: 'photo-1523726491678-bf852e717f6a', fields: 'Skills · Local businesses · Quotes' },
  { id: 'Farm', label: 'Shop from farms', description: 'Browse produce, farm goods, and agricultural services.', icon: Sprout, image: 'photo-1546094096-0df4bcaaa337', fields: 'Produce · Equipment · Farm services' },
]

const socialPlatforms = [
  { name: 'WhatsApp', category: 'Messaging', note: 'Business messaging and approved sharing tools.' },
  { name: 'TikTok', category: 'Video', note: 'Creator sign-in and publishing access depend on approval.' },
  { name: 'Facebook', category: 'Social', note: 'Account sign-in and selected Page tools may be available.' },
  { name: 'YouTube', category: 'Video', note: 'Channel authorization and eligible video features.' },
  { name: 'Instagram', category: 'Social', note: 'Professional-account access and approved publishing.' },
  { name: 'Snapchat', category: 'Messaging', note: 'Partner access is limited and requires platform approval.' },
  { name: 'Twitch', category: 'Live', note: 'Sign-in and selected channel or live-stream tools.' },
  { name: 'LinkedIn', category: 'Professional', note: 'Sign-in and approved professional profile access.' },
  { name: 'Telegram', category: 'Messaging', note: 'Bot and public-channel integrations; personal access is limited.' },
  { name: 'X / Twitter', category: 'Social', note: 'Access and posting depend on current API permissions.' },
  { name: 'Tinder', category: 'Dating', note: 'Dating profile integrations are not assumed or available by default.' },
]

const tabs = ['Homes', 'Services', 'Farm', 'Social accounts']

function readMarketplaceState() {
  const serialized = window.localStorage.getItem(storageKey)
  if (!serialized) return { listings: [], savedIds: [] }

  const state = JSON.parse(serialized)
  if (
    !state ||
    !Array.isArray(state.listings) ||
    !state.listings.every((listing) =>
      listing &&
      typeof listing === 'object' &&
      typeof listing.id === 'string' &&
      categories.some((category) => category.id === listing.category) &&
      ['title', 'price', 'location', 'detail', 'publisher', 'image', 'badge'].every((key) => typeof listing[key] === 'string')
    ) ||
    !Array.isArray(state.savedIds) ||
    !state.savedIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('Saved marketplace demo data is invalid. Clear this browser’s iConnect marketplace demo data to continue.')
  }
  return state
}

export default function LocalMarketplacePage() {
  const { listingId } = useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('Homes')
  const [marketState, setMarketState] = useState({ listings: [], savedIds: [] })
  const [search, setSearch] = useState('')
  const [location, setLocation] = useState('')
  const [listingOpen, setListingOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({ category: 'Homes', title: '', price: '', location: '', detail: '' })

  useEffect(() => {
    try {
      setMarketState(readMarketplaceState())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load marketplace demo data.')
    } finally {
      setLoaded(true)
    }
  }, [])

  const listings = useMemo(() => [...marketState.listings, ...sampleListings], [marketState.listings])
  const selectedListing = listingId ? listings.find((listing) => listing.id === listingId) : null
  const visibleListings = useMemo(() => listings.filter((listing) => {
    if (listing.category !== activeTab) return false
    const text = `${listing.title} ${listing.location} ${listing.detail} ${listing.publisher}`.toLowerCase()
    return text.includes(search.trim().toLowerCase()) && listing.location.toLowerCase().includes(location.trim().toLowerCase())
  }), [activeTab, listings, location, search])

  function saveState(nextState, message) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextState))
      setMarketState(nextState)
      setNotice(message)
      setError('')
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this marketplace demo action.')
      return false
    }
  }

  function toggleSaved(id) {
    const savedIds = marketState.savedIds.includes(id)
      ? marketState.savedIds.filter((savedId) => savedId !== id)
      : [...marketState.savedIds, id]
    saveState({ ...marketState, savedIds }, savedIds.includes(id) ? 'Listing saved to your browser.' : 'Listing removed from your saved list.')
  }

  function submitListing(event) {
    event.preventDefault()
    const newListing = {
      id: `market-${Date.now()}`,
      ...form,
      publisher: 'Your iConnect profile',
      badge: 'Your listing',
      image: categories.find((category) => category.id === form.category)?.image ?? categories[0].image,
      description: form.detail,
    }
    if (!saveState({ ...marketState, listings: [newListing, ...marketState.listings] }, 'Your listing is now visible in this browser demo.')) return
    setActiveTab(form.category)
    setSearch('')
    setLocation('')
    setForm({ category: form.category, title: '', price: '', location: '', detail: '' })
    setListingOpen(false)
  }

  function selectTab(tab) {
    setActiveTab(tab)
    setNotice('')
    setError('')
    if (tab !== 'Social accounts') setSelectedPlatform('')
  }

  function previewEnquiry(listing) {
    setNotice(`Enquiry preview for “${listing.title}” saved locally. No provider was contacted.`)
  }

  if (listingId) {
    if (!loaded) {
      return <div className="app-content-width product-detail-page"><p className="marketplace-detail-loading" role="status">Loading listing details…</p></div>
    }

    if (!selectedListing) {
      return (
        <div className="app-content-width product-detail-page marketplace-detail-page">
          <PageMeta title="Listing not found | iConnect" description="This marketplace listing is not available in the local demo." />
          <Link to="/app/marketplace" className="app-back-link"><ArrowLeft size={14} /> Back to marketplace</Link>
          <section className="product-detail-not-found"><span className="app-page-eyebrow">MARKETPLACE LISTING</span><h1>This listing is not available.</h1><p>It may have been removed or is not part of this browser’s demo data.</p><Link to="/app/marketplace" className="app-primary-button">Browse marketplace</Link></section>
        </div>
      )
    }

    const saved = marketState.savedIds.includes(selectedListing.id)
    const detailLines = selectedListing.detail.split(' · ').filter(Boolean)

    return (
      <div className="app-content-width product-detail-page marketplace-detail-page">
        <PageMeta title={`${selectedListing.title} | iConnect marketplace`} description={selectedListing.description ?? selectedListing.detail} />
        <Link to="/app/marketplace" className="app-back-link"><ArrowLeft size={14} /> Back to marketplace</Link>
        <section className="marketplace-detail-layout">
          <div className="marketplace-detail-gallery">
            <div className="marketplace-detail-main-image"><img src={`https://images.unsplash.com/${selectedListing.image}?auto=format&fit=crop&w=1200&h=900&q=90`} alt={selectedListing.title} /><span>{selectedListing.badge}</span></div>
            <div className="marketplace-detail-gallery-caption"><span><MapPin size={14} />{selectedListing.location}</span><span>{selectedListing.category} listing · Preview</span></div>
          </div>
          <div className="marketplace-detail-information">
            <span className="app-page-eyebrow">{selectedListing.category.toUpperCase()} · LISTING DETAILS</span>
            <h1>{selectedListing.title}</h1>
            <p className="marketplace-detail-price">{selectedListing.price}</p>
            <div className="marketplace-detail-location"><MapPin size={15} />{selectedListing.location}</div>
            <p className="marketplace-detail-description">{selectedListing.description ?? selectedListing.detail}</p>
            <div className="marketplace-detail-facts"><h2>Listing details</h2><ul>{detailLines.map((line) => <li key={line}><Check size={14} />{line}</li>)}</ul></div>
            <div className="marketplace-detail-actions">
              <button type="button" className="app-primary-button" onClick={() => previewEnquiry(selectedListing)}><MessageCircle size={15} /> Preview enquiry</button>
              <button type="button" className="marketplace-detail-save" aria-pressed={saved} onClick={() => toggleSaved(selectedListing.id)}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save listing'}</button>
            </div>
            {notice && <p className="marketplace-notice" role="status"><Check size={15} />{notice}</p>}
            {error && <p className="marketplace-error" role="alert">{error}</p>}
            <div className="marketplace-detail-provider"><span className="marketplace-provider-avatar">{selectedListing.publisher.slice(0, 1)}</span><div><span>LISTED BY</span><strong>{selectedListing.publisher}</strong><small><Clock3 size={12} /> Sample profile · Details not verified</small></div></div>
          </div>
        </section>
        <section className="marketplace-detail-safety"><ShieldCheck size={17} /><div><strong>Before you decide</strong><p>These are illustrative demo listings. Verify the provider, property, goods, pricing, and terms independently. Never pay or share sensitive information based only on an unverified listing.</p></div></section>
        <section className="marketplace-detail-more"><div><span className="app-page-eyebrow">KEEP EXPLORING</span><h2>Find more in your community.</h2></div><button type="button" className="app-secondary-button" onClick={() => navigate('/app/marketplace')}>Browse marketplace <ArrowRight size={14} /></button></section>
      </div>
    )
  }

  return (
    <div className="app-content-width local-marketplace">
      <AppPageHeader eyebrow="LOCAL DISCOVERY · MARKETPLACE PREVIEW" title="Find your next move." description="Rent a place, find a skilled local, or buy directly from a farm. One iConnect profile, more ways to grow.">
        <button type="button" className="app-primary-button" onClick={() => { setForm({ ...form, category: activeTab === 'Social accounts' ? 'Homes' : activeTab }); setListingOpen(true) }}><Plus size={16} /> Create a listing</button>
      </AppPageHeader>

      <section className="marketplace-hero">
        <div className="marketplace-hero-copy">
          <span className="marketplace-hero-kicker"><span /> YOUR NEIGHBORHOOD, OPENED UP</span>
          <h2>Good things start <em>close to home.</em></h2>
          <p>Discover trusted places, independent talent, and fresh produce from people in your community.</p>
          <button type="button" onClick={() => document.getElementById('marketplace-browse')?.scrollIntoView({ behavior: 'smooth' })}>Explore the marketplace <ArrowRight size={15} /></button>
        </div>
        <div className="marketplace-hero-photo" role="img" aria-label="Warm, bright home interior" />
        <div className="marketplace-hero-note"><MapPin size={14} /><span><strong>Made for local discovery</strong><small>Homes · Services · Farm</small></span></div>
      </section>

      <div className="marketplace-category-grid" aria-label="Marketplace categories">
        {categories.map(({ id, label, description, icon: Icon, image, fields }) => (
          <button type="button" key={id} className={`marketplace-category-card ${activeTab === id ? 'marketplace-category-active' : ''}`} onClick={() => selectTab(id)}>
            <span className="marketplace-category-icon"><Icon size={18} /></span>
            <span className="marketplace-category-copy"><strong>{label}</strong><small>{description}</small><em>{fields} <ChevronRight size={12} /></em></span>
            <img src={`https://images.unsplash.com/${image}?auto=format&fit=crop&w=250&h=190&q=80`} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      <section id="marketplace-browse" className="marketplace-browse">
        <div className="marketplace-section-heading">
          <div><span className="app-page-eyebrow">DISCOVER ON iCONNECT</span><h2>Local marketplace</h2></div>
          <span className="marketplace-preview-tag"><Store size={13} /> DEMO LISTINGS</span>
        </div>
        <div className="marketplace-tabs" role="tablist" aria-label="Marketplace sections">
          {tabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'marketplace-tab-active' : ''} onClick={() => selectTab(tab)}>{tab === 'Social accounts' && <Link2 size={14} />}{tab}</button>)}
        </div>

        {notice && <p className="marketplace-notice" role="status"><Check size={15} />{notice}</p>}
        {error && <p className="marketplace-error" role="alert">{error}</p>}

        {activeTab === 'Social accounts' ? (
          <div className="connected-accounts">
            <div className="connected-accounts-intro"><div><span className="app-page-eyebrow">OPTIONAL · CONTROLLED BY YOU</span><h3>Bring your accounts together.</h3><p>Review possible integrations. Each platform sets its own permissions, approval process, and data limits.</p></div><div className="connected-accounts-lock"><ShieldCheck size={20} /><span>Permission-first<br />by design</span></div></div>
            <div className="social-platform-grid">{socialPlatforms.map((platform, index) => (
              <article className={`social-platform-card ${selectedPlatform === platform.name ? 'social-platform-selected' : ''}`} key={platform.name}>
                <span className={`social-platform-mark social-platform-mark-${index % 5}`}>{platform.name.slice(0, 1)}</span>
                <div className="social-platform-info"><strong>{platform.name}</strong><small>{platform.category}</small></div>
                <span className="social-platform-status">API review</span>
                <button type="button" onClick={() => setSelectedPlatform(selectedPlatform === platform.name ? '' : platform.name)} aria-expanded={selectedPlatform === platform.name}>{selectedPlatform === platform.name ? 'Close details' : 'Integration details'} <ChevronRight size={13} /></button>
                {selectedPlatform === platform.name && <div className="social-platform-detail"><p>{platform.note}</p><p>External sign-in is not connected in this preview. A production integration would use the provider’s approved authorization flow—never ask for your password.</p></div>}
              </article>
            ))}</div>
            <div className="social-integration-note"><CircleHelp size={17} /><p><strong>Connection preview only.</strong> iConnect is not currently connected to these services. There is no cross-posting, imported data, or external account access in this demo.</p></div>
          </div>
        ) : (
          <>
            <div className="marketplace-search-row">
              <label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${activeTab.toLowerCase()}, people, or details`} aria-label={`Search ${activeTab.toLowerCase()}`} /></label>
              <label><MapPin size={16} /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Filter by city or area" aria-label="Filter by location" /></label>
              <button type="button" className="marketplace-location-button" onClick={() => setLocation('Lagos')}><MapPin size={14} /> Lagos</button>
            </div>
            <div className="marketplace-results-heading"><div><h3>{activeTab === 'Homes' ? 'Places to call home' : activeTab === 'Services' ? 'People who can help' : 'Fresh from the farm'}</h3><p>{visibleListings.length} sample {visibleListings.length === 1 ? 'listing' : 'listings'} to explore</p></div><button type="button" onClick={() => { setSearch(''); setLocation('') }}>Clear filters</button></div>
            {visibleListings.length ? <div className="marketplace-listing-grid">{visibleListings.map((listing) => {
              const saved = marketState.savedIds.includes(listing.id)
              return <article className="marketplace-listing-card" key={listing.id}>
                <div className="marketplace-listing-image"><Link to={`/app/marketplace/${listing.id}`} className="marketplace-listing-image-link" aria-label={`View details for ${listing.title}`}><img src={`https://images.unsplash.com/${listing.image}?auto=format&fit=crop&w=760&h=520&q=85`} alt="" loading="lazy" /><span>{listing.badge}</span></Link><button type="button" className={saved ? 'marketplace-save marketplace-save-active' : 'marketplace-save'} aria-label={saved ? 'Remove saved listing' : 'Save listing'} aria-pressed={saved} onClick={() => toggleSaved(listing.id)}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /></button></div>
                <div className="marketplace-listing-content"><div className="marketplace-listing-title-row"><div><span>{listing.category}</span><Link to={`/app/marketplace/${listing.id}`} className="marketplace-listing-title-link">{listing.title}</Link></div><strong>{listing.price}</strong></div><p className="marketplace-listing-location"><MapPin size={13} />{listing.location}</p><p className="marketplace-listing-detail">{listing.detail}</p><div className="marketplace-listing-footer"><span><span className="marketplace-provider-avatar">{listing.publisher.slice(0, 1)}</span>{listing.publisher}</span><Link to={`/app/marketplace/${listing.id}`} className="marketplace-view-details">View details <ArrowRight size={13} /></Link></div></div>
              </article>
            })}</div> : <div className="marketplace-empty"><Search size={22} /><strong>No listings match those filters.</strong><span>Try a different search or clear the location filter.</span></div>}
            <p className="marketplace-disclaimer"><ShieldCheck size={14} />Listings are illustrative and not verified. Confirm property, service, and product details directly before making decisions.</p>
          </>
        )}
      </section>

      <section className="marketplace-provider-cta"><div className="marketplace-provider-icon"><Users size={20} /></div><div><span className="app-page-eyebrow">HAVE SOMETHING TO OFFER?</span><h2>Your work deserves to be found.</h2><p>Create a listing for your home, skills, business, or farm goods using your iConnect profile.</p></div><button type="button" onClick={() => { setForm({ ...form, category: activeTab === 'Social accounts' ? 'Services' : activeTab }); setListingOpen(true) }}>Start a listing <ArrowRight size={15} /></button></section>

      {listingOpen && <div className="marketplace-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setListingOpen(false) }}>
        <section className="marketplace-listing-modal" role="dialog" aria-modal="true" aria-labelledby="marketplace-modal-title">
          <div className="marketplace-modal-heading"><div><span className="app-page-eyebrow">CREATE A LISTING · DEMO</span><h2 id="marketplace-modal-title">Share what you offer.</h2></div><button type="button" aria-label="Close listing form" onClick={() => setListingOpen(false)}><X size={19} /></button></div>
          <p>Your iConnect profile will appear as the provider. This preview saves the listing only in this browser.</p>
          <form onSubmit={submitListing}>
            <label>What are you listing?<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Homes</option><option>Services</option><option>Farm</option></select></label>
            <label>Listing title<input required maxLength={70} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={form.category === 'Homes' ? 'e.g. Two-bedroom apartment' : form.category === 'Farm' ? 'e.g. Fresh cassava, 50kg bag' : 'e.g. Photography and editing'} /></label>
            <div className="marketplace-form-row"><label>Price or rate<input required maxLength={45} value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="e.g. ₦120,000 / month" /></label><label>City or area<input required maxLength={55} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="e.g. Ikeja, Lagos" /></label></div>
            <label>Details<input required maxLength={90} value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} placeholder="Key details people should know" /></label>
            <div className="marketplace-form-actions"><button type="button" className="app-secondary-button" onClick={() => setListingOpen(false)}>Cancel</button><button type="submit" className="app-primary-button"><Plus size={15} /> Publish demo listing</button></div>
          </form>
        </section>
      </div>}
    </div>
  )
}
