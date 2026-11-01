import React, { useEffect, useState } from 'react'
import { Bell, Camera, ChevronRight, Eye, KeyRound, Link2, LockKeyhole, LogOut, Save, Shield, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { interestOptions } from '../../data/profileOptions.js'
import { apiRequest } from '../../utils/api.js'
import { uploadImage } from '../../utils/mediaApi.js'

const defaultPreferences = { profileVisible: true, discoverable: true }

export default function AccountPage() {
  const [activeTab, setActiveTab] = useState('Profile')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [account, setAccount] = useState(null)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [selected, setSelected] = useState([])
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [accountLoading, setAccountLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [privacySaving, setPrivacySaving] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    apiRequest('/api/auth/me')
      .then(({ user }) => {
        if (!active) return
        setAccount(user)
        setName(user.name)
        setUsername(user.username)
        setBio(user.bio)
        setSelected(user.interests)
        setPreferences({
          profileVisible: user.profileVisible,
          discoverable: user.discoverable,
        })
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load your account.')
      })
      .finally(() => {
        if (active) setAccountLoading(false)
      })
    return () => { active = false }
  }, [])

  function toggleInterest(interest) {
    setSelected((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest])
  }

  async function saveProfilePhoto(imageUrl) {
    setSavingPhoto(true)
    setNotice('')
    setError('')
    try {
      const result = await apiRequest('/api/auth/profile/photo', {
        method: 'PUT',
        body: JSON.stringify({ image_url: imageUrl }),
      })
      setAccount(result.user)
      window.dispatchEvent(new CustomEvent('iconnect:profile-updated', { detail: result.user }))
      setNotice(imageUrl ? 'Your profile photo was saved.' : 'Your profile photo was removed.')
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : 'Could not save your profile photo.')
    } finally {
      setSavingPhoto(false)
    }
  }

  async function chooseProfilePhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP photo.')
      return
    }
    setSavingPhoto(true)
    setNotice('')
    setError('')
    try {
      const imageUrl = await uploadImage(file)
      const result = await apiRequest('/api/auth/profile/photo', {
        method: 'PUT',
        body: JSON.stringify({ image_url: imageUrl }),
      })
      setAccount(result.user)
      window.dispatchEvent(new CustomEvent('iconnect:profile-updated', { detail: result.user }))
      setNotice('Your profile photo was saved.')
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : 'Could not save your profile photo.')
    } finally {
      setSavingPhoto(false)
    }
  }

  async function saveProfile() {
    setNotice('')
    setError('')
    if (!name.trim() || !username.trim()) {
      setError('Add a display name and username before saving your profile.')
      return
    }

    setSavingProfile(true)
    try {
      const result = await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, username, bio, interests: selected }),
      })
      setAccount(result.user)
      setName(result.user.name)
      setUsername(result.user.username)
      setBio(result.user.bio)
      setSelected(result.user.interests)
      setNotice('Your profile was saved to your account.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function signOut(event) {
    event.preventDefault()
    setNotice('')
    setError('')
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
      navigate('/app/onboarding')
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Could not sign out. Try again.')
    }
  }

  async function updatePrivacy(key) {
    if (privacySaving) return
    setNotice('')
    setError('')
    setPrivacySaving(true)
    try {
      const next = { ...preferences, [key]: !preferences[key] }
      const result = await apiRequest('/api/auth/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          profile_visible: next.profileVisible,
          discoverable: next.discoverable,
        }),
      })
      setPreferences(result.preferences)
      setNotice('Privacy preference saved to your account.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not save that privacy preference.')
    } finally {
      setPrivacySaving(false)
    }
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR SPACE, YOUR SETTINGS" title="Profile & settings" description="Manage the profile and privacy preferences saved to your iConnect account." />
      <div className="account-status-banner"><Shield size={16} /> Profile details and photos are saved to your account. Notification delivery and external account connections are not available.</div>
      <div className="account-layout">
        <nav className="account-tabs" aria-label="Profile settings">
          {['Profile', 'Preferences', 'Privacy'].map((tab) => <button type="button" key={tab} onClick={() => { setActiveTab(tab); setNotice(''); setError('') }} className={activeTab === tab ? 'account-tab-active' : ''}>{tab}<ChevronRight size={15} /></button>)}
          <Link to="/app/onboarding" onClick={signOut}><LogOut size={15} /> Sign out</Link>
        </nav>
        <section className="account-content">
          <div className="account-section-heading">
            <h2>{activeTab === 'Profile' ? 'Your profile' : activeTab === 'Preferences' ? 'Your preferences' : 'Your privacy'}</h2>
            <p>{activeTab === 'Profile' ? 'Edit the profile details saved to your account.' : activeTab === 'Preferences' ? 'See which optional services are not connected.' : 'Control whether verified members can discover your profile.'}</p>
          </div>
          {accountLoading && <p className="connect-empty-state">Loading your account…</p>}
          {!accountLoading && !account && <p className="feed-interaction-notice feed-error" role="alert">{error || 'Your account could not be loaded.'}</p>}
          {!accountLoading && account && activeTab === 'Profile' && <>
            <div className="account-avatar-row">
              <Avatar person={{ name, image: account.image }} />
              <div><strong>{name}</strong><span>{account.email} · iConnect account</span></div>
              <label className="account-photo-button"><Camera size={13} />{savingPhoto ? 'Saving…' : account.image ? 'Change photo' : 'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseProfilePhoto} disabled={savingPhoto} /></label>
              {account.image && <button type="button" className="account-photo-remove" onClick={() => saveProfilePhoto(null)} disabled={savingPhoto} aria-label="Remove profile photo"><Trash2 size={13} /></button>}
            </div>
            <label className="account-field"><span>DISPLAY NAME</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>
            <label className="account-field"><span>USERNAME</span><input value={username} onChange={(event) => setUsername(event.target.value.replace(/^@/, ''))} maxLength={30} /></label>
            <label className="account-field"><span>BIO</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} maxLength={120} /></label>
            <div className="account-interest-heading"><strong>INTERESTS</strong><span>Choose topics for your profile</span></div>
            <div className="interest-chips">{interestOptions.map((interest) => <button type="button" className={selected.includes(interest) ? 'interest-chip selected' : 'interest-chip'} key={interest} onClick={() => toggleInterest(interest)} aria-pressed={selected.includes(interest)}>{interest}</button>)}</div>
            <button type="button" className="app-primary-button account-save" onClick={saveProfile} disabled={savingProfile}><Save size={15} /> {savingProfile ? 'Saving…' : 'Save changes'}</button>
          </>}
          {!accountLoading && account && activeTab === 'Preferences' && <div className="account-settings-list">
            <div className="account-settings-list-item"><span className="account-setting-icon"><Bell size={17} /></span><span><strong>In-app notifications</strong><small>Notification preferences and delivery are not connected.</small></span></div>
            <div className="account-settings-list-item"><span className="account-setting-icon"><Link2 size={17} /></span><span><strong>Connected accounts</strong><small>External social and identity providers are not connected.</small></span></div>
          </div>}
          {!accountLoading && account && activeTab === 'Privacy' && <div className="account-settings-list">
            <button type="button" onClick={() => updatePrivacy('profileVisible')} disabled={privacySaving}><span className="account-setting-icon"><Eye size={17} /></span><span><strong>Show my profile in Connect</strong><small>{preferences.profileVisible ? 'Your account profile appears in Connect' : 'Your account profile is hidden in Connect'}</small></span><span className={preferences.profileVisible ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={preferences.profileVisible ? 'On' : 'Off'} /></button>
            <button type="button" onClick={() => updatePrivacy('discoverable')} disabled={privacySaving}><span className="account-setting-icon"><UserRound size={17} /></span><span><strong>Include me in people search</strong><small>{preferences.discoverable ? 'Your account can appear in people search' : 'Your account is excluded from people search'}</small></span><span className={preferences.discoverable ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={preferences.discoverable ? 'On' : 'Off'} /></button>
            <div className="account-settings-list-item"><span className="account-setting-icon"><KeyRound size={17} /></span><span><strong>Password & security</strong><small>Password reset and account recovery are not available yet.</small></span></div>
            <div className="privacy-callout"><LockKeyhole size={17} /><p>Discovery settings are enforced by the iConnect API and affect people search and new conversations.</p></div>
          </div>}
          {error && account && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
          {notice && <p className="account-save-notice" role="status">{notice}</p>}
        </section>
      </div>
    </div>
  )
}
