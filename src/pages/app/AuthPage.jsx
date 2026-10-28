import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, Heart, ShieldCheck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Brand from '../../components/Brand.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { getDemoProfile, saveDemoProfile, startDemoSession } from '../../utils/demoAccount.js'

export default function AuthPage() {
  const isSignup = useLocation().pathname.endsWith('/signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Use at least 8 characters for this preview password.')
      return
    }

    if (isSignup && !name.trim()) {
      setError('Enter your name to create a demo profile.')
      return
    }

    const normalizedEmail = email.trim().toLowerCase()

    try {
      if (isSignup) {
        const existingProfile = getDemoProfile()
        if (existingProfile && existingProfile.email !== normalizedEmail) {
          setError(`This browser already has a demo profile for ${existingProfile.email}. Log in with that email or clear this browser's saved demo data.`)
          return
        }

        saveDemoProfile({ name: name.trim(), email: normalizedEmail })
        navigate('/app/setup', { state: { displayName: name.trim(), email: normalizedEmail } })
        return
      }

      const profile = getDemoProfile()
      if (!profile || profile.email !== normalizedEmail) {
        setError('No demo profile was found for that email in this browser. Create an account first.')
        return
      }

      startDemoSession()
      navigate('/app/home')
    } catch (storageError) {
      if (!(storageError instanceof DOMException)) throw storageError
      setError('This browser could not save or access your demo profile. Check your browser storage settings and try again.')
    }
  }

  return (
    <>
      <PageMeta
        title={isSignup ? 'Create your account' : 'Log in'}
        description={`Preview the iConnect ${isSignup ? 'sign-up' : 'login'} flow. Credentials are not saved or sent.`}
      />
      <main className="auth-screen">
        <header className="auth-header">
          <Link to="/app/onboarding" className="auth-back"><ArrowLeft size={17} /> Back</Link>
          <Brand />
          <span className="auth-preview-label"><i /> PREVIEW</span>
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
            <span className="app-page-eyebrow">{isSignup ? 'JOIN THE PREVIEW' : 'WELCOME BACK'}</span>
            <h2>{isSignup ? 'Create your account' : 'Log in to iConnect'}</h2>
            <p className="auth-card-intro">{isSignup ? 'Your next favorite corner is just ahead.' : 'Your iConnect space is right where you left it.'}</p>
            <form className="auth-form" onSubmit={handleSubmit}>
              {isSignup && <label><span>YOUR NAME</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" required maxLength={40} /></label>}
              <label><span>EMAIL ADDRESS</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
              <label><span>PASSWORD</span><span className="auth-password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" required minLength={8} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="app-primary-button auth-submit">{isSignup ? 'Create account' : 'Log in'} <ArrowRight size={17} /></button>
            </form>
            <p className="auth-switch">{isSignup ? 'Already part of iConnect?' : 'New to iConnect?'} <Link to={isSignup ? '/app/login' : '/app/signup'}>{isSignup ? 'Log in' : 'Create an account'}</Link></p>
            <div className="auth-safety-note"><ShieldCheck size={16} /><span>Your demo profile is saved only in this browser. Passwords are never saved or sent; demo login checks the email on this device, not your password.</span></div>
          </section>
        </div>
        <footer className="auth-footer">iConnect · Social, made a little more human</footer>
      </main>
    </>
  )
}
