import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Upload } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { demoInterests } from '../../data/demoContent.js'
import { people } from '../../data/siteContent.js'

export default function ProfileSetupPage() {
  const location = useLocation()
  const [name, setName] = useState(location.state?.displayName ?? '')
  const [bio, setBio] = useState('')
  const [selected, setSelected] = useState(['Design', 'Music'])
  const navigate = useNavigate()

  function toggleInterest(interest) {
    setSelected((current) => current.includes(interest)
      ? current.filter((item) => item !== interest)
      : [...current, interest])
  }

  function finishSetup(event) {
    event.preventDefault()
    navigate('/app/home', { state: { displayName: name.trim() || 'Taylor' } })
  }

  return (
    <>
      <PageMeta title="Set up your profile" description="Preview the iConnect profile and interest setup flow. This demo saves no personal data." />
      <main className="setup-screen">
        <header className="setup-header"><Link to="/app/signup"><ArrowLeft size={16} /> Back</Link><span>PROFILE SETUP · PREVIEW</span><Link to="/" className="setup-skip">Exit preview <ChevronRight size={15} /></Link></header>
        <div className="setup-layout">
          <section className="setup-form-panel">
            <div className="setup-step-label"><span>STEP 02</span><i /><span>YOUR PROFILE</span></div>
            <h1>Make it<br /><em>feel like you.</em></h1>
            <p className="setup-intro">The PRD starts with a simple profile and a few interests. Try the setup—your choices stay in this preview only.</p>
            <form onSubmit={finishSetup}>
              <div className="profile-photo-field">
                <Avatar person={people[0]} className="setup-avatar" />
                <div><strong>Your profile photo</strong><span>Photo upload will be available in the product.</span></div>
                <button type="button" aria-label="Profile photo upload is not available in preview"><Upload size={15} /></button>
              </div>
              <label className="setup-field"><span>DISPLAY NAME</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" maxLength={40} /></label>
              <label className="setup-field"><span>A LITTLE ABOUT YOU <small>OPTIONAL</small></span><textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder="A line, a thought, a tiny introduction..." maxLength={120} rows={3} /><small>{bio.length}/120</small></label>
              <div className="interest-field">
                <div className="interest-heading"><span>WHAT ARE YOU INTO?</span><small>Pick a few to shape your preview</small></div>
                <div className="interest-chips">{demoInterests.map((interest) => {
                  const isSelected = selected.includes(interest)
                  return <button type="button" key={interest} onClick={() => toggleInterest(interest)} className={isSelected ? 'interest-chip selected' : 'interest-chip'} aria-pressed={isSelected}>{isSelected && <Check size={12} />}{interest}</button>
                })}</div>
              </div>
              <button type="submit" className="app-primary-button setup-submit">Go to my home <ArrowRight size={17} /></button>
            </form>
            <p className="setup-demo-note">Preview only · Nothing is sent to a server</p>
          </section>
          <aside className="setup-preview-panel">
            <div className="setup-preview-top"><span className="app-page-eyebrow">YOUR SPACE IS TAKING SHAPE</span><span className="preview-status"><i /> PREVIEW</span></div>
            <div className="profile-preview-card">
              <div className="profile-preview-cover" />
              <Avatar person={people[0]} className="profile-preview-avatar" />
              <h2>{name.trim() || 'Your name'}</h2>
              <span className="profile-preview-handle">@yourcorner</span>
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
