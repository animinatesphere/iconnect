import React, { useEffect, useState } from 'react'
import { ArrowUpRight, Compass, Heart, MessageCircle, Search, Users } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoPeople } from '../../data/demoContent.js'
import { communities } from '../../data/siteContent.js'
import { readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'
import { getDemoPreferences, getDemoProfile } from '../../utils/demoAccount.js'
import { getPeople, setPersonFollow } from '../../utils/peopleApi.js'

export default function ConnectPage() {
  const location = useLocation()
  const [activeTab, setActiveTab] = useState(location.state?.activeTab ?? 'For you')
  const [following, setFollowing] = useState([])
  const [joined, setJoined] = useState([])
  const [search, setSearch] = useState(location.state?.search ?? '')
  const [followError, setFollowError] = useState('')
  const [notice, setNotice] = useState('')
  const [remotePeople, setRemotePeople] = useState([])
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [pendingFollows, setPendingFollows] = useState([])
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

  const normalizedSearch = search.trim().toLowerCase()

  useEffect(() => {
    let active = true
    if (normalizedSearch && normalizedSearch.length < 2) {
      setRemotePeople([])
      setLoadingPeople(false)
      return () => { active = false }
    }

    setLoadingPeople(true)
    const timeout = window.setTimeout(() => {
      getPeople({ query: normalizedSearch })
        .then((people) => {
          if (active) {
            setRemotePeople(people)
            setFollowError('')
          }
        })
        .catch((error) => {
          if (active) setFollowError(error instanceof Error ? error.message : 'Could not discover iConnect accounts.')
        })
        .finally(() => {
          if (active) setLoadingPeople(false)
        })
    }, normalizedSearch ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [normalizedSearch])

  useEffect(() => {
    if (location.state?.activeTab) setActiveTab(location.state.activeTab)
    if (location.state?.search !== undefined) setSearch(location.state.search)
  }, [location.key, location.state])

  async function toggleFollow(person) {
    if (person.isPersistent) {
      if (pendingFollows.includes(person.id)) return
      const following = !person.followedByMe
      setPendingFollows((current) => [...current, person.id])
      try {
        const result = await setPersonFollow(person.id, following)
        setRemotePeople((current) => current.map((item) => item.id === person.id
          ? {
            ...item,
            followedByMe: result.following,
            followerCount: result.followerCount,
            followingCount: result.followingCount,
          }
          : item))
        setFollowError('')
        setNotice(following ? `You’re now following ${person.name}.` : `You unfollowed ${person.name}.`)
      } catch (error) {
        setFollowError(error instanceof Error ? error.message : 'Could not update your follow.')
      } finally {
        setPendingFollows((current) => current.filter((id) => id !== person.id))
      }
      return
    }
    try {
      const state = readDemoFeedState()
      const followedHandles = state.followedHandles.includes(person.handle)
        ? state.followedHandles.filter((item) => item !== person.handle)
        : [...state.followedHandles, person.handle]
      writeDemoFeedState({ ...state, followedHandles })
      setFollowing(followedHandles)
      setNotice(followedHandles.includes(person.handle) ? `You followed ${person.name} in this preview.` : `You unfollowed ${person.name} in this preview.`)
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

  const discoveryPeople = [...remotePeople, ...demoPeople]
  if (profile && profilePreferences.profileVisible && profilePreferences.discoverable) {
    discoveryPeople.push({
      id: 'your-profile',
      name: profile.name,
      handle: `@${profile.username}`,
      avatar: profile.avatar,
      interests: profile.interests.join(' · ') || 'Finding my interests',
      note: profile.bio || 'New to iConnect.',
      isSelf: true,
    })
  }
  const visiblePeople = discoveryPeople.filter((person) => `${person.name} ${person.handle} ${person.interests} ${person.note}`.toLowerCase().includes(normalizedSearch))
  const visibleCommunities = communities.filter((community) => `${community.name} ${community.description}`.toLowerCase().includes(normalizedSearch))

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="FIND YOUR PEOPLE" title="Connect" description="Discover people and little corners around the things you love." />
      <div className="connect-demo-banner"><Users size={16} /><span>Verified iConnect accounts and follows are live. Sample profiles and community cards are illustrative.</span></div>
      {followError && <p className="feed-interaction-notice feed-error" role="alert">{followError}</p>}
      <label className="connect-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search interests, people, communities..." aria-label="Search people and communities" /></label>
      <div className="connect-tabs" role="tablist">{tabs.map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'connect-tab-active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {(activeTab === 'For you' || activeTab === 'People') && <section className="suggested-people-section"><div className="connect-section-heading"><div><span className="app-page-eyebrow">A FEW PEOPLE TO MEET</span><h2>Good people, shared interests.</h2></div><button type="button" onClick={() => setActiveTab('People')}>See all <ArrowUpRight size={14} /></button></div>{loadingPeople && <p className="connect-empty-state">Finding people to connect with…</p>}<div className="suggested-people-grid">{visiblePeople.map((person) => {
        const isFollowing = person.isPersistent ? person.followedByMe : following.includes(person.handle)
        const isPending = person.isPersistent && pendingFollows.includes(person.id)
        return <article className="suggested-person-card" key={person.id}><span className="person-cover" /><Avatar person={person} className="suggested-avatar" /><h3>{person.name}</h3><span className="suggested-handle">{person.handle}</span><p>{person.note}</p><div className="suggested-interests">{person.interests.split(' · ').filter(Boolean).map((interest) => <span key={interest}>{interest}</span>)}</div>{person.isSelf ? <button type="button" className="follow-button following" disabled>You</button> : <button type="button" className={isFollowing ? 'follow-button following' : 'follow-button'} onClick={() => toggleFollow(person)} aria-pressed={isFollowing} disabled={isPending}>{isPending ? 'Saving…' : isFollowing ? 'Following' : 'Follow'} <span>{isFollowing ? '✓' : '+'}</span></button>}</article>
      })}</div>{!loadingPeople && !visiblePeople.length && <p className="connect-empty-state">{search.length === 1 ? 'Enter at least two characters to search verified accounts.' : `No people match “${search}”. Try another name or interest.`}</p>}</section>}
      {(activeTab === 'For you' || activeTab === 'Communities') && <section className="suggested-communities-section"><div className="connect-section-heading"><div><span className="app-page-eyebrow">FIND YOUR CORNER</span><h2>Communities to wander into.</h2></div><Compass size={18} /></div><div className="suggested-communities-grid">{visibleCommunities.map((community) => <article className="suggested-community-card" key={community.name}><img src={`https://images.unsplash.com/${community.image}?auto=format&fit=crop&w=700&h=450&q=80`} alt="" loading="lazy" /><div><span>COMMUNITY CONCEPT</span><h3>{community.name}</h3><p>{community.description}</p><button type="button" className={joined.includes(community.name) ? 'joined-community-button' : ''} onClick={() => toggleCommunity(community.name)}>{joined.includes(community.name) ? 'Joined · Leave' : 'Join community'} <ArrowUpRight size={14} /></button></div></article>)}</div>{!visibleCommunities.length && <p className="connect-empty-state">No communities match “{search}”. Try another search.</p>}</section>}
      <div className="connect-safety-note"><Heart size={16} /><p><strong>Connection should feel good.</strong> Verified account discovery and follows are saved to your account. Community cards remain a preview.</p><MessageCircle size={16} /></div>
    </div>
  )
}
