import React, { useEffect, useState } from 'react'
import { ArrowUpRight, Compass, Heart, MessageCircle, Search, Users } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoPeople } from '../../data/demoContent.js'
import { communities } from '../../data/siteContent.js'
import { readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'
import { getDemoPreferences, getDemoProfile } from '../../utils/demoAccount.js'

export default function ConnectPage() {
  const location = useLocation()
  const [activeTab, setActiveTab] = useState(location.state?.activeTab ?? 'For you')
  const [following, setFollowing] = useState([])
  const [joined, setJoined] = useState([])
  const [search, setSearch] = useState(location.state?.search ?? '')
  const [followError, setFollowError] = useState('')
  const [notice, setNotice] = useState('')
  const [profile, setProfile] = useState(null)
  const [profilePreferences, setProfilePreferences] = useState({ profileVisible: true, discoverable: true })
  const tabs = ['For you', 'People', 'Communities']

  useEffect(() => {
    try {
      const state = readDemoFeedState()
      setFollowing(state.followedHandles)
      setJoined(state.joinedCommunities)
      setProfile(getDemoProfile())
      setProfilePreferences({ profileVisible: true, discoverable: true, ...getDemoPreferences() })
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : 'Could not load your followed people.')
    }
  }, [])

  useEffect(() => {
    if (location.state?.activeTab) setActiveTab(location.state.activeTab)
    if (location.state?.search !== undefined) setSearch(location.state.search)
  }, [location.key, location.state])

  function toggleFollow(handle) {
    try {
      const state = readDemoFeedState()
      const followedHandles = state.followedHandles.includes(handle)
        ? state.followedHandles.filter((item) => item !== handle)
        : [...state.followedHandles, handle]
      writeDemoFeedState({ ...state, followedHandles })
      setFollowing(followedHandles)
      setFollowError('')
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : 'Could not update your followed people.')
    }
  }

  function toggleCommunity(name) {
    try {
      const state = readDemoFeedState()
      const joinedCommunities = state.joinedCommunities.includes(name)
        ? state.joinedCommunities.filter((item) => item !== name)
        : [...state.joinedCommunities, name]
      writeDemoFeedState({ ...state, joinedCommunities })
      setJoined(joinedCommunities)
      setNotice(joinedCommunities.includes(name) ? `You joined ${name}.` : `You left ${name}.`)
      setFollowError('')
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : 'Could not update your communities.')
    }
  }

  const normalizedSearch = search.trim().toLowerCase()
  const discoveryPeople = profile && profilePreferences.profileVisible && profilePreferences.discoverable
    ? [...demoPeople, {
      id: 'your-profile',
      name: profile.name,
      handle: `@${profile.username}`,
      avatar: profile.avatar,
      interests: profile.interests.join(' · ') || 'Finding my interests',
      note: profile.bio || 'New to iConnect.',
      isSelf: true,
    }]
    : demoPeople
  const visiblePeople = discoveryPeople.filter((person) => `${person.name} ${person.handle} ${person.interests} ${person.note}`.toLowerCase().includes(normalizedSearch))
  const visibleCommunities = communities.filter((community) => `${community.name} ${community.description}`.toLowerCase().includes(normalizedSearch))

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="FIND YOUR PEOPLE" title="Connect" description="Discover people and little corners around the things you love." />
      <div className="connect-demo-banner"><Users size={16} /><span>Discovery concept · Profiles and communities below are illustrative.</span></div>
      {followError && <p className="feed-interaction-notice feed-error" role="alert">{followError}</p>}
      <label className="connect-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search interests, people, communities..." aria-label="Search people and communities" /></label>
      <div className="connect-tabs" role="tablist">{tabs.map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'connect-tab-active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {(activeTab === 'For you' || activeTab === 'People') && <section className="suggested-people-section"><div className="connect-section-heading"><div><span className="app-page-eyebrow">A FEW PEOPLE TO MEET</span><h2>Good people, shared interests.</h2></div><button type="button" onClick={() => setActiveTab('People')}>See all <ArrowUpRight size={14} /></button></div><div className="suggested-people-grid">{visiblePeople.map((person) => <article className="suggested-person-card" key={person.id}><span className="person-cover" /><Avatar person={person} className="suggested-avatar" /><h3>{person.name}</h3><span className="suggested-handle">{person.handle}</span><p>{person.note}</p><div className="suggested-interests">{person.interests.split(' · ').filter(Boolean).map((interest) => <span key={interest}>{interest}</span>)}</div>{person.isSelf ? <button type="button" className="follow-button following" disabled>You</button> : <button type="button" className={following.includes(person.handle) ? 'follow-button following' : 'follow-button'} onClick={() => toggleFollow(person.handle)} aria-pressed={following.includes(person.handle)}>{following.includes(person.handle) ? 'Following' : 'Follow'} <span>{following.includes(person.handle) ? '✓' : '+'}</span></button>}</article>)}</div>{!visiblePeople.length && <p className="connect-empty-state">No people match “{search}”. Try another name or interest.</p>}</section>}
      {(activeTab === 'For you' || activeTab === 'Communities') && <section className="suggested-communities-section"><div className="connect-section-heading"><div><span className="app-page-eyebrow">FIND YOUR CORNER</span><h2>Communities to wander into.</h2></div><Compass size={18} /></div><div className="suggested-communities-grid">{visibleCommunities.map((community) => <article className="suggested-community-card" key={community.name}><img src={`https://images.unsplash.com/${community.image}?auto=format&fit=crop&w=700&h=450&q=80`} alt="" loading="lazy" /><div><span>COMMUNITY CONCEPT</span><h3>{community.name}</h3><p>{community.description}</p><button type="button" className={joined.includes(community.name) ? 'joined-community-button' : ''} onClick={() => toggleCommunity(community.name)}>{joined.includes(community.name) ? 'Joined · Leave' : 'Join community'} <ArrowUpRight size={14} /></button></div></article>)}</div>{!visibleCommunities.length && <p className="connect-empty-state">No communities match “{search}”. Try another search.</p>}</section>}
      <div className="connect-safety-note"><Heart size={16} /><p><strong>Connection should feel good.</strong> Profiles, matching, and community tools shown here are design concepts, not live services.</p><MessageCircle size={16} /></div>
    </div>
  )
}
