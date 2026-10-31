import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import PageMeta from '../../components/PageMeta.jsx'
import { adminLogin } from '../../utils/adminApi.js'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function signIn(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await adminLogin(email, password)
      navigate('/admin/dashboard', { replace: true })
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Could not sign in to admin.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-login-screen">
      <PageMeta title="Admin sign in" description="Sign in to the iConnect administrator portal." />
      <header className="admin-login-header"><Link to="/" className="admin-login-brand">iConnect<span>admin portal</span></Link><Link to="/" className="admin-site-return"><ArrowLeft size={14} /> Public website</Link></header>
      <section className="admin-login-card">
        <div className="admin-login-icon"><ShieldCheck size={23} /></div>
        <span className="app-page-eyebrow">SEPARATE ADMIN PORTAL</span>
        <h1>Sign in to admin</h1>
        <p>Use your verified iConnect account. Admin access is restricted by the server’s allowlist.</p>
        <form className="admin-login-form" onSubmit={signIn}>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="app-primary-button" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></button>
        </form>
        <p className="admin-login-footnote">Only server-configured administrator email addresses can access user data. Admin activity is audited.</p>
      </section>
    </main>
  )
}
