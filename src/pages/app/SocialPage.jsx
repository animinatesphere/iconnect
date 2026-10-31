import React, { useEffect, useState } from 'react'
import { ArrowUpRight, Heart, MessageCircle, PenLine, Repeat2, Send, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoPosts } from '../../data/demoContent.js'
import { demoAvatar, getDemoProfile } from '../../utils/demoAccount.js'
import { getDemoAdminSettings } from '../../utils/demoAdmin.js'
import { emptyDemoFeedState, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'
import { createSocialPost, getSocialPosts, setSocialPostLike } from '../../utils/socialApi.js'

export default function SocialPage() {
  const profile = getDemoProfile()
  const author = { name: profile?.name ?? 'Taylor Reed', image: profile?.avatar ?? demoAvatar }
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [socialPosts, setSocialPosts] = useState([])
  const [caption, setCaption] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [likingPostIds, setLikingPostIds] = useState([])

  useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
      setEnabled(getDemoAdminSettings().socialEnabled)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load local social preview.')
    }
    getSocialPosts()
      .then(setSocialPosts)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load published posts.'))
  }, [])

  function saveState(nextState, message = '') {
    try {
      writeDemoFeedState(nextState)
      setFeedState(nextState)
      setError('')
      setNotice(message)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this browser demo action.')
    }
  }

  async function publishTextPost(event) {
    event.preventDefault()
    if (!enabled) {
      setError('Social posting is disabled by the local admin demo setting.')
      return
    }
    if (!caption.trim()) {
      setError('Write a short update before posting.')
      return
    }
    setPublishing(true)
    try {
      const post = await createSocialPost(caption.trim())
      setSocialPosts((current) => [post, ...current])
      setCaption('')
      setError('')
      setNotice('Your update was published to your account.')
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Your update could not be published.')
    } finally {
      setPublishing(false)
    }
  }

  async function toggleLike(post) {
    if (likingPostIds.includes(post.id)) return
    setLikingPostIds((current) => [...current, post.id])
    try {
      const updatedPost = await setSocialPostLike(post.id, !post.likedByMe)
      setSocialPosts((current) => current.map((item) => item.id === post.id ? updatedPost : item))
      setError('')
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : 'Could not update this like.')
    } finally {
      setLikingPostIds((current) => current.filter((id) => id !== post.id))
    }
  }

  function toggleList(post, key, message) {
    const list = feedState[key] ?? []
    const updatedList = list.includes(post.id) ? list.filter((id) => id !== post.id) : [...list, post.id]
    saveState({ ...feedState, [key]: updatedList }, message)
  }

  async function sharePost(post) {
    const url = `${window.location.origin}/app/post/${post.id}`
    try {
      if (navigator.share) await navigator.share({ title: `Update by ${post.name}`, text: post.text, url })
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url)
      else {
        setNotice(`Copy this post link: ${url}`)
        return
      }
      setNotice(post.isPersistent ? 'Link shared.' : 'Link shared. This preview post remains local to this demo.')
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      setError('Could not share the post. Copy its URL from your browser address bar.')
    }
  }

  const posts = [...socialPosts, ...feedState.posts, ...demoPosts].filter((post) => !feedState.hiddenPostIds.includes(post.id))

  return (
    <div className="app-content-width social-page">
      <AppPageHeader eyebrow="ICONNECT SOCIAL · PREVIEW" title="Short updates, real conversations." description="A text-first social feed concept inspired by familiar microblogging patterns." />
      <div className="social-preview-banner"><ShieldCheck size={16} /><span>Your text updates, likes, and replies are saved to your account. Sample posts and reposts are preview content; photo and video uploads are not connected yet.</span></div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {!enabled && <p className="money-disabled-note">Social features are disabled by the local admin demo setting.</p>}
      <section className="social-compose-card"><Avatar person={author} /><form onSubmit={publishTextPost}><textarea value={caption} onChange={(event) => { setCaption(event.target.value); setError('') }} placeholder="What’s happening in your corner?" maxLength={280} rows={3} disabled={!enabled || publishing} aria-label="Write a short update" /><div><span>{caption.length}/280</span><button type="submit" className="app-primary-button" disabled={!enabled || publishing || !caption.trim()}><PenLine size={14} /> {publishing ? 'Posting…' : 'Post update'}</button></div></form></section>
      <div className="social-feed-toolbar"><div><span className="app-page-eyebrow">YOUR FEED</span><h2>Latest updates</h2></div><Link to="/app/create">Add a photo or video <ArrowUpRight size={14} /></Link></div>
      <section className="social-post-list">{posts.map((post) => { const liked = post.isPersistent ? post.likedByMe : feedState.likedPostIds.includes(post.id); const reposted = (feedState.repostedPostIds ?? []).includes(post.id); return <article className="social-post-card" key={post.id}><Avatar person={{ name: post.name, image: post.avatar }} /><div className="social-post-body"><div className="social-post-author"><strong>{post.name}</strong><span>{post.handle} · {post.time === 'just now' ? 'just now' : `${post.time} ago`}</span></div><p>{post.text}</p>{post.image && <Link to={`/app/post/${post.id}`} className="social-post-media">{post.mediaType === 'video' ? <video src={post.image} controls playsInline preload="metadata" /> : <img src={post.image.startsWith('data:') ? post.image : `https://images.unsplash.com/${post.image}?auto=format&fit=crop&w=800&q=80`} alt="" loading="lazy" />}</Link>}<div className="social-post-actions"><button type="button" className={liked ? 'is-liked' : ''} onClick={() => post.isPersistent ? toggleLike(post) : toggleList(post, 'likedPostIds', liked ? 'Like removed.' : 'Update liked in this browser.')} aria-pressed={liked} disabled={post.isPersistent && likingPostIds.includes(post.id)}><Heart size={15} fill={liked ? 'currentColor' : 'none'} /> {post.likes + Number(!post.isPersistent && liked)}</button><Link to={`/app/post/${post.id}`}><MessageCircle size={15} /> {post.comments + (!post.isPersistent ? feedState.replies[post.id]?.length ?? 0 : 0)} replies</Link><button type="button" className={reposted ? 'is-reposted' : ''} onClick={() => toggleList(post, 'repostedPostIds', reposted ? 'Repost removed from this demo.' : 'Repost saved in this browser.')} aria-pressed={reposted}><Repeat2 size={15} /> {reposted ? 'Reposted' : 'Repost'}</button><button type="button" onClick={() => sharePost(post)}><Send size={14} /> Share</button></div></div></article>})}</section>
    </div>
  )
}
