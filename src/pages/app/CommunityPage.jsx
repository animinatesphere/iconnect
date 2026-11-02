import React, { useEffect, useState } from 'react'
import { ArrowLeft, Camera, Image as ImageIcon, LockKeyhole, MoreHorizontal, Settings2, ShieldCheck, Users, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import {
  createCommunityPost,
  deleteCommunityPost,
  getCommunity,
  getCommunityJoinRequests,
  getCommunityMembers,
  getCommunityPosts,
  removeCommunityMember,
  reviewCommunityJoinRequest,
  setCommunityJoined,
  updateCommunity,
} from '../../utils/communityApi.js'
import { uploadImage } from '../../utils/mediaApi.js'

const maxImages = 5
const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp']

function formatCommunityDate(value) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function CommunityPage() {
  const { communityId } = useParams()
  const [community, setCommunity] = useState(null)
  const [posts, setPosts] = useState([])
  const [members, setMembers] = useState([])
  const [joinRequests, setJoinRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [joining, setJoining] = useState(false)
  const [postText, setPostText] = useState('')
  const [postImages, setPostImages] = useState([])
  const [postPreviews, setPostPreviews] = useState([])
  const [posting, setPosting] = useState(false)
  const [deletingPostId, setDeletingPostId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState({ name: '', description: '', rules: '', imageUrl: null, membersCanPost: true, membershipMode: 'open' })
  const [settingsImage, setSettingsImage] = useState(null)
  const [settingsImagePreview, setSettingsImagePreview] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState('')

  useEffect(() => {
    const previews = postImages.map((file) => URL.createObjectURL(file))
    setPostPreviews(previews)
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [postImages])

  useEffect(() => {
    if (!settingsImage) {
      setSettingsImagePreview('')
      return undefined
    }
    const preview = URL.createObjectURL(settingsImage)
    setSettingsImagePreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [settingsImage])

  useEffect(() => {
    let active = true
    setLoading(true)
    setCommunity(null)
    setPosts([])
    setMembers([])
    setJoinRequests([])
    setError('')
    getCommunity(communityId)
      .then(async (loadedCommunity) => {
        if (!active) return
        setCommunity(loadedCommunity)
        setSettings({
          name: loadedCommunity.name,
          description: loadedCommunity.description,
          rules: loadedCommunity.rules ?? '',
          imageUrl: loadedCommunity.imageUrl,
          membersCanPost: loadedCommunity.membersCanPost,
          membershipMode: loadedCommunity.membershipMode,
        })
        if (loadedCommunity.joinedByMe || loadedCommunity.isAdmin) {
          const [loadedPosts, loadedMembers, loadedRequests] = await Promise.all([
            getCommunityPosts(communityId),
            loadedCommunity.isAdmin ? getCommunityMembers(communityId) : Promise.resolve([]),
            loadedCommunity.isAdmin ? getCommunityJoinRequests(communityId) : Promise.resolve([]),
          ])
          if (active) {
            setPosts(loadedPosts)
            setMembers(loadedMembers)
            setJoinRequests(loadedRequests)
          }
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this community.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [communityId])

  async function toggleMembership() {
    if (!community || joining) return
    setJoining(true)
    setError('')
    setNotice('')
    try {
      const joining = !community.joinedByMe && !community.joinRequestedByMe
      const updated = await setCommunityJoined(community.id, joining)
      setCommunity(updated)
      if (updated.joinedByMe) {
        setPosts(await getCommunityPosts(updated.id))
        setNotice(`You joined ${updated.name}. You can now post in the group.`)
      } else if (updated.joinRequestedByMe) {
        setNotice(`Your request to join ${updated.name} was sent to the creator.`)
      } else {
        setPosts([])
        setNotice(community.joinRequestedByMe
          ? `Your request to join ${updated.name} was cancelled.`
          : `You left ${updated.name}.`)
      }
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not update your membership.')
    } finally {
      setJoining(false)
    }
  }

  function choosePostImages(event) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length + postImages.length > maxImages) {
      setError(`Choose up to ${maxImages} images for one post.`)
      return
    }
    if (selected.some((file) => !acceptedImageTypes.includes(file.type))) {
      setError('Use JPEG, PNG, or WebP images.')
      return
    }
    setPostImages((current) => [...current, ...selected])
    setError('')
  }

  async function publishPost(event) {
    event.preventDefault()
    if (!community || posting || !postText.trim()) return
    setPosting(true)
    setError('')
    try {
      const imageUrls = []
      for (const image of postImages) imageUrls.push(await uploadImage(image))
      const post = await createCommunityPost(community.id, postText.trim(), imageUrls)
      setPosts((current) => [post, ...current])
      setPostText('')
      setPostImages([])
      setNotice('Your post was shared with the community.')
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : 'Your post could not be published.')
    } finally {
      setPosting(false)
    }
  }

  async function removePost(post) {
    if (deletingPostId || !window.confirm('Delete this community post? This cannot be undone.')) return
    setDeletingPostId(post.id)
    setError('')
    try {
      await deleteCommunityPost(community.id, post.id)
      setPosts((current) => current.filter((item) => item.id !== post.id))
      setNotice('The post was deleted.')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The post could not be deleted.')
    } finally {
      setDeletingPostId('')
    }
  }

  async function saveSettings(event) {
    event.preventDefault()
    if (!community || savingSettings) return
    setSavingSettings(true)
    setError('')
    try {
      const imageUrl = settingsImage ? await uploadImage(settingsImage) : settings.imageUrl
      const updated = await updateCommunity(community.id, { ...settings, imageUrl })
      setCommunity(updated)
      setSettings({
        name: updated.name,
        description: updated.description,
        rules: updated.rules,
        imageUrl: updated.imageUrl,
        membersCanPost: updated.membersCanPost,
        membershipMode: updated.membershipMode,
      })
      setSettingsImage(null)
      setSettingsOpen(false)
      setNotice('Community settings were updated.')
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Community settings could not be saved.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function kickMember(member) {
    if (removingMemberId || !window.confirm(`Remove @${member.username} from this community?`)) return
    setRemovingMemberId(member.id)
    setError('')
    try {
      await removeCommunityMember(community.id, member.id)
      setMembers((current) => current.filter((item) => item.id !== member.id))
      setCommunity((current) => ({ ...current, memberCount: Math.max(0, current.memberCount - 1) }))
      setNotice(`@${member.username} was removed from the community.`)
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'The member could not be removed.')
    } finally {
      setRemovingMemberId('')
    }
  }

  async function reviewRequest(member, approved) {
    setRemovingMemberId(member.id)
    setError('')
    try {
      await reviewCommunityJoinRequest(community.id, member.id, approved)
      setJoinRequests((current) => current.filter((request) => request.id !== member.id))
      setCommunity((current) => ({
        ...current,
        memberCount: current.memberCount + Number(approved),
        pendingRequestCount: Math.max(0, current.pendingRequestCount - 1),
      }))
      if (approved) {
        setMembers((current) => [...current, { ...member, isOwner: false }])
        setNotice(`@${member.username} was approved to join.`)
      } else {
        setNotice(`@${member.username}'s request was declined.`)
      }
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The join request could not be reviewed.')
    } finally {
      setRemovingMemberId('')
    }
  }

  if (loading) {
    return <div className="app-content-width"><p className="community-page-loading" role="status">Opening your community…</p></div>
  }

  if (!community) {
    return <div className="app-content-width"><Link to="/app/connect" className="app-back-link"><ArrowLeft size={15} /> Back to Connect</Link><section className="feed-empty-state"><h2>Community unavailable</h2><p>{error || 'This community could not be found.'}</p></section></div>
  }

  const canPost = community.isAdmin || (community.joinedByMe && community.membersCanPost)

  return (
    <div className="app-content-width community-page">
      <Link to="/app/connect" className="app-back-link"><ArrowLeft size={15} /> Back to communities</Link>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <section className="community-hero">
        {community.imageUrl ? <img src={community.imageUrl} alt="" /> : <div className="community-hero-placeholder"><Users size={42} /></div>}
        <div className="community-hero-overlay" />
        <div className="community-hero-content">
          <span className="app-page-eyebrow">iCONNECT COMMUNITY</span>
          <h1>{community.name}</h1>
          <p>{community.description}</p>
          <div className="community-hero-meta"><span><Users size={14} /> {community.memberCount} {community.memberCount === 1 ? 'member' : 'members'}</span><span><ShieldCheck size={14} /> Created by @{community.ownerUsername}</span></div>
          <div className="community-hero-actions">
            {!community.isAdmin && <button type="button" className="app-primary-button" onClick={toggleMembership} disabled={joining}>{joining ? 'Updating…' : community.joinedByMe ? 'Leave community' : community.joinRequestedByMe ? 'Cancel join request' : community.membershipMode === 'approval' ? 'Request to join' : 'Join community'}</button>}
            {community.isAdmin && <button type="button" className="community-settings-button" onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={15} /> {settingsOpen ? 'Close settings' : 'Manage community'}</button>}
          </div>
        </div>
      </section>
      {community.rules && <section className="community-rules-card"><div><ShieldCheck size={18} /><h2>Group rules</h2></div><p>{community.rules}</p></section>}
      {settingsOpen && community.isAdmin && <section className="community-admin-panel">
        <div className="community-panel-heading"><div><span className="app-page-eyebrow">CREATOR CONTROLS</span><h2>Community settings</h2></div><Settings2 size={18} /></div>
        <form className="community-settings-form" onSubmit={saveSettings}>
          <label>Community name<input value={settings.name} maxLength={80} required onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Description<textarea value={settings.description} maxLength={500} required rows={3} onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>Group rules<textarea value={settings.rules} maxLength={2000} rows={4} placeholder="Share the guidelines members should follow." onChange={(event) => setSettings((current) => ({ ...current, rules: event.target.value }))} /></label>
          <label>Who can join?<select value={settings.membershipMode} onChange={(event) => setSettings((current) => ({ ...current, membershipMode: event.target.value }))}><option value="open">Anyone can join</option><option value="approval">Approve requests to join</option></select></label>
          <label className="media-upload-picker"><Camera size={16} /><span>Change community cover photo</span><small>{settingsImage?.name ?? 'JPEG, PNG or WebP'}</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (!acceptedImageTypes.includes(file.type)) {
              setError('Choose a JPEG, PNG, or WebP photo.')
              return
            }
            setSettingsImage(file)
            setError('')
          }} disabled={savingSettings} /></label>
          {(settingsImagePreview || settings.imageUrl) && <img className="community-settings-preview" src={settingsImagePreview || settings.imageUrl} alt="Community cover preview" />}
          <label className="community-posting-setting"><input type="checkbox" checked={settings.membersCanPost} onChange={(event) => setSettings((current) => ({ ...current, membersCanPost: event.target.checked }))} /><span><strong>Members can create posts</strong><small>Turn this off to limit posting to you.</small></span></label>
          <button type="submit" className="app-primary-button" disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save settings'}</button>
        </form>
        <div className="community-member-management">
          {!!joinRequests.length && <><div className="community-panel-heading"><h3>Join requests</h3><span>{joinRequests.length}</span></div>{joinRequests.map((member) => <div className="community-member-row" key={`request-${member.id}`}><Avatar person={{ name: member.name, image: member.image }} /><span><strong>{member.name}</strong><small>@{member.username} · Requested {formatCommunityDate(member.requestedAt)}</small></span><button type="button" onClick={() => reviewRequest(member, true)} disabled={removingMemberId === member.id}>Approve</button><button type="button" onClick={() => reviewRequest(member, false)} disabled={removingMemberId === member.id}>Decline</button></div>)}</>}
          <div className="community-panel-heading"><h3>Members</h3><span>{community.memberCount}</span></div>{members.map((member) => <div className="community-member-row" key={member.id}><Avatar person={{ name: member.name, image: member.image }} /><span><strong>{member.name}</strong><small>@{member.username}{member.isOwner ? ' · Creator' : ''}</small></span>{!member.isOwner && <button type="button" onClick={() => kickMember(member)} disabled={removingMemberId === member.id}>{removingMemberId === member.id ? 'Removing…' : 'Remove'}</button>}</div>)}
        </div>
      </section>}
      {community.joinedByMe || community.isAdmin ? <>
        {canPost ? <form className="community-post-composer" onSubmit={publishPost}>
          <div className="community-post-composer-heading"><Avatar person={{ name: 'You' }} /><span><strong>Share with the group</strong><small>Post an update for {community.name}</small></span></div>
          <textarea value={postText} maxLength={500} rows={4} required placeholder="What would you like to share with this community?" onChange={(event) => setPostText(event.target.value)} />
          {postImages.length > 0 && <div className="community-image-previews">{postImages.map((image, index) => <div key={`${image.name}-${image.lastModified}-${index}`}><img src={postPreviews[index]} alt={`Selected group post photo ${index + 1}`} /><button type="button" onClick={() => setPostImages((current) => current.filter((_, imageIndex) => index !== imageIndex))} aria-label={`Remove photo ${index + 1}`} disabled={posting}><X size={14} /></button></div>)}</div>}
          <div className="community-composer-footer"><label className="community-add-photo"><ImageIcon size={16} /> Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={choosePostImages} disabled={posting || postImages.length >= maxImages} /></label><small>{postText.length}/500 · {postImages.length}/{maxImages} photos</small><button type="submit" className="app-primary-button" disabled={posting || !postText.trim()}>{posting ? 'Sharing…' : 'Post'}</button></div>
        </form> : <div className="community-posting-locked"><LockKeyhole size={17} /><span>The creator has limited posting to admins. You can still read the group feed.</span></div>}
        <section className="community-feed-section">
          <div className="community-feed-heading"><div><span className="app-page-eyebrow">THE CONVERSATION</span><h2>Community posts</h2></div><span>{posts.length} {posts.length === 1 ? 'post' : 'posts'}</span></div>
          {!posts.length ? <div className="feed-empty-state"><h2>Start the conversation</h2><p>Share the first update with this community.</p></div> : <div className="community-feed">{posts.map((post) => <article className="community-post-card" key={post.id}>
            <header><Avatar person={{ name: post.author.name, image: post.author.image }} /><div><strong>{post.author.name}</strong><small>@{post.author.username} · {formatCommunityDate(post.createdAt)}</small></div>{post.canDelete && <button type="button" aria-label="Delete post" title={community.isAdmin && !post.isMine ? 'Remove post as community creator' : 'Delete your post'} onClick={() => removePost(post)} disabled={deletingPostId === post.id}><MoreHorizontal size={19} /></button>}</header>
            <p>{post.text}</p>
            {!!post.imageUrls?.length && <div className={`community-post-images community-post-images-${Math.min(post.imageUrls.length, 3)}`}>{post.imageUrls.map((image, index) => <img src={image} alt={`Community post photo ${index + 1}`} loading="lazy" key={`${image}-${index}`} />)}</div>}
          </article>)}</div>}
        </section>
      </> : <section className="community-join-prompt"><Users size={24} /><h2>{community.joinRequestedByMe ? 'Request pending' : 'Join the conversation'}</h2><p>{community.joinRequestedByMe ? 'The group creator will review your request. You can cancel it at any time.' : 'Become a member to see the community feed and share your own posts.'}</p><button type="button" className="app-primary-button" onClick={toggleMembership} disabled={joining}>{joining ? 'Updating…' : community.joinRequestedByMe ? 'Cancel request' : community.membershipMode === 'approval' ? 'Request to join' : 'Join community'}</button></section>}
    </div>
  )
}
