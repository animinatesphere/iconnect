import React, { useState } from 'react'
import { Bell, ChevronRight, Eye, KeyRound, Link2, LockKeyhole, LogOut, Save, Shield, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoInterests } from '../../data/demoContent.js'
import { demoAvatar, endDemoSession, getDemoProfile, saveDemoProfile } from '../../utils/demoAccount.js'

const settings = [
  { title: 'Personal information', description: 'Name, bio, and profile photo', icon: UserRound },
  { title: 'Privacy & visibility', description: 'Who can find and connect with you', icon: Eye },
  { title: 'Notifications', description: 'Choose what you hear about', icon: Bell },
  { title: 'Connected accounts', description: 'Manage services linked to iConnect', icon: Link2 },
  { title: 'Security', description: 'Password and account protection', icon: KeyRound },
]

export default function AccountPage() {
  const [activeTab, setActiveTab] = useState('Profile')
  const [notice, setNotice] = useState('')
  const profile = getDemoProfile()
  const [name, setName] = useState(profile?.name ?? 'Taylor Reed')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [selected, setSelected] = useState(profile?.interests.length ? profile.interests : ['Design', 'Music', 'Reading'])

  function toggleInterest(interest) {
    setSelected((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest])
  }

  function saveProfile() {
    setNotice('')
    if (!name.trim()) {
      setNotice('Add a display name before saving your profile.')
      return
    }
    if (!profile) {
      setNotice('No demo profile is available in this browser. Sign up to create one.')
      return
    }

    try {
      saveDemoProfile({ name, email: profile.email, bio, interests: selected })
      setNotice('Saved to this browser’s demo profile.')
    } catch (storageError) {
      if (!(storageError instanceof DOMException)) throw storageError
      setNotice('This browser could not save your profile. Check your browser storage settings.')
    }
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR SPACE, YOUR SETTINGS" title="Profile & settings" description="A preview of how you might manage your iConnect profile." />
      <div className="account-demo-banner"><Shield size={16} /> Your demo profile is saved in this browser. Other settings are preview-only.</div>
      <div className="account-layout">
        <nav className="account-tabs" aria-label="Profile settings">{['Profile', 'Preferences', 'Privacy'].map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={activeTab === tab ? 'account-tab-active' : ''}>{tab}<ChevronRight size={15} /></button>)}<Link to="/app/onboarding" onClick={endDemoSession}><LogOut size={15} /> Exit demo</Link></nav>
        <section className="account-content">
          <div className="account-section-heading"><h2>{activeTab === 'Profile' ? 'Your profile' : activeTab === 'Preferences' ? 'Your preferences' : 'Your privacy'}</h2><p>{activeTab === 'Profile' ? 'Make your corner feel like you.' : activeTab === 'Preferences' ? 'Shape what iConnect brings closer.' : 'Your choices should stay in your hands.'}</p></div>
          {activeTab === 'Profile' && <><div className="account-avatar-row"><Avatar person={{ name, image: demoAvatar }} /><div><strong>{name}</strong><span>{profile?.email ?? '@taylor.reed'} · Demo profile</span></div><button disabled>Change photo</button></div><label className="account-field"><span>DISPLAY NAME</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label><label className="account-field"><span>USERNAME</span><input defaultValue={profile ? `@${profile.email.split('@')[0]}` : '@taylor.reed'} /></label><label className="account-field"><span>BIO</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} maxLength={120} /></label><div className="account-interest-heading"><strong>INTERESTS</strong><span>Choose topics for your feed</span></div><div className="interest-chips">{demoInterests.map((interest) => <button type="button" className={selected.includes(interest) ? 'interest-chip selected' : 'interest-chip'} key={interest} onClick={() => toggleInterest(interest)}>{interest}</button>)}</div><button className="app-primary-button account-save" onClick={saveProfile}><Save size={15} /> Save changes</button>{notice && <p className="account-save-notice" role="status">{notice}</p>}</>}
          {activeTab === 'Preferences' && <div className="account-settings-list">{settings.filter((item) => ['Notifications', 'Connected accounts'].includes(item.title)).map(({ title, description, icon: Icon }) => <button key={title} onClick={() => setNotice(`${title} controls will be part of the connected product.`)}><span className="account-setting-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={16} /></button>)}</div>}
          {activeTab === 'Privacy' && <div className="account-settings-list">{settings.filter((item) => ['Privacy & visibility', 'Security'].includes(item.title)).map(({ title, description, icon: Icon }) => <button key={title} onClick={() => setNotice(`${title} will be configurable in the product.`)}><span className="account-setting-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={16} /></button>)}<div className="privacy-callout"><LockKeyhole size={17} /><p>Connected accounts and private data need clear permissions and controls before launch.</p></div></div>}
        </section>
      </div>
    </div>
  )
}
