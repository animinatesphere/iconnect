import React, { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Upload } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { demoInterests } from '../../data/demoContent.js'
import { demoAvatar, getDemoProfile, saveDemoProfile, startDemoSession } from '../../utils/demoAccount.js'
import { apiRequest } from '../../utils/api.js'

function defaultUsername(email) {
  const prefix = email.split('@')[0].replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30)
  return prefix.length >= 3 ? prefix : `user${prefix}`.slice(0, 30)
}

export default function ProfileSetupPage() {
  const location = useLocation()
  const savedProfile = getDemoProfile()
  const [name, setName] = useState(location.state?.displayName ?? savedProfile?.name ?? '')
  const [email] = useState(location.state?.email ?? savedProfile?.email ?? '')
  const [avatar, setAvatar] = useState(savedProfile?.avatar ?? demoAvatar)
  const photoInput = useRef(null)
  const [bio, setBio] = useState(savedProfile?.bio ?? '')
  const [selected, setSelected] = useState(savedProfile?.interests.length ? savedProfile.interests : ['Design', 'Music'])
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function toggleInterest(interest) {
    setSelected((current) => current.includes(interest)
      ? current.filter((item) => item !== interest)
      : [...current, interest])
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 500_000) {
      setError('Choose an image under 500 KB for your demo profile photo.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('This image could not be previewed. Try another image.')
        return
      }
      setAvatar(reader.result)
      setError('')
    }
    reader.onerror = () => setError('This image could not be read. Try another image.')
    reader.readAsDataURL(file)
  }

  async function finishSetup(event) {
    event.preventDefault()
    setError('')
    if (!email) {
      setError('Start from sign up so your demo profile can be linked to an email address.')
      return
    }

    try {
      const profile = await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim() || 'Your iConnect profile',
          username: savedProfile?.username ?? defaultUsername(email),
          bio,
          interests: selected,
        }),
      })
      saveDemoProfile({ name: profile.user.name, email: profile.user.email, username: profile.user.username, bio: profile.user.bio, interests: profile.user.interests, avatar })
      startDemoSession()
      navigate('/app/home')
    } catch (storageError) {
      setError(storageError instanceof Error ? storageError.message : 'Could not save your profile. Try again.')
    }
  }

  return (
    <>
      <PageMeta title="Set up your profile" description="Set your iConnect display name, bio, and interests." />
      <main className="setup-screen">
        <header className="setup-header"><Link to="/app/signup"><ArrowLeft size={16} /> Back</Link><span>PROFILE SETUP</span><Link to="/" className="setup-skip">Exit setup <ChevronRight size={15} /></Link></header>
        <div className="setup-layout">
          <section className="setup-form-panel">
            <div className="setup-step-label"><span>STEP 02</span><i /><span>YOUR PROFILE</span></div>
            <h1>Make it<br /><em>feel like you.</em></h1>
            <p className="setup-intro">Add a few details so your iConnect profile feels like you. Your name, bio, and interests are saved to your account.</p>
            <form onSubmit={finishSetup}>
              <div className="profile-photo-field">
                <Avatar person={{ name: name || 'Your profile', image: avatar }} className="setup-avatar" />
                <div><strong>Your profile photo</strong><span>Choose an image under 500 KB. This photo stays on this device for now.</span></div>
                <input ref={photoInput} className="create-image-input" type="file" accept="image/*" onChange={choosePhoto} />
                <button type="button" aria-label="Choose profile photo" onClick={() => photoInput.current?.click()}><Upload size={15} /></button>
              </div>
              <label className="setup-field"><span>DISPLAY NAME</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" maxLength={40} /></label>
              <label className="setup-field"><span>A LITTLE ABOUT YOU <small>OPTIONAL</small></span><textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder="A line, a thought, a tiny introduction..." maxLength={120} rows={3} /><small>{bio.length}/120</small></label>
              <div className="interest-field">
                <div className="interest-heading"><span>WHAT ARE YOU INTO?</span><small>Pick a few to shape your experience</small></div>
                <div className="interest-chips">{demoInterests.map((interest) => {
                  const isSelected = selected.includes(interest)
                  return <button type="button" key={interest} onClick={() => toggleInterest(interest)} className={isSelected ? 'interest-chip selected' : 'interest-chip'} aria-pressed={isSelected}>{isSelected && <Check size={12} />}{interest}</button>
                })}</div>
              </div>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="app-primary-button setup-submit">Go to my home <ArrowRight size={17} /></button>
            </form>
            <p className="setup-demo-note">Your profile details are saved to your iConnect account.</p>
          </section>
          <aside className="setup-preview-panel">
            <div className="setup-preview-top"><span className="app-page-eyebrow">YOUR SPACE IS TAKING SHAPE</span><span className="preview-status"><i /> PREVIEW</span></div>
            <div className="profile-preview-card">
              <div className="profile-preview-cover" />
              <Avatar person={{ name: name || 'Your profile', image: avatar }} className="profile-preview-avatar" />
              <h2>{name.trim() || 'Your name'}</h2>
              <span className="profile-preview-handle">{email || 'your email stays private'}</span>
              <p>{bio || 'Your little introduction will live here.'}</p>
              <div className="profile-preview-interests">{selected.slice(0, 4).map((interest) => <span key={interest}>{interest}</span>)}</div>
              <div className="profile-preview-stat"><strong>YOUR iCONNECT PROFILE</strong><span>Visible to you in this demo</span></div>
            </div>
            <div className="setup-preview-tip"><span>01</span><p><strong>Your interests help shape your home.</strong> In the product, they’ll help you discover relevant feeds and communities.</p></div>
          </aside>
        </div>
      </main>
    </>
  )
}
