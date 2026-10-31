import React, { useEffect, useState } from 'react'
import { ArrowUpRight, Heart, MessageCircle, PenLine, Send } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { apiRequest } from '../../utils/api.js'
import { openConversation } from '../../utils/messageApi.js'
import { createSocialPost, getSocialPosts, resolveFeedImageUrl, setSocialPostLike } from '../../utils/socialApi.js'

export default function SocialPage() {
  const [currentUser, setCurrentUser] = useState(null)
  const author = { name: currentUser?.name ?? 'You' }
  const [socialPosts, setSocialPosts] = useState([])
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryLoad, setRetryLoad] = useState(0)
  const [caption, setCaption] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [likingPostIds, setLikingPostIds] = useState([])
  const [messagingAuthorIds, setMessagingAuthorIds] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    apiRequest('/api/auth/me')
      .then(({ user }) => { if (active) setCurrentUser(user) })
      .catch(() => { if (active) setCurrentUser(null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setLoadingPosts(true)
    setLoadError('')
    getSocialPosts()
      .then((posts) => {
        if (active) {
          setSocialPosts(posts)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) {
          const message = loadError instanceof Error ? loadError.message : 'Could not load published posts.'
          setLoadError(message)
          setError(message)
        }
      })
      .finally(() => {
        if (active) setLoadingPosts(false)
      })
    return () => { active = false }
  }, [retryLoad])

  async function publishTextPost(event) {
    event.preventDefault()
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

  async function messageAuthor(post) {
    if (messagingAuthorIds.includes(post.authorId)) return
    setMessagingAuthorIds((current) => [...current, post.authorId])
    try {
      const conversationId = await openConversation(post.authorId)
      navigate('/app/chat', { state: { conversationId } })
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : 'Could not open this conversation.')
    } finally {
      setMessagingAuthorIds((current) => current.filter((id) => id !== post.authorId))
    }
  }

  async function sharePost(post) {
    const url = `${window.location.origin}/app/post/${post.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: `Update by ${post.name}`, text: post.text, url })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        setNotice(`Copy this post link: ${url}`)
        return
      }
      setNotice('Post link shared.')
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      setError('Could not share the post. Copy its URL from your browser address bar.')
    }
  }

  const isOwnPost = (post) => post.authorId === currentUser?.id

  return (
    <div className="app-content-width social-page">
      <AppPageHeader eyebrow="ICONNECT SOCIAL" title="Short updates, real conversations." description="Share a text update, join the conversation, or message someone privately." />
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <section className="social-compose-card"><Avatar person={author} /><form onSubmit={publishTextPost}><textarea value={caption} onChange={(event) => { setCaption(event.target.value); setError('') }} placeholder="What’s happening in your corner?" maxLength={500} rows={3} disabled={publishing} aria-label="Write a short update" /><div><span>{caption.length}/500</span><button type="submit" className="app-primary-button" disabled={publishing || !caption.trim()}><PenLine size={14} /> {publishing ? 'Posting…' : 'Post update'}</button></div></form></section>
      <div className="social-feed-toolbar"><div><span className="app-page-eyebrow">YOUR FEED</span><h2>Latest updates</h2></div><Link to="/app/create">Create a post <ArrowUpRight size={14} /></Link></div>
      {loadingPosts && <p className="inbox-empty-state">Loading posts…</p>}
      {!loadingPosts && loadError && <section className="feed-empty-state"><h2>Posts couldn’t be loaded.</h2><p>{loadError}</p><button type="button" className="app-primary-button" onClick={() => setRetryLoad((current) => current + 1)}>Try again</button></section>}
      {!loadingPosts && !loadError && !socialPosts.length && <section className="feed-empty-state"><h2>No updates yet.</h2><p>Be the first to share something with your community.</p></section>}
      {!loadingPosts && !loadError && <section className="social-post-list">{socialPosts.map((post) => <article className="social-post-card" key={post.id}><Avatar person={{ name: post.name, image: post.avatar }} /><div className="social-post-body"><div className="social-post-author"><strong>{post.name}</strong><span>{post.handle} · {post.time === 'just now' ? 'just now' : `${post.time} ago`}</span></div><p>{post.text}</p>{post.images?.length > 0 && <div className="social-post-photo-grid">{post.images.map((image, index) => <img key={`${image}-${index}`} src={resolveFeedImageUrl(image)} alt={`Photo ${index + 1} shared by ${post.name}`} loading="lazy" />)}</div>}<div className="social-post-actions"><button type="button" className={post.likedByMe ? 'is-liked' : ''} onClick={() => toggleLike(post)} aria-pressed={post.likedByMe} disabled={likingPostIds.includes(post.id)}><Heart size={15} fill={post.likedByMe ? 'currentColor' : 'none'} /> {post.likes}</button><Link to={`/app/post/${post.id}`}><MessageCircle size={15} /> {post.comments} replies</Link>{!isOwnPost(post) && <button type="button" onClick={() => messageAuthor(post)} disabled={messagingAuthorIds.includes(post.authorId)}><MessageCircle size={15} /> {messagingAuthorIds.includes(post.authorId) ? 'Opening…' : 'Message'}</button>}<button type="button" onClick={() => sharePost(post)}><Send size={14} /> Share</button></div></div></article>)}</section>}
    </div>
  )
}
