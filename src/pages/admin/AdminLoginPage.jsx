import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import PageMeta from '../../components/PageMeta.jsx'
import { startDemoAdminSession } from '../../utils/demoAdmin.js'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function enterDemo(event) {
    event.preventDefault()
    try {
      startDemoAdminSession()
      navigate('/admin/dashboard', { replace: true })
    } catch (storageError) {
      setError(storageError instanceof Error ? storageError.message : 'This browser could not open the admin preview.')
    }
  }

  return (
    <main className="admin-login-screen">
      <PageMeta title="Admin sign in" description="Local-only iConnect admin dashboard preview." />
      <header className="admin-login-header"><Link to="/" className="admin-login-brand">iConnect<span>admin preview</span></Link><Link to="/" className="admin-site-return"><ArrowLeft size={14} /> Public website</Link></header>
      <section className="admin-login-card">
        <div className="admin-login-icon"><ShieldCheck size={23} /></div>
        <span className="app-page-eyebrow">SEPARATE ADMIN PORTAL</span>
        <h1>Sign in to admin</h1>
        <p>Open the local dashboard preview for this browser.</p>
        <div className="admin-login-warning"><ShieldAlert size={16} /><span><strong>Demo only—not secure authentication.</strong> Email and password are not checked or saved. Do not enter real credentials. This browser-only gate cannot protect a real website.</span></div>
        <form className="admin-login-form" onSubmit={enterDemo}>
          <label>Demo email<input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.test" required /></label>
          <label>Demo password<input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Any text for the preview" required /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="app-primary-button">Open demo dashboard <ArrowRight size={16} /></button>
        </form>
        <p className="admin-login-footnote">Submitting only sets a local demo flag. Secure admin accounts require server-side identity, roles, and session management.</p>
      </section>
    </main>
  )
}
