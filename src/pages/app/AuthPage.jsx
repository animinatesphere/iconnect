import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, Heart, ShieldCheck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Brand from '../../components/Brand.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { apiRequest } from '../../utils/api.js'
import { saveDemoProfile, startDemoSession } from '../../utils/demoAccount.js'

export default function AuthPage() {
  const isSignup = useLocation().pathname.endsWith('/signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    if (password.length < 10) {
      setError('Use at least 10 characters for your password.')
      setSubmitting(false)
      return
    }

    if (isSignup && !name.trim()) {
      setError('Enter your name to create your profile.')
      setSubmitting(false)
      return
    }

    const normalizedEmail = email.trim().toLowerCase()

    try {
      if (isSignup) {
        await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), email: normalizedEmail, password }),
        })
        window.sessionStorage.setItem('iconnect.pendingVerificationEmail', normalizedEmail)
        navigate('/app/verify-email', { state: { email: normalizedEmail } })
        return
      }

      const { user } = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, password }),
      })
      saveDemoProfile({ name: user.name, email: user.email, username: user.username, bio: user.bio, interests: user.interests })
      startDemoSession()
      navigate('/app/home')
    } catch (storageError) {
      setError(storageError instanceof Error ? storageError.message : 'Could not complete sign in. Try again.')
      if (storageError?.code === 'email_not_verified') {
        window.sessionStorage.setItem('iconnect.pendingVerificationEmail', normalizedEmail)
        navigate('/app/verify-email', { state: { email: normalizedEmail } })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageMeta
        title={isSignup ? 'Create your account' : 'Log in'}
        description={`Create an iConnect account or sign in with your email and password.`}
      />
      <main className="auth-screen">
        <header className="auth-header">
          <Link to="/app/onboarding" className="auth-back"><ArrowLeft size={17} /> Back</Link>
          <Brand />
          <span className="auth-preview-label"><i /> SECURE SIGN IN</span>
        </header>
        <div className="auth-layout">
          <section className="auth-story">
            <div className="auth-story-mark"><Heart size={22} fill="currentColor" /></div>
            <span className="app-page-eyebrow">YOUR PEOPLE ARE HERE</span>
            <h1>{isSignup ? <>Make room for<br /><em>more connection.</em></> : <>Good to see<br /><em>you again.</em></>}</h1>
            <p>{isSignup ? 'Start with your profile, find your people, and make this social space your own.' : 'Pick up where your people, conversations, and favorite corners are waiting.'}</p>
            <div className="auth-social-proof">
              <span className="auth-avatar-stack"><i>J</i><i>M</i><i>S</i></span>
              <span><strong>One space to feel connected.</strong><small>Share · discover · belong</small></span>
            </div>
          </section>
          <section className="auth-card">
            <span className="app-page-eyebrow">{isSignup ? 'JOIN iCONNECT' : 'WELCOME BACK'}</span>
            <h2>{isSignup ? 'Create your account' : 'Log in to iConnect'}</h2>
            <p className="auth-card-intro">{isSignup ? 'Create your account and verify your email to get started.' : 'Your iConnect space is right where you left it.'}</p>
            <form className="auth-form" onSubmit={handleSubmit}>
              {isSignup && <label><span>YOUR NAME</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" required maxLength={40} /></label>}
              <label><span>EMAIL ADDRESS</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
              <label><span>PASSWORD</span><span className="auth-password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" required minLength={10} maxLength={128} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="app-primary-button auth-submit" disabled={submitting}>{submitting ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'} <ArrowRight size={17} /></button>
            </form>
            <p className="auth-switch">{isSignup ? 'Already part of iConnect?' : 'New to iConnect?'} <Link to={isSignup ? '/app/login' : '/app/signup'}>{isSignup ? 'Log in' : 'Create an account'}</Link></p>
            <div className="auth-safety-note"><ShieldCheck size={16} /><span>Passwords are stored as one-way hashes. New accounts must verify their email with a time-limited code.</span></div>
          </section>
        </div>
        <footer className="auth-footer">iConnect · Social, made a little more human</footer>
      </main>
    </>
  )
}
