import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, MailCheck, ShieldCheck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Brand from '../../components/Brand.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { apiRequest } from '../../utils/api.js'
import { saveDemoProfile, startDemoSession } from '../../utils/demoAccount.js'

export default function VerifyEmailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => {
    try {
      return location.state?.email ?? window.sessionStorage.getItem('iconnect.pendingVerificationEmail') ?? ''
    } catch (error) {
      if (error instanceof DOMException) return location.state?.email ?? ''
      throw error
    }
  })
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function verifyEmail(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      const { user } = await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
      })
      saveDemoProfile({
        name: user.name,
        email: user.email,
        username: user.username,
        bio: user.bio,
        interests: user.interests,
      })
      startDemoSession()
      window.sessionStorage.removeItem('iconnect.pendingVerificationEmail')
      navigate('/app/setup', { state: { displayName: user.name, email: user.email } })
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Could not verify this email. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function resendCode() {
    setError('')
    setNotice('')
    try {
      await apiRequest('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      setNotice('If this email is awaiting verification, a new code has been sent.')
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Could not resend the code. Try again.')
    }
  }

  return (
    <>
      <PageMeta title="Verify your email | iConnect" description="Verify your iConnect account with the one-time code sent to your email." />
      <main className="auth-screen">
        <header className="auth-header">
          <Link to="/app/signup" className="auth-back"><ArrowLeft size={17} /> Back</Link>
          <Brand />
          <span className="auth-preview-label"><i /> EMAIL VERIFICATION</span>
        </header>
        <div className="verify-email-layout">
          <section className="verify-email-card">
            <div className="verify-email-icon"><MailCheck size={24} /></div>
            <span className="app-page-eyebrow">ONE MORE STEP</span>
            <h1>Check your inbox.</h1>
            <p>Enter the six-digit code sent to your email. The code expires after 10 minutes.</p>
            <form className="auth-form" onSubmit={verifyEmail}>
              <label><span>EMAIL ADDRESS</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label><span>6-DIGIT CODE</span><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required /></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              {notice && <p className="verify-email-notice" role="status"><CheckCircle2 size={15} />{notice}</p>}
              <button type="submit" className="app-primary-button auth-submit" disabled={submitting}>{submitting ? 'Verifying…' : 'Verify email'} <ArrowRight size={17} /></button>
            </form>
            <button type="button" className="verify-email-resend" onClick={resendCode}>Didn’t get a code? Send another</button>
            <div className="auth-safety-note"><ShieldCheck size={16} /><span>Never share your verification code with anyone. iConnect staff will never ask for it.</span></div>
          </section>
        </div>
        <footer className="auth-footer">iConnect · Social, made a little more human</footer>
      </main>
    </>
  )
}
