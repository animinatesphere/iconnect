import React, { useEffect, useState } from 'react'
import { ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { createAdminSubadmin, getAdminSubadmins, revokeAdminSubadmin } from '../../utils/adminApi.js'

export default function AdminSubadminsPanel() {
  const [admins, setAdmins] = useState({ superAdmins: [], subAdmins: [] })
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    getAdminSubadmins()
      .then((result) => {
        if (active) {
          setAdmins(result)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load administrators.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [retry])

  async function addSubadmin(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await createAdminSubadmin(email)
      setAdmins((current) => ({ ...current, subAdmins: [result.subAdmin, ...current.subAdmins] }))
      setEmail('')
      setNotice('Sub-admin access granted. The account can sign in with its existing iConnect credentials.')
    } catch (grantError) {
      setError(grantError instanceof Error ? grantError.message : 'Could not grant sub-admin access.')
    } finally {
      setSaving(false)
    }
  }

  async function removeSubadmin(subadmin) {
    if (!window.confirm(`Remove administrator access from ${subadmin.email}?`)) return
    setBusyId(subadmin.id)
    setError('')
    setNotice('')
    try {
      await revokeAdminSubadmin(subadmin.id)
      setAdmins((current) => ({ ...current, subAdmins: current.subAdmins.filter((item) => item.id !== subadmin.id) }))
      setNotice('Sub-admin access removed.')
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not remove sub-admin access.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="admin-role-layout">
      <section className="admin-panel admin-content-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">SUPER ADMIN ONLY</span><h2>Grant sub-admin access</h2></div></div>
        <p className="admin-panel-note">The person must already have a registered, email-verified iConnect account. Sub-admins can manage users and user content, but cannot open private messages or manage administrator roles.</p>
        <form className="admin-subadmin-form" onSubmit={addSubadmin}>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <button type="submit" className="app-primary-button" disabled={saving}><UserPlus size={15} />{saving ? 'Granting…' : 'Make sub-admin'}</button>
        </form>
        {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
        {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      </section>

      <section className="admin-panel admin-content-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">SERVER ALLOWLIST</span><h2>Super admins</h2></div></div>
        <p className="admin-panel-note">Super-admin accounts are controlled only by the VPS `ADMIN_EMAILS` setting.</p>
        <div className="admin-role-list">{admins.superAdmins.map((address) => <article key={address}><ShieldCheck size={16} /><strong>{address}</strong><span>Super admin</span></article>)}</div>
      </section>

      <section className="admin-panel admin-content-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">DATABASE-MANAGED ROLES</span><h2>Sub-admins <small>{admins.subAdmins.length}</small></h2></div><button type="button" className="admin-row-action" onClick={() => setRetry((value) => value + 1)} disabled={loading}>Refresh</button></div>
        {loading && <p className="admin-detail-loading">Loading sub-admins…</p>}
        {!loading && !admins.subAdmins.length && <div className="admin-content-empty"><p>No sub-admins have been added.</p></div>}
        {!loading && <div className="admin-role-list">{admins.subAdmins.map((subadmin) => <article key={subadmin.id}><ShieldCheck size={16} /><div><strong>{subadmin.name}</strong><small>{subadmin.email} · Added by {subadmin.createdBy}</small></div><button type="button" className="admin-row-action admin-danger-action" onClick={() => removeSubadmin(subadmin)} disabled={busyId === subadmin.id}><UserMinus size={14} />{busyId === subadmin.id ? 'Removing…' : 'Remove access'}</button></article>)}</div>}
      </section>
    </div>
  )
}
