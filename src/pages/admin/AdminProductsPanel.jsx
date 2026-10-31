import React, { useEffect, useState } from 'react'
import { Image as ImageIcon, Plus, Search, Store, Trash2, X } from 'lucide-react'
import { createMarketplaceProduct } from '../../utils/marketplaceApi.js'
import { uploadImage } from '../../utils/mediaApi.js'
import { deleteAdminContent, getAdminContent, updateAdminProduct } from '../../utils/adminApi.js'

const categories = ['Style', 'Tech', 'Home', 'Other']
const maxImageBytes = 4 * 1024 * 1024
const emptyProduct = { name: '', category: 'Home', price: '', stock: '1', description: '', published: true }

function formatPrice(value) {
  return `₦${new Intl.NumberFormat('en-NG').format(value)}`
}

export default function AdminProductsPanel() {
  const [products, setProducts] = useState([])
  const [productTotal, setProductTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState(emptyProduct)
  const [editingId, setEditingId] = useState('')
  const [imageUrls, setImageUrls] = useState([])
  const [images, setImages] = useState([])
  const [previews, setPreviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      getAdminContent('products', { query, limit: 100 })
        .then((result) => {
          if (active) {
            setProducts(result.items)
            setProductTotal(result.total)
            setError('')
          }
        })
        .catch((loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load products.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, query.trim() ? 250 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, retry])

  useEffect(() => {
    const objectUrls = images.map((file) => URL.createObjectURL(file))
    setPreviews(objectUrls)
    return () => objectUrls.forEach((url) => URL.revokeObjectURL(url))
  }, [images])

  function resetForm() {
    setProduct(emptyProduct)
    setEditingId('')
    setImageUrls([])
    setImages([])
  }

  function chooseImages(event) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length + imageUrls.length + images.length > 5) {
      setError('Choose up to five photos for one product.')
      return
    }
    const invalid = selected.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > maxImageBytes)
    if (invalid) {
      setError('Use JPEG, PNG, or WebP photos no larger than 4 MB each.')
      return
    }
    setImages((current) => [...current, ...selected])
    setError('')
  }

  async function submitProduct(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const uploadedUrls = []
      for (const image of images) uploadedUrls.push(await uploadImage(image))
      const nextImages = [...imageUrls, ...uploadedUrls]
      if (editingId) {
        await updateAdminProduct(editingId, { ...product, imageUrls: nextImages })
        setNotice('Product changes saved.')
      } else {
        await createMarketplaceProduct({ ...product, imageUrls: nextImages })
        setNotice('Product published to iBuy.')
      }
      resetForm()
      setRetry((value) => value + 1)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The product could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function editProduct(item) {
    setEditingId(item.id)
    setProduct({
      name: item.title,
      category: item.category,
      price: String(item.price),
      stock: String(item.stock),
      description: item.description,
      published: item.published,
    })
    setImageUrls(item.imageUrls)
    setImages([])
    setError('')
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function togglePublished(item) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      await updateAdminProduct(item.id, {
        name: item.title,
        category: item.category,
        price: item.price,
        stock: item.stock,
        description: item.description,
        imageUrls: item.imageUrls,
        published: !item.published,
      })
      setProducts((current) => current.map((entry) => entry.id === item.id ? { ...entry, published: !entry.published } : entry))
      setNotice(item.published ? 'Product hidden from the user marketplace.' : 'Product published to the user marketplace.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not change product visibility.')
    } finally {
      setBusyId('')
    }
  }

  async function removeProduct(item) {
    if (!window.confirm(`Permanently remove “${item.title}” from iBuy?`)) return
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      await deleteAdminContent('products', item.id)
      setProducts((current) => current.filter((entry) => entry.id !== item.id))
      setProductTotal((current) => Math.max(0, current - 1))
      if (editingId === item.id) resetForm()
      setNotice('Product removed. The action was recorded in the admin audit log.')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove this product.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="admin-products-layout">
      <section className="admin-panel admin-content-panel">
        <div className="admin-panel-heading">
          <div><span className="app-page-eyebrow">MARKETPLACE MANAGEMENT</span><h2>{editingId ? 'Edit product' : 'Add a product'}</h2></div>
          {editingId && <button type="button" className="admin-row-action" onClick={resetForm}>Cancel edit</button>}
        </div>
        <form className="admin-product-form" onSubmit={submitProduct}>
          <div className="admin-product-form-row">
            <label>Product name<input value={product.name} onChange={(event) => setProduct((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
            <label>Category<select value={product.category} onChange={(event) => setProduct((current) => ({ ...current, category: event.target.value }))}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          </div>
          <div className="admin-product-form-row">
            <label>Price (NGN)<input type="number" min="1" max="1000000000" value={product.price} onChange={(event) => setProduct((current) => ({ ...current, price: event.target.value }))} required /></label>
            <label>Stock<input type="number" min="0" max="1000000" value={product.stock} onChange={(event) => setProduct((current) => ({ ...current, stock: event.target.value }))} required /></label>
          </div>
          <label>Description<textarea value={product.description} onChange={(event) => setProduct((current) => ({ ...current, description: event.target.value }))} maxLength={2000} rows={4} required /></label>
          <label className="admin-product-upload"><ImageIcon size={16} /><span>Add up to five product photos (JPEG, PNG or WebP; 4 MB each)</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} disabled={saving} /></label>
          {(imageUrls.length > 0 || previews.length > 0) && <div className="admin-product-photo-list">
            {imageUrls.map((url, index) => <div key={`${url}-${index}`}><img src={url} alt={`Product photo ${index + 1}`} /><button type="button" onClick={() => setImageUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove product photo ${index + 1}`}><X size={13} /></button></div>)}
            {previews.map((url, index) => <div key={url}><img src={url} alt={`New product photo ${index + 1}`} /><button type="button" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove new product photo ${index + 1}`}><X size={13} /></button></div>)}
          </div>}
          {editingId && <label className="admin-product-published"><input type="checkbox" checked={product.published} onChange={(event) => setProduct((current) => ({ ...current, published: event.target.checked }))} /> Visible to users in iBuy</label>}
          {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
          {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
          <button type="submit" className="app-primary-button" disabled={saving}>{editingId ? <Store size={15} /> : <Plus size={15} />}{saving ? 'Saving…' : editingId ? 'Save product changes' : 'Publish product'}</button>
        </form>
      </section>

      <section className="admin-panel admin-products-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">ALL SELLERS</span><h2>iBuy products <small>{productTotal}</small></h2></div><div className="admin-products-toolbar"><label className="admin-user-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" aria-label="Search products" /></label><button type="button" className="admin-row-action" onClick={() => setRetry((value) => value + 1)} disabled={loading}>Refresh</button></div></div>
        {loading && <p className="admin-detail-loading">Loading marketplace listings…</p>}
        {!loading && !products.length && <div className="admin-content-empty"><Store size={18} /><p>No products have been listed yet.</p></div>}
        {!loading && products.map((item) => (
          <article className="admin-product-row" key={item.id}>
            {item.imageUrls[0] ? <img src={item.imageUrls[0]} alt="" loading="lazy" /> : <span className="admin-product-placeholder"><Store size={18} /></span>}
            <div className="admin-product-copy"><strong>{item.title}</strong><small>{item.owner} · {item.category} · Stock {item.stock}</small><small>{item.description}</small></div>
            <strong className="admin-product-price">{formatPrice(item.price)}</strong>
            <span className={item.published ? 'admin-visible-status' : 'admin-hidden-status'}>{item.published ? 'Published' : 'Hidden'}</span>
            <div className="admin-row-actions">
              <button type="button" className="admin-row-action" onClick={() => editProduct(item)}>Edit</button>
              <button type="button" className="admin-row-action" onClick={() => togglePublished(item)} disabled={busyId === item.id}>{item.published ? 'Hide' : 'Publish'}</button>
              <button type="button" className="admin-row-action admin-danger-action" onClick={() => removeProduct(item)} disabled={busyId === item.id}><Trash2 size={13} /> Remove</button>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
