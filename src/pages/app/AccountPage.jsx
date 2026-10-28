import React, { useState } from 'react'
import { Bell, ChevronRight, Eye, KeyRound, Link2, LockKeyhole, LogOut, Save, Shield, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoInterests } from '../../data/demoContent.js'

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
  const [selected, setSelected] = useState(['Design', 'Music', 'Reading'])

  function toggleInterest(interest) {
    setSelected((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest])
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR SPACE, YOUR SETTINGS" title="Profile & settings" description="A preview of how you might manage your iConnect profile." />
      <div className="account-demo-banner"><Shield size={16} /> Your profile and settings are preview content only and are not saved.</div>
      <div className="account-layout">
        <nav className="account-tabs" aria-label="Profile settings">{['Profile', 'Preferences', 'Privacy'].map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={activeTab === tab ? 'account-tab-active' : ''}>{tab}<ChevronRight size={15} /></button>)}<Link to="/app/onboarding"><LogOut size={15} /> Exit demo</Link></nav>
        <section className="account-content">
          <div className="account-section-heading"><h2>{activeTab === 'Profile' ? 'Your profile' : activeTab === 'Preferences' ? 'Your preferences' : 'Your privacy'}</h2><p>{activeTab === 'Profile' ? 'Make your corner feel like you.' : activeTab === 'Preferences' ? 'Shape what iConnect brings closer.' : 'Your choices should stay in your hands.'}</p></div>
          {activeTab === 'Profile' && <><div className="account-avatar-row"><Avatar person={{ name: 'Taylor Reed', image: 'photo-1544005313-94ddf0286df2' }} /><div><strong>Taylor Reed</strong><span>@taylor.reed · Demo profile</span></div><button disabled>Change photo</button></div><label className="account-field"><span>DISPLAY NAME</span><input defaultValue="Taylor Reed" /></label><label className="account-field"><span>USERNAME</span><input defaultValue="@taylor.reed" /></label><label className="account-field"><span>BIO</span><textarea defaultValue="Curious by nature. Usually looking for a good playlist or a new walking route." rows={3} /></label><div className="account-interest-heading"><strong>INTERESTS</strong><span>Choose topics for your feed</span></div><div className="interest-chips">{demoInterests.map((interest) => <button type="button" className={selected.includes(interest) ? 'interest-chip selected' : 'interest-chip'} key={interest} onClick={() => toggleInterest(interest)}>{interest}</button>)}</div><button className="app-primary-button account-save" onClick={() => setNotice('Saved in the preview only. Nothing was sent or stored.')}><Save size={15} /> Save changes</button>{notice && <p className="account-save-notice" role="status">{notice}</p>}</>}
          {activeTab === 'Preferences' && <div className="account-settings-list">{settings.filter((item) => ['Notifications', 'Connected accounts'].includes(item.title)).map(({ title, description, icon: Icon }) => <button key={title} onClick={() => setNotice(`${title} controls will be part of the connected product.`)}><span className="account-setting-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={16} /></button>)}</div>}
          {activeTab === 'Privacy' && <div className="account-settings-list">{settings.filter((item) => ['Privacy & visibility', 'Security'].includes(item.title)).map(({ title, description, icon: Icon }) => <button key={title} onClick={() => setNotice(`${title} will be configurable in the product.`)}><span className="account-setting-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={16} /></button>)}<div className="privacy-callout"><LockKeyhole size={17} /><p>Connected accounts and private data need clear permissions and controls before launch.</p></div></div>}
        </section>
      </div>
    </div>
  )
}
