import React, { useEffect, useState } from 'react'
import { ArrowUpRight, Compass, Heart, MessageCircle, Plus, Search, Users } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { createCommunity, getCommunities, setCommunityJoined } from '../../utils/communityApi.js'
import { getPeople, setPersonFollow } from '../../utils/peopleApi.js'
import { openConversation } from '../../utils/messageApi.js'

export default function ConnectPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(location.state?.activeTab ?? 'For you')
  const [search, setSearch] = useState(location.state?.search ?? '')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [people, setPeople] = useState([])
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [communities, setCommunities] = useState([])
  const [loadingCommunities, setLoadingCommunities] = useState(true)
  const [communityError, setCommunityError] = useState('')
  const [communityDraft, setCommunityDraft] = useState({ name: '', description: '' })
  const [communityFormOpen, setCommunityFormOpen] = useState(false)
  const [creatingCommunity, setCreatingCommunity] = useState(false)
  const [pendingCommunityIds, setPendingCommunityIds] = useState([])
  const [pendingFollows, setPendingFollows] = useState([])
  const [pendingMessages, setPendingMessages] = useState([])
  const tabs = ['For you', 'People', 'Communities']
  const normalizedSearch = search.trim().toLowerCase()

  useEffect(() => {
    if (location.state?.activeTab) setActiveTab(location.state.activeTab)
    if (location.state?.search !== undefined) setSearch(location.state.search)
  }, [location.key, location.state])

  useEffect(() => {
    let active = true
    if (normalizedSearch && normalizedSearch.length < 2) {
      setPeople([])
      setLoadingPeople(false)
      return () => { active = false }
    }

    setLoadingPeople(true)
    const timeout = window.setTimeout(() => {
      getPeople({ query: normalizedSearch })
        .then((loadedPeople) => {
          if (active) {
            setPeople(loadedPeople)
            setError('')
          }
        })
        .catch((loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not discover iConnect accounts.')
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
    let active = true
    if (normalizedSearch && normalizedSearch.length < 2) {
      setCommunities([])
      setCommunityError('')
      setLoadingCommunities(false)
      return () => { active = false }
    }

    setLoadingCommunities(true)
    const timeout = window.setTimeout(() => {
      getCommunities({ query: normalizedSearch })
        .then((loadedCommunities) => {
          if (active) {
            setCommunities(loadedCommunities)
            setCommunityError('')
          }
        })
        .catch((loadError) => {
          if (active) setCommunityError(loadError instanceof Error ? loadError.message : 'Could not load communities.')
        })
        .finally(() => {
          if (active) setLoadingCommunities(false)
        })
    }, normalizedSearch ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [normalizedSearch])

  async function toggleFollow(person) {
    if (pendingFollows.includes(person.id)) return
    const following = !person.followedByMe
    setPendingFollows((current) => [...current, person.id])
    try {
      const result = await setPersonFollow(person.id, following)
      setPeople((current) => current.map((item) => item.id === person.id
        ? {
          ...item,
          followedByMe: result.following,
          followerCount: result.followerCount,
          followingCount: result.followingCount,
        }
        : item))
      setError('')
      setNotice(following ? `You’re now following ${person.name}.` : `You unfollowed ${person.name}.`)
    } catch (followError) {
      setError(followError instanceof Error ? followError.message : 'Could not update your follow.')
    } finally {
      setPendingFollows((current) => current.filter((id) => id !== person.id))
    }
  }

  async function messagePerson(person) {
    if (pendingMessages.includes(person.id)) return
    setPendingMessages((current) => [...current, person.id])
    try {
      const conversationId = await openConversation(person.id)
      navigate('/app/chat', { state: { conversationId } })
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : 'Could not open a conversation.')
    } finally {
      setPendingMessages((current) => current.filter((id) => id !== person.id))
    }
  }

  async function submitCommunity(event) {
    event.preventDefault()
    setCreatingCommunity(true)
    setError('')
    try {
      const community = await createCommunity(communityDraft)
      setCommunities((current) => [community, ...current.filter((item) => item.id !== community.id)])
      setCommunityDraft({ name: '', description: '' })
      setCommunityFormOpen(false)
      setNotice(`You created ${community.name} and joined its membership.`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create this community.')
    } finally {
      setCreatingCommunity(false)
    }
  }

  async function toggleCommunity(community) {
    if (pendingCommunityIds.includes(community.id)) return
    setPendingCommunityIds((current) => [...current, community.id])
    try {
      const updated = await setCommunityJoined(community.id, !community.joinedByMe)
      setCommunities((current) => current.map((item) => item.id === updated.id ? updated : item))
      setError('')
      setNotice(updated.joinedByMe ? `You joined ${community.name}.` : `You left ${community.name}.`)
    } catch (membershipError) {
      setError(membershipError instanceof Error ? membershipError.message : 'Could not update your community membership.')
    } finally {
      setPendingCommunityIds((current) => current.filter((id) => id !== community.id))
    }
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="FIND YOUR PEOPLE" title="Connect" description="Discover verified iConnect members, follow their updates, or start a private conversation." />
      <div className="connect-demo-banner"><Users size={16} /><span>People, follows, private messages, communities, and membership use your iConnect account.</span></div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      <label className="connect-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search verified people by name or interest" aria-label="Search verified people" /></label>
      <div className="connect-tabs" role="tablist">{tabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'connect-tab-active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {(activeTab === 'For you' || activeTab === 'People') && <section className="suggested-people-section">
        <div className="connect-section-heading"><div><span className="app-page-eyebrow">VERIFIED MEMBERS</span><h2>Good people, shared interests.</h2></div><button type="button" onClick={() => setActiveTab('People')}>See all <ArrowUpRight size={14} /></button></div>
        {loadingPeople && <p className="connect-empty-state">Finding people to connect with…</p>}
        {!loadingPeople && people.length > 0 && <div className="suggested-people-grid">{people.map((person) => {
          const isPending = pendingFollows.includes(person.id)
          const isMessaging = pendingMessages.includes(person.id)
          return <article className="suggested-person-card" key={person.id}><span className="person-cover" /><Avatar person={person} className="suggested-avatar" /><h3>{person.name}</h3><span className="suggested-handle">{person.handle}</span><p>{person.note}</p><div className="suggested-interests">{person.interests.split(' · ').filter(Boolean).map((interest) => <span key={interest}>{interest}</span>)}</div><div className="connect-person-actions"><button type="button" className={person.followedByMe ? 'follow-button following' : 'follow-button'} onClick={() => toggleFollow(person)} aria-pressed={person.followedByMe} disabled={isPending}>{isPending ? 'Saving…' : person.followedByMe ? 'Following' : 'Follow'} <span>{person.followedByMe ? '✓' : '+'}</span></button><button type="button" className="connect-message-button" onClick={() => messagePerson(person)} disabled={isMessaging}><MessageCircle size={14} />{isMessaging ? 'Opening…' : 'Message'}</button></div></article>
        })}</div>}
        {!loadingPeople && !people.length && <p className="connect-empty-state">{search.length === 1 ? 'Enter at least two characters to search verified accounts.' : `No verified people match “${search}”. Try another name or interest.`}</p>}
      </section>}
      {(activeTab === 'For you' || activeTab === 'Communities') && <section className="connect-communities-section">
        <div className="connect-section-heading"><div><span className="app-page-eyebrow">FIND YOUR CORNER</span><h2>Communities</h2></div><button type="button" className="connect-create-community" onClick={() => setCommunityFormOpen((open) => !open)}><Plus size={14} /> {communityFormOpen ? 'Close form' : 'Create community'}</button></div>
        {communityFormOpen && <form className="connect-community-form" onSubmit={submitCommunity}><label>Community name<input value={communityDraft.name} onChange={(event) => setCommunityDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} required /></label><label>Description<textarea value={communityDraft.description} onChange={(event) => setCommunityDraft((current) => ({ ...current, description: event.target.value }))} maxLength={500} rows={3} required /></label><button type="submit" className="app-primary-button" disabled={creatingCommunity}>{creatingCommunity ? 'Creating…' : 'Create community'}</button></form>}
        {communityError && <p className="feed-interaction-notice feed-error" role="alert">{communityError}</p>}
        {loadingCommunities && <p className="connect-empty-state">Loading communities…</p>}
        {!loadingCommunities && !communityError && communities.length > 0 && <div className="connect-community-list">{communities.map((community) => <article key={community.id}><span className="connect-community-icon"><Compass size={18} /></span><div><h3>{community.name}</h3><p>{community.description}</p><small>{community.memberCount} {community.memberCount === 1 ? 'member' : 'members'} · Created {new Date(community.createdAt).toLocaleDateString()}</small></div><button type="button" className={community.joinedByMe ? 'joined-community-button' : 'connect-community-join'} onClick={() => toggleCommunity(community)} disabled={pendingCommunityIds.includes(community.id)}>{pendingCommunityIds.includes(community.id) ? 'Saving…' : community.joinedByMe ? 'Leave' : 'Join'}</button></article>)}</div>}
        {!loadingCommunities && !communityError && communities.length === 0 && <p className="connect-empty-state">{search.length === 1 ? 'Enter at least two characters to search communities.' : `No communities match “${search}”. Create one to get started.`}</p>}
        {activeTab === 'For you' && <button type="button" onClick={() => setActiveTab('Communities')}>See communities <ArrowUpRight size={14} /></button>}
      </section>}
      <div className="connect-safety-note"><Heart size={16} /><p><strong>Connection should feel good.</strong> Verified account discovery and follows respect each member’s privacy settings. Private conversations open in Messages.</p><MessageCircle size={16} /></div>
    </div>
  )
}
