import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { demoPosts } from '../../data/demoContent.js'
import { demoAvatar, getDemoProfile } from '../../utils/demoAccount.js'
import { emptyDemoFeedState, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'

const repliesByPost = {
  'jules-walk': [
    { name: 'Sofia Martins', handle: '@sofiam', avatar: 'photo-1534528741775-53994a69daeb', time: '8 min', text: 'The best kind of detour. The trees always have something to say.' },
    { name: 'Marcus Lee', handle: '@marcusmakes', avatar: 'photo-1500648767791-00dcc994a43e', time: '5 min', text: 'Adding this energy to my next walk playlist 🌿' },
  ],
  'marcus-playlist': [
    { name: 'Jules Morgan', handle: '@julesmorgan', avatar: 'photo-1531123897727-8f129e1688ce', time: '21 min', text: 'Something mellow for the first mile, then a song that makes you walk faster.' },
    { name: 'Sofia Martins', handle: '@sofiam', avatar: 'photo-1534528741775-53994a69daeb', time: '14 min', text: 'Anything by Khruangbin belongs on that list.' },
  ],
  'sofia-weekend': [
    { name: 'Jules Morgan', handle: '@julesmorgan', avatar: 'photo-1531123897727-8f129e1688ce', time: '42 min', text: 'You captured that quiet feeling so well.' },
    { name: 'Marcus Lee', handle: '@marcusmakes', avatar: 'photo-1500648767791-00dcc994a43e', time: '30 min', text: 'Hope Monday is being kind to you.' },
  ],
}

export default function PostDetailPage() {
  const { postId } = useParams()
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const profile = getDemoProfile()
  const viewer = { name: profile?.name ?? 'Taylor Reed', image: profile?.avatar ?? demoAvatar }
  const [reply, setReply] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const replyInput = useRef(null)
  const navigate = useNavigate()
  const post = [...feedState.posts, ...demoPosts].find((item) => item.id === postId)

  useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load saved feed activity.')
    } finally {
      setLoaded(true)
    }
  }, [])

  if (!loaded) return <div className="app-content-width post-detail-page" aria-live="polite">Loading post…</div>

  if (!post) {
    return (
      <div className="app-content-width post-detail-page">
        <PageMeta title="Post not found" />
        <Link to="/app/home" className="app-back-link"><ArrowLeft size={15} /> Back to your home</Link>
        <section className="post-not-found"><h1>We couldn't find that post.</h1><p>It may have moved or been removed from this preview.</p><Link to="/app/home">Return to your feed</Link></section>
      </div>
    )
  }

  function addReply(event) {
    event.preventDefault()
    const text = reply.trim()
    if (!text) return
    const newReply = {
      id: `reply-${Date.now()}`,
      name: viewer.name,
      handle: '@you',
      avatar: demoAvatar,
      time: 'just now',
      text,
      liked: false,
    }
    updateState({ ...feedState, replies: { ...feedState.replies, [post.id]: [...(feedState.replies[post.id] ?? []), newReply] } })
    setReply('')
  }

  function updateState(nextState) {
    try {
      writeDemoFeedState(nextState)
      setFeedState(nextState)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this feed change.')
    }
  }

  function togglePostList(key) {
    const containsPost = feedState[key].includes(post.id)
    const values = containsPost ? feedState[key].filter((id) => id !== post.id) : [...feedState[key], post.id]
    updateState({ ...feedState, [key]: values })
  }

  function toggleReplyLike(replyId) {
    const nextReplies = (feedState.replies[post.id] ?? []).map((item) => item.id === replyId ? { ...item, liked: !item.liked } : item)
    updateState({ ...feedState, replies: { ...feedState.replies, [post.id]: nextReplies } })
  }

  function toggleSampleReplyLike(replyId) {
    const likedReplyIds = feedState.likedReplyIds.includes(replyId)
      ? feedState.likedReplyIds.filter((id) => id !== replyId)
      : [...feedState.likedReplyIds, replyId]
    updateState({ ...feedState, likedReplyIds })
  }

  async function sharePost() {
    const url = `${window.location.origin}/app/post/${post.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: `Post by ${post.name} on iConnect`, text: post.text, url })
        setNotice('Post shared.')
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setNotice('Post link copied to clipboard.')
      } else {
        setNotice(`Copy this post link to share: ${url}`)
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      setNotice('This browser could not share the post. You can copy its URL from the address bar.')
    }
  }

  function replyTo(name) {
    setReply(`@${name.split(' ')[0]} `)
    replyInput.current?.focus()
  }

  const sampleReplies = repliesByPost[post.id] ?? []
  const localReplies = feedState.replies[post.id] ?? []
  const liked = feedState.likedPostIds.includes(post.id)
  const saved = feedState.savedPostIds.includes(post.id)

  return (
    <div className="app-content-width post-detail-page">
      <PageMeta title={`Post by ${post.name}`} description={post.text} />
      <Link to="/app/home" className="post-detail-back"><ArrowLeft size={17} /><span>Back to feed</span></Link>
      <section className="post-detail-card">
        <div className="post-detail-heading">
          <div><span className="app-page-eyebrow">POST DETAILS</span><h1>Conversation</h1></div>
          <button type="button" className="quiet-icon-button" aria-label={`More options for ${post.name}'s post`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={20} /></button>
          {menuOpen && <div className="feed-post-menu post-detail-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { togglePostList('savedPostIds'); setMenuOpen(false) }}><Bookmark size={15} />{saved ? 'Unsave post' : 'Save post'}</button>
            <button type="button" role="menuitem" onClick={() => {
              updateState({ ...feedState, hiddenPostIds: [...feedState.hiddenPostIds, post.id] })
              setMenuOpen(false)
              navigate('/app/home')
            }}><X size={15} />Hide post</button>
          </div>}
        </div>
        <article className="post-detail-original">
          <div className="feed-card-header">
            <Avatar person={{ name: post.name, image: post.avatar }} />
            <div className="feed-author"><strong>{post.name}</strong><span>{post.handle}</span></div>
          </div>
          <p className="post-detail-copy">{post.text}</p>
          {post.image && (post.mediaType === 'video'
            ? <video className="post-detail-image post-detail-video" src={post.image} controls playsInline preload="metadata" aria-label={`Video shared by ${post.name}`} />
            : <img className="post-detail-image" src={post.image.startsWith('data:') ? post.image : `https://images.unsplash.com/${post.image}?auto=format&fit=crop&w=1200&q=85`} alt={`A moment shared by ${post.name}`} />)}
          <div className="post-detail-tag">{post.tag} <span>·</span> {post.location}</div>
          <p className="post-detail-time">{post.time === 'just now' ? 'Just now' : `${post.time} ago`} · Shared with their circle</p>
          <div className="post-detail-stats"><span><strong>{post.likes + Number(liked)}</strong> likes</span><span><strong>{post.comments + localReplies.length}</strong> replies</span></div>
          <div className="post-detail-actions">
            <button type="button" className={liked ? 'post-detail-action liked' : 'post-detail-action'} onClick={() => togglePostList('likedPostIds')} aria-pressed={liked}><Heart size={19} fill={liked ? 'currentColor' : 'none'} /><span>{liked ? 'Liked' : 'Like'}</span></button>
            <button type="button" className="post-detail-action" onClick={() => { replyInput.current?.focus(); replyInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><MessageCircle size={19} /><span>Reply</span></button>
            <button type="button" className={saved ? 'post-detail-action saved' : 'post-detail-action'} onClick={() => togglePostList('savedPostIds')} aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /><span>{saved ? 'Saved' : 'Save'}</span></button>
            <button type="button" className="post-detail-action" onClick={sharePost}><Send size={18} /><span>Share</span></button>
          </div>
        </article>
        <section className="post-replies-section" aria-label="Replies">
          <div className="post-replies-heading"><h2>Replies</h2><span>{post.comments + localReplies.length}</span></div>
          <form id="reply-composer" className="post-reply-composer" onSubmit={addReply}>
            <Avatar person={viewer} />
            <label><span className="sr-only">Write a reply</span><textarea ref={replyInput} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a thoughtful reply…" rows={2} maxLength={280} /></label>
            <button type="submit" className="app-primary-button" disabled={!reply.trim()}><Send size={15} /><span>Reply</span></button>
          </form>
          {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
          {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
          <p className="post-detail-preview-note">Preview only · Replies are saved in this browser and aren't published</p>
          <div className="post-replies-list">
            {localReplies.map((item) => <article className="post-reply" key={item.id}><Avatar person={{ name: item.name, image: item.avatar }} /><div className="post-reply-body"><div className="post-reply-author"><strong>{item.name}</strong><span>{item.handle} · {item.time}</span></div><p>{item.text}</p><div className="post-reply-actions"><button type="button" className={item.liked ? 'reply-liked' : ''} onClick={() => toggleReplyLike(item.id)} aria-pressed={item.liked} aria-label={item.liked ? 'Unlike your reply' : 'Like your reply'}><Heart size={15} fill={item.liked ? 'currentColor' : 'none'} /></button></div></div></article>)}
            {sampleReplies.map((item) => {
              const replyId = `${post.id}-${item.name}`
              const replyLiked = feedState.likedReplyIds.includes(replyId)
              return <article className="post-reply" key={replyId}><Avatar person={{ name: item.name, image: item.avatar }} /><div className="post-reply-body"><div className="post-reply-author"><strong>{item.name}</strong><span>{item.handle} · {item.time}</span><button type="button" aria-label={`More options for ${item.name}'s reply`} onClick={() => setNotice(`Reply from ${item.name} is sample content.`)}><MoreHorizontal size={17} /></button></div><p>{item.text}</p><div className="post-reply-actions"><button type="button" className={replyLiked ? 'reply-liked' : ''} aria-pressed={replyLiked} aria-label={replyLiked ? `Unlike ${item.name}'s reply` : `Like ${item.name}'s reply`} onClick={() => toggleSampleReplyLike(replyId)}><Heart size={15} fill={replyLiked ? 'currentColor' : 'none'} /></button><button type="button" aria-label={`Reply to ${item.name}'s comment`} onClick={() => replyTo(item.name)}><MessageCircle size={15} /></button></div></div></article>
            })}
          </div>
        </section>
      </section>
    </div>
  )
}
