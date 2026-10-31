import React, { useEffect, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { deleteAdminContent, getAdminContent } from '../../utils/adminApi.js'

const contentTypes = [
  ['posts', 'Social posts'],
  ['comments', 'Comments'],
  ['products', 'iBuy products'],
  ['local_listings', 'Local listings'],
  ['jobs', 'Job listings'],
  ['communities', 'Communities'],
]

function formatDate(value) {
  return new Date(value).toLocaleString()
}

export default function AdminContentPanel() {
  const [type, setType] = useState('posts')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      getAdminContent(type, { query, limit: 100 })
        .then((result) => {
          if (!active) return
          setItems(result.items)
          setTotal(result.total)
          setError('')
        })
        .catch((loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load content.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, query.trim() ? 250 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, retry, type])

  async function removeItem(item) {
    if (!window.confirm(`Permanently remove “${item.title}” from iConnect?`)) return
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      await deleteAdminContent(type, item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      setTotal((current) => Math.max(0, current - 1))
      setNotice('Content removed. The action was recorded in the admin audit log.')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove this content.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="admin-panel admin-content-panel">
      <div className="admin-panel-heading">
        <div>
          <span className="app-page-eyebrow">LIVE USER CONTENT</span>
          <h2>Manage {contentTypes.find(([value]) => value === type)?.[1]} <small>{total.toLocaleString()}</small></h2>
        </div>
        <div className="admin-content-controls">
          <select value={type} onChange={(event) => { setType(event.target.value); setNotice('') }} aria-label="Content type">
            {contentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="admin-user-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search content" aria-label="Search content" /></label>
        </div>
      </div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {loading && <p className="admin-detail-loading">Loading live content…</p>}
      {!loading && !error && !items.length && <div className="admin-content-empty"><p>No matching content.</p></div>}
      {!loading && !!items.length && <div className="admin-content-list">
        {items.map((item) => (
          <article key={item.id}>
            {item.imageUrls?.[0] && <img className="admin-content-thumbnail" src={item.imageUrls[0]} alt="" loading="lazy" />}
            <div className="admin-content-item-copy">
              <strong>{item.title}</strong>
              <small>{item.owner} · {formatDate(item.createdAt)}{item.published === false ? ' · Unpublished' : ''}</small>
              {item.description && <p>{item.description}</p>}
            </div>
            <button type="button" className="admin-row-action admin-danger-action" onClick={() => removeItem(item)} disabled={busyId === item.id} aria-label={`Remove ${item.title}`}>
              <Trash2 size={14} /> {busyId === item.id ? 'Removing…' : 'Remove'}
            </button>
          </article>
        ))}
        {total > items.length && <p className="admin-panel-note">Showing the newest {items.length} of {total} records. Search to find older content.</p>}
      </div>}
      {!loading && error && <button type="button" className="admin-row-action" onClick={() => setRetry((value) => value + 1)}>Try again</button>}
    </section>
  )
}
