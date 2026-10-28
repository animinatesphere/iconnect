import React, { useState } from 'react'
import { ArrowUpRight, Compass, Heart, MessageCircle, Search, Users } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoPeople } from '../../data/demoContent.js'
import { communities } from '../../data/siteContent.js'

export default function ConnectPage() {
  const [activeTab, setActiveTab] = useState('For you')
  const [following, setFollowing] = useState([])
  const tabs = ['For you', 'People', 'Communities']

  function toggleFollow(id) {
    setFollowing((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="FIND YOUR PEOPLE" title="Connect" description="Discover people and little corners around the things you love." />
      <div className="connect-demo-banner"><Users size={16} /><span>Discovery concept · Profiles and communities below are illustrative.</span></div>
      <label className="connect-search"><Search size={17} /><input placeholder="Search interests, people, communities..." aria-label="Search people and communities" /></label>
      <div className="connect-tabs" role="tablist">{tabs.map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'connect-tab-active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
      {(activeTab === 'For you' || activeTab === 'People') && <section className="suggested-people-section"><div className="connect-section-heading"><div><span className="app-page-eyebrow">A FEW PEOPLE TO MEET</span><h2>Good people, shared interests.</h2></div><button onClick={() => setActiveTab('People')}>See all <ArrowUpRight size={14} /></button></div><div className="suggested-people-grid">{demoPeople.map((person) => <article className="suggested-person-card" key={person.id}><span className="person-cover" /><Avatar person={person} className="suggested-avatar" /><h3>{person.name}</h3><span className="suggested-handle">{person.handle}</span><p>{person.note}</p><div className="suggested-interests">{person.interests.split(' · ').map((interest) => <span key={interest}>{interest}</span>)}</div><button className={following.includes(person.id) ? 'follow-button following' : 'follow-button'} onClick={() => toggleFollow(person.id)}>{following.includes(person.id) ? 'Following' : 'Follow'} <span>{following.includes(person.id) ? '✓' : '+'}</span></button></article>)}</div></section>}
      {(activeTab === 'For you' || activeTab === 'Communities') && <section className="suggested-communities-section"><div className="connect-section-heading"><div><span className="app-page-eyebrow">FIND YOUR CORNER</span><h2>Communities to wander into.</h2></div><Compass size={18} /></div><div className="suggested-communities-grid">{communities.map((community) => <article className="suggested-community-card" key={community.name}><img src={`https://images.unsplash.com/${community.image}?auto=format&fit=crop&w=700&h=450&q=80`} alt="" loading="lazy" /><div><span>COMMUNITY CONCEPT</span><h3>{community.name}</h3><p>{community.description}</p><button onClick={(event) => { event.currentTarget.textContent = 'Coming later' }}>Explore space <ArrowUpRight size={14} /></button></div></article>)}</div></section>}
      <div className="connect-safety-note"><Heart size={16} /><p><strong>Connection should feel good.</strong> Profiles, matching, and community tools shown here are design concepts, not live services.</p><MessageCircle size={16} /></div>
    </div>
  )
}
