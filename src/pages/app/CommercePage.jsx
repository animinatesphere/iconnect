import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CarFront, Check, Clock3, MapPin, Minus, Plane, Plus, Search, ShoppingBag, ShoppingCart, ShieldCheck, Store, TicketCheck, Trash2 } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { getDemoAdminSettings, readDemoAdminState, writeDemoAdminState } from '../../utils/demoAdmin.js'
import { demoProducts } from '../../data/demoCommerce.js'
import { emptyDemoServicesState, readDemoServicesState, writeDemoServicesState } from '../../utils/demoServices.js'

const travelOptions = [
  { id: 'flight-lagos-abuja', category: 'Flight', title: 'Lagos → Abuja', detail: 'Direct · 1h 15m · Sample airline', price: 128000, icon: Plane },
  { id: 'taxi-lagos', category: 'Taxi', title: 'City ride · Lagos', detail: 'Standard · 12 min pickup · Sample driver', price: 6400, icon: CarFront },
  { id: 'car-compact', category: 'Car', title: 'Compact city car', detail: 'Daily rental · Sample listing', price: 45000, icon: CarFront },
  { id: 'car-sale', category: 'Car', title: 'City hatchback · 2022', detail: 'For-sale listing · Sample dealer · Not inspected', price: 8750000, icon: CarFront },
  { id: 'flight-abuja-lagos', category: 'Flight', title: 'Abuja → Lagos', detail: 'Direct · 1h 20m · Sample airline', price: 134000, icon: Plane },
]

function naira(value) {
  return `₦${new Intl.NumberFormat('en-NG').format(value)}`
}

