import React, { useRef, useState } from 'react'
import { Bell, ChevronRight, Eye, KeyRound, Link2, LockKeyhole, LogOut, Save, Shield, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoInterests } from '../../data/demoContent.js'
import { demoAvatar, endDemoSession, getDemoPreferences, getDemoProfile, saveDemoPreferences, saveDemoProfile } from '../../utils/demoAccount.js'

const defaultPreferences = { notifications: true, profileVisible: true, discoverable: true }

export default function AccountPage() {
  const [activeTab, setActiveTab] = useState('Profile')
  const [notice, setNotice] = useState('')
  const profile = getDemoProfile()
  const [name, setName] = useState(profile?.name ?? 'Taylor Reed')
  const [username, setUsername] = useState(profile?.username ?? 'taylor.reed')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [avatar, setAvatar] = useState(profile?.avatar ?? demoAvatar)
  const [selected, setSelected] = useState(profile?.interests.length ? profile.interests : ['Design', 'Music', 'Reading'])
  const [preferences, setPreferences] = useState(defaultPreferences)
  const photoInput = useRef(null)

  React.useEffect(() => {
    try {
      setPreferences({ ...defaultPreferences, ...getDemoPreferences() })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load your local preferences.')
    }
  }, [])

  function toggleInterest(interest) {
    setSelected((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest])
  }

  function saveProfile() {
    setNotice('')
    if (!name.trim() || !username.trim()) {
      setNotice('Add a display name and username before saving your profile.')
      return
    }
    if (!profile) {
      setNotice('No demo profile is available in this browser. Sign up to create one.')
      return
    }

    try {
      saveDemoProfile({ name, username, email: profile.email, bio, interests: selected, avatar })
      setNotice('Your profile was saved in this browser.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This browser could not save your profile.')
    }
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 500_000) {
      setNotice('Choose an image under 500 KB for your demo profile photo.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setNotice('This image could not be previewed. Try another image.')
        return
      }
      setAvatar(reader.result)
      setNotice('Photo preview updated. Save changes to keep it in this browser.')
    }
    reader.onerror = () => setNotice('This image could not be read. Try another image.')
    reader.readAsDataURL(file)
  }

  function updatePreferences(key) {
    const next = { ...preferences, [key]: !preferences[key] }
    try {
      saveDemoPreferences(next)
      setPreferences(next)
      setNotice('Preference saved in this browser.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This browser could not save that preference.')
    }
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR SPACE, YOUR SETTINGS" title="Profile & settings" description="Manage your local demo profile and preferences." />
      <div className="account-demo-banner"><Shield size={16} /> Profile and preferences are saved only in this browser. No password is stored.</div>
      <div className="account-layout">
        <nav className="account-tabs" aria-label="Profile settings">
          {['Profile', 'Preferences', 'Privacy'].map((tab) => <button type="button" key={tab} onClick={() => { setActiveTab(tab); setNotice('') }} className={activeTab === tab ? 'account-tab-active' : ''}>{tab}<ChevronRight size={15} /></button>)}
          <Link to="/app/onboarding" onClick={endDemoSession}><LogOut size={15} /> Exit demo</Link>
        </nav>
        <section className="account-content">
          <div className="account-section-heading">
            <h2>{activeTab === 'Profile' ? 'Your profile' : activeTab === 'Preferences' ? 'Your preferences' : 'Your privacy'}</h2>
            <p>{activeTab === 'Profile' ? 'Make your corner feel like you.' : activeTab === 'Preferences' ? 'Shape your local demo experience.' : 'Control what your preview profile displays.'}</p>
          </div>
          {activeTab === 'Profile' && <>
            <div className="account-avatar-row">
              <Avatar person={{ name, image: avatar }} />
              <div><strong>{name}</strong><span>{profile?.email ?? '@taylor.reed'} · Demo profile</span></div>
              <input ref={photoInput} className="create-image-input" type="file" accept="image/*" onChange={choosePhoto} />
              <button type="button" onClick={() => photoInput.current?.click()}>Change photo</button>
            </div>
            <label className="account-field"><span>DISPLAY NAME</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>
            <label className="account-field"><span>USERNAME</span><input value={username} onChange={(event) => setUsername(event.target.value.replace(/^@/, ''))} maxLength={30} /></label>
            <label className="account-field"><span>BIO</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} maxLength={120} /></label>
            <div className="account-interest-heading"><strong>INTERESTS</strong><span>Choose topics for your feed</span></div>
            <div className="interest-chips">{demoInterests.map((interest) => <button type="button" className={selected.includes(interest) ? 'interest-chip selected' : 'interest-chip'} key={interest} onClick={() => toggleInterest(interest)} aria-pressed={selected.includes(interest)}>{interest}</button>)}</div>
            <button type="button" className="app-primary-button account-save" onClick={saveProfile}><Save size={15} /> Save changes</button>
          </>}
          {activeTab === 'Preferences' && <div className="account-settings-list">
            <button type="button" onClick={() => updatePreferences('notifications')}><span className="account-setting-icon"><Bell size={17} /></span><span><strong>In-app notifications</strong><small>{preferences.notifications ? 'Enabled for this demo' : 'Muted in this demo'}</small></span><span className={preferences.notifications ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={preferences.notifications ? 'On' : 'Off'} /></button>
            <div className="account-settings-list-item"><span className="account-setting-icon"><Link2 size={17} /></span><span><strong>Connected accounts</strong><small>External services are not connected in this preview.</small></span></div>
          </div>}
          {activeTab === 'Privacy' && <div className="account-settings-list">
            <button type="button" onClick={() => updatePreferences('profileVisible')}><span className="account-setting-icon"><Eye size={17} /></span><span><strong>Show profile in this demo</strong><small>{preferences.profileVisible ? 'Visible on your local profile preview' : 'Hidden in your local profile preview'}</small></span><span className={preferences.profileVisible ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={preferences.profileVisible ? 'On' : 'Off'} /></button>
            <button type="button" onClick={() => updatePreferences('discoverable')}><span className="account-setting-icon"><UserRound size={17} /></span><span><strong>Discoverable in this demo</strong><small>{preferences.discoverable ? 'Shown in local discovery previews' : 'Excluded from local discovery previews'}</small></span><span className={preferences.discoverable ? 'preference-toggle is-on' : 'preference-toggle'} aria-label={preferences.discoverable ? 'On' : 'Off'} /></button>
            <div className="account-settings-list-item"><span className="account-setting-icon"><KeyRound size={17} /></span><span><strong>Password & security</strong><small>Demo passwords are never saved or verified.</small></span></div>
            <div className="privacy-callout"><LockKeyhole size={17} /><p>These controls affect this browser demo only; they do not change a public or server-side account.</p></div>
          </div>}
          {notice && <p className="account-save-notice" role="status">{notice}</p>}
        </section>
      </div>
    </div>
  )
}
