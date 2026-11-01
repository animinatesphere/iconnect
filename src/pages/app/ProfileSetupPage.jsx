import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, Check, ChevronRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { interestOptions } from '../../data/profileOptions.js'
import { apiRequest } from '../../utils/api.js'
import { uploadImage } from '../../utils/mediaApi.js'

export default function ProfileSetupPage() {
  const [account, setAccount] = useState(null)
  const [accountLoading, setAccountLoading] = useState(true)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [selected, setSelected] = useState([])
  const [error, setError] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    apiRequest('/api/auth/me')
      .then(({ user }) => {
        if (!active) return
        setAccount(user)
        setName(user.name)
        setBio(user.bio)
        setSelected(user.interests)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load your account.')
      })
      .finally(() => { if (active) setAccountLoading(false) })
    return () => { active = false }
  }, [])

  function toggleInterest(interest) {
    setSelected((current) => current.includes(interest)
      ? current.filter((item) => item !== interest)
      : [...current, interest])
  }

  async function chooseProfilePhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP photo.')
      return
    }

    setUploadingPhoto(true)
    setError('')
    try {
      const imageUrl = await uploadImage(file)
      const result = await apiRequest('/api/auth/profile/photo', {
        method: 'PUT',
        body: JSON.stringify({ image_url: imageUrl }),
      })
      setAccount(result.user)
      window.dispatchEvent(new CustomEvent('iconnect:profile-updated', { detail: result.user }))
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not save your profile photo.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function finishSetup(event) {
    event.preventDefault()
    setError('')
    if (!account) {
      setError('Your account could not be loaded. Sign in again and retry.')
      return
    }

    try {
      const profile = await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim() || account.name,
          username: account.username,
          bio,
          interests: selected,
        }),
      })
      setAccount(profile.user)
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
            <p className="setup-intro">Add a few details and a photo so your iConnect profile feels like you. Your profile is saved to your account.</p>
            {accountLoading && <p className="connect-empty-state">Loading your account…</p>}
            <form onSubmit={finishSetup}>
              <label className="setup-photo-picker"><Avatar person={{ name: name || 'Your profile', image: account?.image }} /><span><strong>{uploadingPhoto ? 'Saving photo…' : account?.image ? 'Change profile photo' : 'Add a profile photo'}</strong><small>JPEG, PNG or WebP · optimized automatically</small></span><Camera size={16} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseProfilePhoto} disabled={uploadingPhoto || accountLoading} /></label>
              <label className="setup-field"><span>DISPLAY NAME</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" maxLength={80} disabled={accountLoading} /></label>
              <label className="setup-field"><span>A LITTLE ABOUT YOU <small>OPTIONAL</small></span><textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder="A line, a thought, a tiny introduction..." maxLength={120} rows={3} /><small>{bio.length}/120</small></label>
              <div className="interest-field">
                <div className="interest-heading"><span>WHAT ARE YOU INTO?</span><small>Pick a few to shape your experience</small></div>
                <div className="interest-chips">{interestOptions.map((interest) => {
                  const isSelected = selected.includes(interest)
                  return <button type="button" key={interest} onClick={() => toggleInterest(interest)} className={isSelected ? 'interest-chip selected' : 'interest-chip'} aria-pressed={isSelected}>{isSelected && <Check size={12} />}{interest}</button>
                })}</div>
              </div>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="app-primary-button setup-submit" disabled={accountLoading || !account}>Go to my home <ArrowRight size={17} /></button>
            </form>
            <p className="setup-account-note">Your profile details and photo are saved to your iConnect account.</p>
          </section>
          <aside className="setup-preview-panel">
            <div className="setup-preview-top"><span className="app-page-eyebrow">YOUR SPACE IS TAKING SHAPE</span>            <span className="preview-status"><i /> PROFILE PREVIEW</span></div>
            <div className="profile-preview-card">
              <div className="profile-preview-cover" />
              <Avatar person={{ name: name || 'Your profile', image: account?.image }} className="profile-preview-avatar" />
              <h2>{name.trim() || 'Your name'}</h2>
              <span className="profile-preview-handle">{account?.email || 'Your email stays private'}</span>
              <p>{bio || 'Your little introduction will live here.'}</p>
              <div className="profile-preview-interests">{selected.slice(0, 4).map((interest) => <span key={interest}>{interest}</span>)}</div>
              <div className="profile-preview-stat"><strong>YOUR iCONNECT PROFILE</strong><span>Saved to your account</span></div>
            </div>
            <div className="setup-preview-tip"><span>01</span><p><strong>Your interests help shape your home.</strong> In the product, they’ll help you discover relevant feeds and communities.</p></div>
          </aside>
        </div>
      </main>
    </>
  )
}