export default function CommercePage() {
  const { pathname } = useLocation()
  const { productId } = useParams()
  const navigate = useNavigate()
  const isShop = pathname.startsWith('/app/ibuy')
  const [state, setState] = useState(emptyDemoServicesState)
  const [adminState, setAdminState] = useState({ productCatalog: [], productOverrides: {}, orderStatuses: {} })
  const [settings, setSettings] = useState({ marketplaceEnabled: true, bookingsEnabled: true })
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [bookingCategory, setBookingCategory] = useState('All')
  const [destination, setDestination] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      setState(readDemoServicesState())
      setAdminState(readDemoAdminState())
      setSettings(getDemoAdminSettings())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load browser-local demo activity.')
    } finally {
      setLoaded(true)
    }
  }, [])

  const allProducts = [...demoProducts.map((product) => ({ ...product, ...adminState.productOverrides[product.id] })), ...adminState.productCatalog]
  const visibleProducts = allProducts.filter((product) => product.published !== false)
  const selectedProduct = productId ? allProducts.find((product) => product.id === productId) : null
  const filteredProducts = useMemo(() => visibleProducts.filter((product) => (category === 'All' || category === product.category) && `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(search.trim().toLowerCase())), [category, search, adminState.productCatalog, adminState.productOverrides])
  const filteredBookings = travelOptions.filter((option) => (bookingCategory === 'All' || option.category === bookingCategory) && `${option.title} ${option.detail} ${option.category}`.toLowerCase().includes(destination.trim().toLowerCase()))
  const cartTotal = state.cart.reduce((total, item) => total + (allProducts.find((product) => product.id === item.productId)?.price ?? 0) * item.quantity, 0)

  function saveState(nextState, message) {
    try {
      writeDemoServicesState(nextState)
      setState(nextState)
      setNotice(message)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this browser demo action.')
    }
  }

  function changeCart(productId, delta) {
    const product = allProducts.find((entry) => entry.id === productId)
    if (!product) {
      setError('That listing is no longer available in the local demo catalog.')
      return
    }
    const currentQuantity = state.cart.find((item) => item.productId === productId)?.quantity ?? 0
    const nextQuantity = currentQuantity + delta
    if (delta > 0 && (product.published === false || product.archived)) {
      setError(`${product.name} is not available in the demo store.`)
      return
    }
    if (nextQuantity > product.stock) {
      setError(`Only ${product.stock} demo units of ${product.name} are available.`)
      return
    }
    const cart = nextQuantity <= 0
      ? state.cart.filter((item) => item.productId !== productId)
      : state.cart.some((item) => item.productId === productId)
        ? state.cart.map((item) => item.productId === productId ? { ...item, quantity: nextQuantity } : item)
        : [...state.cart, { productId, quantity: nextQuantity }]
    saveState({ ...state, cart }, nextQuantity > 0 ? 'Cart updated in this browser.' : 'Item removed from your local demo cart.')
  }

  function checkout(event) {
    event.preventDefault()
    if (!settings.marketplaceEnabled) {
      setError('iBuy is disabled by the local admin demo setting.')
      return
    }
    if (!state.cart.length) {
      setError('Add an item to your local demo cart first.')
      return
    }
    const products = state.cart.map((item) => {
      const product = allProducts.find((entry) => entry.id === item.productId)
      return product && product.published !== false && !product.archived && Number.isInteger(item.quantity) && item.quantity > 0 && product.stock >= item.quantity
        ? { item, product }
        : null
    })
    if (products.some((entry) => !entry)) {
      setError('One or more cart items are unavailable or exceed demo inventory. Update your cart before checkout.')
      return
    }

    let currentAdminState
    let nextAdminState
    try {
      currentAdminState = readDemoAdminState()
      nextAdminState = {
        ...currentAdminState,
        productOverrides: { ...currentAdminState.productOverrides },
        productCatalog: currentAdminState.productCatalog.map((product) => ({ ...product })),
      }
      for (const { item, product } of products) {
        const stock = product.stock - item.quantity
        if (demoProducts.some((sample) => sample.id === product.id)) {
          nextAdminState.productOverrides[product.id] = {
            ...nextAdminState.productOverrides[product.id],
            stock,
          }
        } else {
          nextAdminState.productCatalog = nextAdminState.productCatalog.map((entry) => entry.id === product.id ? { ...entry, stock } : entry)
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load current demo inventory.')
      return
    }
    const order = {
      id: `order-${Date.now()}`,
      items: products.map(({ item, product }) => ({ productId: item.productId, name: product.name, price: product.price, quantity: item.quantity })),
      total: cartTotal,
      currency: 'NGN demo credits',
      status: 'Demo order',
      createdAt: new Date().toISOString(),
    }
    const nextState = { ...state, orders: [order, ...state.orders], cart: [] }
    try {
      writeDemoAdminState(nextAdminState)
      try {
        writeDemoServicesState(nextState)
      } catch (saveError) {
        writeDemoAdminState(currentAdminState)
        throw saveError
      }
      setAdminState(nextAdminState)
      setState(nextState)
      setNotice(`Demo order saved for ${naira(order.total)}. Inventory was adjusted locally; no payment or delivery occurred.`)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this browser demo order.')
    }
  }

  function placeBooking(option) {
    if (!settings.bookingsEnabled) {
      setError('iBook is disabled by the local admin demo setting.')
      return
    }
    const booking = {
      id: `booking-${Date.now()}`,
      serviceId: option.id,
      category: option.category,
      title: option.title,
      price: option.price,
      status: 'Preview request',
      createdAt: new Date().toISOString(),
    }
    saveState({ ...state, bookings: [booking, ...state.bookings] }, `${option.category} request saved as a local preview. It is not a real booking.`)
  }

  if (!loaded) return <div className="app-content-width">Loading product demo…</div>

  if (isShop && productId) {
    const unavailable = !selectedProduct || selectedProduct.archived || selectedProduct.published === false
    const quantity = selectedProduct ? state.cart.find((item) => item.productId === selectedProduct.id)?.quantity ?? 0 : 0
    return (
      <div className="app-content-width commerce-page product-detail-page">
        <PageMeta title={selectedProduct ? `${selectedProduct.name} | iBuy` : 'Product not found | iBuy'} description={selectedProduct?.description ?? 'This listing is not available in the iBuy demo marketplace.'} />
        <Link to="/app/ibuy" className="app-back-link"><ArrowLeft size={15} /> Back to iBuy marketplace</Link>
        <div className="commerce-safety-banner"><ShieldCheck size={17} /><span><strong>Concept demo only.</strong> Product, seller, price, inventory, and delivery information is illustrative. No purchase or delivery is made.</span></div>
        {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
        {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
        {selectedProduct ? <section className="product-detail-layout">
          <div className="product-detail-gallery">
            <div className="product-detail-main-image"><img src={`https://images.unsplash.com/${selectedProduct.image}?auto=format&fit=crop&w=1200&h=1000&q=85`} alt={selectedProduct.name} /></div>
            <div className="product-detail-gallery-caption"><span><Store size={14} /> iBuy sample store</span><span>Sample listing · {selectedProduct.category}</span></div>
          </div>
          <div className="product-detail-information">
            <span className="app-page-eyebrow">{selectedProduct.category} · IBUY MARKETPLACE</span>
            <h1>{selectedProduct.name}</h1>
            <div className="product-detail-rating"><span aria-label={`${selectedProduct.rating ?? 'New'} rating`}>★ {selectedProduct.rating ?? 'New'}</span><i /> Sample listing</div>
            <p className="product-detail-description">{selectedProduct.description}</p>
            <div className="product-detail-price">{naira(selectedProduct.price)}<small>Demo price · NGN</small></div>
            <div className={`product-detail-stock ${unavailable || selectedProduct.stock <= 0 ? 'is-unavailable' : ''}`}><span />{unavailable ? 'This listing is currently unavailable' : selectedProduct.stock > 0 ? `${selectedProduct.stock} demo units available` : 'Out of stock'}</div>
            <div className="product-detail-buy-row">
              {quantity > 0 ? <div className="shop-quantity-control"><button type="button" aria-label={`Remove one ${selectedProduct.name}`} onClick={() => changeCart(selectedProduct.id, -1)}><Minus size={14} /></button><span>{quantity} in cart</span><button type="button" aria-label={`Add another ${selectedProduct.name}`} disabled={quantity >= selectedProduct.stock || unavailable} onClick={() => changeCart(selectedProduct.id, 1)}><Plus size={14} /></button></div> : <button type="button" className="app-primary-button" disabled={unavailable || selectedProduct.stock <= 0} onClick={() => changeCart(selectedProduct.id, 1)}><ShoppingBag size={16} /> Add to demo cart</button>}
              <button type="button" className="product-detail-secondary-button" onClick={() => navigate('/app/ibuy')}><ArrowLeft size={14} /> Continue shopping</button>
            </div>
            <div className="product-detail-facts"><h2>Product details</h2><dl><div><dt>Category</dt><dd>{selectedProduct.category}</dd></div><div><dt>Listing ID</dt><dd>{selectedProduct.id}</dd></div><div><dt>Seller</dt><dd>iBuy sample store</dd></div><div><dt>Delivery</dt><dd>Not available in this prototype</dd></div></dl></div>
            <div className="product-detail-disclaimer"><ShieldCheck size={15} /><span>This product is shown for demonstration. No seller, payment provider, shipment, or customer support is connected.</span></div>
          </div>
        </section> : <section className="product-detail-not-found"><span className="app-page-eyebrow">IBUY MARKETPLACE</span><h1>We couldn't find this product.</h1><p>It may have been removed or is no longer listed in the demo store.</p><Link to="/app/ibuy" className="app-primary-button">Return to iBuy</Link></section>}
      </div>
    )
  }

  return (
    <div className="app-content-width commerce-page">
      <AppPageHeader eyebrow={isShop ? 'IBUY · MARKETPLACE PREVIEW' : 'IBOOK · TRAVEL & MOBILITY PREVIEW'} title={isShop ? 'iBuy marketplace' : 'iBook journeys'} description={isShop ? 'Discover sample products and try a local demo cart.' : 'Explore sample flights, city rides, and cars in one place.'} />
      <div className="commerce-safety-banner"><ShieldCheck size={17} /><span><strong>Concept demo only.</strong> Sellers, prices, transport providers, payments, and bookings are illustrative. No purchase, reservation, pickup, or delivery is made.</span></div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {!(isShop ? settings.marketplaceEnabled : settings.bookingsEnabled) && <p className="money-disabled-note">{isShop ? 'iBuy is disabled by the local admin demo setting.' : 'iBook is disabled by the local admin demo setting.'}</p>}

      {isShop && settings.marketplaceEnabled && <div className="commerce-layout">
        <section className="shop-catalog-panel"><div className="shop-toolbar"><div className="shop-categories" role="tablist" aria-label="Product categories">{['All', 'Style', 'Tech', 'Home', 'Other'].map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={category === item ? 'shop-category-active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="shop-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /></label></div><div className="shop-result-count"><span>{filteredProducts.length} available listings</span><span><Store size={13} /> iBuy demo market</span></div><div className="shop-product-grid">{filteredProducts.map((product) => { const quantity = state.cart.find((item) => item.productId === product.id)?.quantity ?? 0; return <article className="shop-product-card" key={product.id}><Link to={`/app/ibuy/${encodeURIComponent(product.id)}`} className="shop-product-image" aria-label={`View details for ${product.name}`}><img src={`https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=700&h=520&q=80`} alt={product.name} loading="lazy" /><span>{product.category}</span></Link><div className="shop-product-info"><Link to={`/app/ibuy/${encodeURIComponent(product.id)}`} className="shop-product-name">{product.name}</Link><small className="shop-rating">★ {product.rating ?? 'New'} · Sample seller</small><p>{product.description}</p><div className="shop-product-purchase"><b>{naira(product.price)}</b>{product.stock <= 0 ? <span className="shop-out-of-stock">Out of stock</span> : quantity ? <div className="shop-quantity-control"><button type="button" aria-label={`Remove one ${product.name}`} onClick={() => changeCart(product.id, -1)}><Minus size={13} /></button><span>{quantity}</span><button type="button" aria-label={`Add another ${product.name}`} disabled={quantity >= product.stock} onClick={() => changeCart(product.id, 1)}><Plus size={13} /></button></div> : <button type="button" onClick={() => changeCart(product.id, 1)}><Plus size={14} /> Add</button>}</div></div></article>})}</div>{!filteredProducts.length && <div className="commerce-empty-state">No products match your search or filters.</div>}</section>
        <aside className="shop-cart-panel"><div className="commerce-panel-heading"><span><ShoppingCart size={16} /></span><div><h2>Your demo cart</h2><p>{state.cart.reduce((sum, item) => sum + item.quantity, 0)} sample items</p></div></div>{state.cart.length ? <><div className="shop-cart-items">{state.cart.map((item) => { const product = allProducts.find((entry) => entry.id === item.productId); if (!product) return null; return <article key={item.productId}><img src={`https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=120&h=120&q=70`} alt="" /><span><strong>{product.name}</strong><small>{item.quantity} × {naira(product.price)}</small></span><button type="button" aria-label={`Remove ${product.name} from cart`} onClick={() => changeCart(product.id, -item.quantity)}><Trash2 size={14} /></button></article>})}</div><div className="shop-cart-total"><span>Demo total</span><strong>{naira(cartTotal)}</strong></div><form onSubmit={checkout}><button className="app-primary-button" type="submit"><ShoppingBag size={15} /> Place demo order</button><small>Checkout is simulated. No payment or shipping details are collected.</small></form></> : <div className="commerce-empty-state"><ShoppingCart size={20} /><p>Your cart is empty.</p><small>Add a sample item to preview checkout.</small></div>}{state.orders.length > 0 && <div className="shop-orders"><h3>Recent demo orders</h3>{state.orders.slice(0, 3).map((order) => <div key={order.id}><span>{new Date(order.createdAt).toLocaleDateString()} · {adminState.orderStatuses[order.id] ?? order.status}</span><strong>{naira(order.total)}</strong></div>)}</div>}</aside>
      </div>}

      {!isShop && settings.bookingsEnabled && <div className="ibook-layout"><section className="ibook-search-panel"><div className="ibook-hero"><span className="app-page-eyebrow">GO SOMEWHERE GOOD</span><h2>One place to plan<br />your next move.</h2><p>Flight, taxi, and car-booking previews for the iBook concept.</p><div><span><MapPin size={14} /> Sample destinations · Nigeria</span><span><TicketCheck size={14} /> Not a real reservation</span></div></div><div className="ibook-toolbar"><div className="ibook-categories" role="tablist" aria-label="Travel categories">{['All', 'Flight', 'Taxi', 'Car'].map((item) => <button key={item} type="button" role="tab" aria-selected={bookingCategory === item} className={bookingCategory === item ? 'ibook-category-active' : ''} onClick={() => setBookingCategory(item)}>{item === 'Flight' ? <Plane size={14} /> : item === 'Taxi' || item === 'Car' ? <CarFront size={14} /> : null}{item}</button>)}</div><label className="shop-search"><MapPin size={15} /><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Search route or service" aria-label="Search routes and travel services" /></label></div><div className="ibook-options">{filteredBookings.map((option) => { const Icon = option.icon; return <article key={option.id}><span className="ibook-option-icon"><Icon size={18} /></span><div><span className="app-page-eyebrow">{option.category} · SAMPLE</span><h3>{option.title}</h3><p>{option.detail}</p></div><strong>{naira(option.price)}<small>demo estimate</small></strong><button type="button" onClick={() => placeBooking(option)}>Preview <ArrowRight size={14} /></button></article>})}</div>{!filteredBookings.length && <div className="commerce-empty-state">No sample services match this search.</div>}</section><aside className="ibook-bookings-panel"><div className="commerce-panel-heading"><span><Clock3 size={16} /></span><div><h2>Your demo requests</h2><p>Saved only in this browser</p></div></div>{state.bookings.length ? <div className="ibook-booking-list">{state.bookings.map((booking) => <article key={booking.id}><span className="booking-icon">{booking.category === 'Flight' ? <Plane size={15} /> : <CarFront size={15} />}</span><div><strong>{booking.title}</strong><small>{booking.status} · {new Date(booking.createdAt).toLocaleDateString()}</small></div><b>{naira(booking.price)}</b></article>)}</div> : <div className="commerce-empty-state"><TicketCheck size={20} /><p>No booking previews yet.</p><small>Choose a sample service to see the request flow.</small></div>}<div className="ibook-disclaimer">No seat, driver, vehicle, or payment is reserved. Real services need licensed providers and backend booking integration.</div></aside></div>}
    </div>
  )
}
