import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Image as ImageIcon, MessageCircle, Plus, Search, Store, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { apiRequest } from '../../utils/api.js'
import { uploadImage } from '../../utils/mediaApi.js'
import { createMarketplaceProduct, getMarketplaceProduct, getMarketplaceProducts } from '../../utils/marketplaceApi.js'
import { openConversation } from '../../utils/messageApi.js'

const categories = ['All', 'Style', 'Tech', 'Home', 'Other']
const emptyListing = { name: '', category: 'Home', price: '', stock: '1', description: '', imageUrl: '' }
const maxImages = 5

function naira(value) {
  return `₦${new Intl.NumberFormat('en-NG').format(value)}`
}

export default function IBuyPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [listing, setListing] = useState(emptyListing)
  const [images, setImages] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [activeImage, setActiveImage] = useState(0)
  const [listingOpen, setListingOpen] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadingProduct, setLoadingProduct] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [messagingSeller, setMessagingSeller] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [currentUser, setCurrentUser] = useState(null)

  useEffect(() => {
    const previews = images.map((file) => URL.createObjectURL(file))
    setImagePreviews(previews)
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [images])

  useEffect(() => {
    let active = true
    if (productId) {
      setLoadingProducts(false)
      return () => { active = false }
    }
    setLoadingProducts(true)
    getMarketplaceProducts({ query: search, category })
      .then((loadedProducts) => {
        if (active) {
          setProducts(loadedProducts)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load marketplace listings.')
      })
      .finally(() => {
        if (active) setLoadingProducts(false)
      })
    return () => { active = false }
  }, [category, productId, retry, search])

  useEffect(() => {
    if (!productId) {
      setSelectedProduct(null)
      return undefined
    }
    let active = true
    setLoadingProduct(true)
    getMarketplaceProduct(productId)
      .then((product) => {
        if (active) {
          setSelectedProduct(product)
          setActiveImage(0)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) {
          setSelectedProduct(null)
          setError(loadError instanceof Error ? loadError.message : 'Could not load this product.')
        }
      })
      .finally(() => {
        if (active) setLoadingProduct(false)
      })
    return () => { active = false }
  }, [productId])

  useEffect(() => {
    let active = true
    apiRequest('/api/auth/me')
      .then((payload) => {
        if (active) setCurrentUser(payload.user)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load your account.')
      })
    return () => { active = false }
  }, [])

  const matchingProducts = products
  const productImages = selectedProduct?.imageUrls?.length
    ? selectedProduct.imageUrls
    : selectedProduct?.imageUrl ? [selectedProduct.imageUrl] : []

  async function submitListing(event) {
    event.preventDefault()
    setPublishing(true)
    try {
      const imageUrls = []
      for (const image of images) imageUrls.push(await uploadImage(image))
      const product = await createMarketplaceProduct({ ...listing, imageUrls })
      setProducts((current) => [product, ...current.filter((item) => item.id !== product.id)])
      setListing(emptyListing)
      setImages([])
      setListingOpen(false)
      setNotice('Your listing is live in iBuy.')
      setError('')
      navigate(`/app/ibuy/${product.id}`)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Your product listing could not be published.')
    } finally {
      setPublishing(false)
    }
  }

  function chooseImages(event) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length + images.length > maxImages) {
      setError(`Choose up to ${maxImages} images for one listing.`)
      return
    }
    const invalid = selected.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    if (invalid) {
      setError('Use JPEG, PNG, or WebP images.')
      return
    }
    setImages((current) => [...current, ...selected])
    setError('')
  }

  async function contactSeller(product) {
    setMessagingSeller(true)
    try {
      const conversationId = await openConversation(product.seller.id)
      navigate('/app/chat', { state: { conversationId } })
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : 'Could not open a conversation with this seller.')
    } finally {
      setMessagingSeller(false)
    }
  }

  if (productId) {
    return (
      <div className="app-content-width commerce-page product-detail-page">
        <PageMeta title={selectedProduct ? `${selectedProduct.name} | iBuy` : 'Product | iBuy'} description={selectedProduct?.description ?? 'Product listing on iBuy.'} />
        <Link to="/app/ibuy" className="app-back-link"><ArrowLeft size={15} /> Back to iBuy</Link>
        {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
        {loadingProduct && <p className="inbox-empty-state">Loading product…</p>}
        {!loadingProduct && selectedProduct && <section className="product-detail-layout">
          <div className="product-detail-gallery">
            <div className="product-detail-main-image">{productImages[activeImage] ? <img src={productImages[activeImage]} alt={`${selectedProduct.name}, photo ${activeImage + 1}`} /> : <div className="ibuy-image-placeholder"><Store size={32} /></div>}</div>
            {productImages.length > 1 && <div className="product-detail-thumbnails">{productImages.map((image, index) => <button type="button" className={index === activeImage ? 'active' : ''} key={`${image}-${index}`} onClick={() => setActiveImage(index)} aria-label={`Show product photo ${index + 1}`}><img src={image} alt="" /></button>)}</div>}
            <div className="product-detail-gallery-caption"><span><Store size={14} /> Listed on iBuy</span><span>{selectedProduct.category}</span></div>
          </div>
          <div className="product-detail-information">
            <span className="app-page-eyebrow">{selectedProduct.category} · IBUY MARKETPLACE</span>
            <h1>{selectedProduct.name}</h1>
            <div className="product-detail-rating"><span>Seller</span><i /> @{selectedProduct.seller.username}</div>
            <p className="product-detail-description">{selectedProduct.description}</p>
            <div className="product-detail-price">{naira(selectedProduct.price)}<small>Price set by seller · NGN</small></div>
            <div className={`product-detail-stock ${selectedProduct.stock <= 0 ? 'is-unavailable' : ''}`}><span />{selectedProduct.stock > 0 ? `${selectedProduct.stock} available` : 'Currently out of stock'}</div>
            <div className="product-detail-buy-row">
              {currentUser?.id === selectedProduct.seller.id
                ? <span className="product-detail-secondary-button">This is your listing</span>
                : <button type="button" className="app-primary-button" disabled={messagingSeller} onClick={() => contactSeller(selectedProduct)}><MessageCircle size={16} /> {messagingSeller ? 'Opening chat…' : 'Message seller'}</button>}
              <button type="button" className="product-detail-secondary-button" onClick={() => navigate('/app/ibuy')}><ArrowLeft size={14} /> Continue browsing</button>
            </div>
            <div className="product-detail-facts"><h2>Product details</h2><dl><div><dt>Category</dt><dd>{selectedProduct.category}</dd></div><div><dt>Seller</dt><dd>{selectedProduct.seller.name} · @{selectedProduct.seller.username}</dd></div><div><dt>Availability</dt><dd>{selectedProduct.stock > 0 ? `${selectedProduct.stock} in stock` : 'Out of stock'}</dd></div></dl></div>
            <div className="product-detail-disclaimer"><MessageCircle size={15} /><span>Contact the seller to confirm current availability, payment, and delivery arrangements. iBuy does not process payments yet.</span></div>
          </div>
        </section>}
        {!loadingProduct && !selectedProduct && !error && <section className="product-detail-not-found"><h1>We couldn't find this listing.</h1><p>It may have been removed or is no longer available.</p><Link to="/app/ibuy" className="app-primary-button">Return to iBuy</Link></section>}
      </div>
    )
  }

  return (
    <div className="app-content-width commerce-page">
      <AppPageHeader eyebrow="IBUY · COMMUNITY MARKETPLACE" title="Buy and sell with your community." description="Browse member listings or add a product for sale." />
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <section className="ibuy-actions-bar"><p>Contact sellers directly in Messages to check details and arrange a transaction.</p><button type="button" className="app-primary-button" onClick={() => { setListingOpen((open) => !open); setError('') }}><Plus size={15} /> {listingOpen ? 'Close form' : 'List a product'}</button></section>
      {listingOpen && <form className="ibuy-listing-form" onSubmit={submitListing}>
        <h2>New product listing</h2>
        <label>Product name<input value={listing.name} onChange={(event) => setListing((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
        <div className="ibuy-listing-fields">
          <label>Category<select value={listing.category} onChange={(event) => setListing((current) => ({ ...current, category: event.target.value }))}>{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Price (₦)<input type="number" value={listing.price} onChange={(event) => setListing((current) => ({ ...current, price: event.target.value }))} min="1" max="1000000000" step="1" required /></label>
          <label>Quantity available<input type="number" value={listing.stock} onChange={(event) => setListing((current) => ({ ...current, stock: event.target.value }))} min="0" max="1000000" step="1" required /></label>
        </div>
        <label>Description<textarea value={listing.description} onChange={(event) => setListing((current) => ({ ...current, description: event.target.value }))} maxLength={2000} rows={4} required /></label>
        <label className="media-upload-picker"><ImageIcon size={18} /><span>Add product photos</span><small>{images.length}/{maxImages} · JPEG, PNG or WebP · optimized on upload</small><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} disabled={publishing || images.length >= maxImages} /></label>
        {!!images.length && <div className="media-upload-previews">{images.map((image, index) => <div className="media-upload-preview" key={`${image.name}-${image.lastModified}-${index}`}><img src={imagePreviews[index]} alt={`Selected product photo ${index + 1}`} /><button type="button" aria-label={`Remove product photo ${index + 1}`} onClick={() => setImages((current) => current.filter((_, imageIndex) => imageIndex !== index))} disabled={publishing}><X size={15} /></button></div>)}</div>}
        <button type="submit" className="app-primary-button" disabled={publishing}>{publishing ? 'Publishing…' : 'Publish listing'}</button>
      </form>}
      <div className="shop-toolbar"><div className="shop-categories" role="tablist" aria-label="Product categories">{categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={category === item ? 'shop-category-active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="shop-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search listings" aria-label="Search listings" /></label></div>
      <div className="shop-result-count"><span>{matchingProducts.length} listings</span><span><Store size={13} /> Member marketplace</span></div>
      {loadingProducts && <p className="inbox-empty-state">Loading marketplace listings…</p>}
      {!loadingProducts && error && <section className="feed-empty-state"><h2>Listings couldn’t be loaded.</h2><p>{error}</p><button type="button" className="app-primary-button" onClick={() => setRetry((current) => current + 1)}>Try again</button></section>}
      {!loadingProducts && !error && matchingProducts.length === 0 && <section className="feed-empty-state"><h2>No listings found.</h2><p>Try a different search or be the first to list a product.</p><button type="button" className="app-primary-button" onClick={() => setListingOpen(true)}>List a product</button></section>}
      {!loadingProducts && !error && matchingProducts.length > 0 && <div className="shop-product-grid">{matchingProducts.map((product) => <article className="shop-product-card" key={product.id}>
        <Link to={`/app/ibuy/${product.id}`} className="shop-product-image" aria-label={`View details for ${product.name}`}>{(product.imageUrls?.[0] ?? product.imageUrl) ? <img src={product.imageUrls?.[0] ?? product.imageUrl} alt={product.name} loading="lazy" /> : <div className="ibuy-image-placeholder"><Store size={28} /></div>}<span>{product.category}</span></Link>
        <div className="shop-product-info"><Link to={`/app/ibuy/${product.id}`} className="shop-product-name">{product.name}</Link><small className="shop-rating">Seller · @{product.seller.username}</small><p>{product.description}</p><div className="shop-product-purchase"><b>{naira(product.price)}</b>{product.stock > 0 ? <span>{product.stock} available</span> : <span className="shop-out-of-stock">Out of stock</span>}<Link to={`/app/ibuy/${product.id}`}>Details <ArrowUpRight size={14} /></Link></div></div>
      </article>)}</div>}
    </div>
  )
}
