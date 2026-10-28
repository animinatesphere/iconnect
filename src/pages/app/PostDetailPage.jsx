import React, { useState } from 'react'
import { ArrowLeft, Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import { demoPosts } from '../../data/demoContent.js'
import { demoAvatar, getDemoProfile } from '../../utils/demoAccount.js'

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
  const post = demoPosts.find((item) => item.id === postId)
  const profile = getDemoProfile()
  const viewer = { name: profile?.name ?? 'Taylor Reed', image: demoAvatar }
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reply, setReply] = useState('')
  const [localReplies, setLocalReplies] = useState([])

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
    setLocalReplies((current) => [...current, text])
    setReply('')
  }

  const replies = repliesByPost[post.id] ?? []

  return (
    <div className="app-content-width post-detail-page">
      <PageMeta title={`Post by ${post.name}`} description={post.text} />
      <Link to="/app/home" className="post-detail-back"><ArrowLeft size={17} /><span>Back to feed</span></Link>
      <section className="post-detail-card">
        <div className="post-detail-heading">
          <div><span className="app-page-eyebrow">POST DETAILS</span><h1>Conversation</h1></div>
          <button className="quiet-icon-button" aria-label={`More options for ${post.name}'s post`}><MoreHorizontal size={20} /></button>
        </div>
        <article className="post-detail-original">
          <div className="feed-card-header">
            <Avatar person={{ name: post.name, image: post.avatar }} />
            <div className="feed-author"><strong>{post.name}</strong><span>{post.handle}</span></div>
          </div>
          <p className="post-detail-copy">{post.text}</p>
          {post.image && <img className="post-detail-image" src={`https://images.unsplash.com/${post.image}?auto=format&fit=crop&w=1200&q=85`} alt={`A moment shared by ${post.name}`} />}
          <div className="post-detail-tag">{post.tag} <span>·</span> {post.location}</div>
          <p className="post-detail-time">{post.time} ago · Shared with their circle</p>
          <div className="post-detail-stats"><span><strong>{post.likes + Number(liked)}</strong> likes</span><span><strong>{post.comments + localReplies.length}</strong> replies</span></div>
          <div className="post-detail-actions">
            <button type="button" className={liked ? 'post-detail-action liked' : 'post-detail-action'} onClick={() => setLiked((value) => !value)} aria-pressed={liked}><Heart size={19} fill={liked ? 'currentColor' : 'none'} /><span>Like</span></button>
            <a href="#reply-composer" className="post-detail-action"><MessageCircle size={19} /><span>Reply</span></a>
            <button type="button" className={saved ? 'post-detail-action saved' : 'post-detail-action'} onClick={() => setSaved((value) => !value)} aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /><span>{saved ? 'Saved' : 'Save'}</span></button>
            <button type="button" className="post-detail-action" aria-label="Share post"><Send size={18} /><span>Share</span></button>
          </div>
        </article>
        <section className="post-replies-section" aria-label="Replies">
          <div className="post-replies-heading"><h2>Replies</h2><span>{post.comments + localReplies.length}</span></div>
          <form id="reply-composer" className="post-reply-composer" onSubmit={addReply}>
            <Avatar person={viewer} />
            <label><span className="sr-only">Write a reply</span><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a thoughtful reply…" rows={2} maxLength={280} /></label>
            <button type="submit" className="app-primary-button" disabled={!reply.trim()}><Send size={15} /><span>Reply</span></button>
          </form>
          <p className="post-detail-preview-note">Preview only · Replies stay in this page and aren't published</p>
          <div className="post-replies-list">
            {localReplies.map((text, index) => <article className="post-reply" key={`local-${index}`}><Avatar person={viewer} /><div className="post-reply-body"><div className="post-reply-author"><strong>{viewer.name}</strong><span>@you · just now</span></div><p>{text}</p></div></article>)}
            {replies.map((item) => <article className="post-reply" key={`${post.id}-${item.name}`}><Avatar person={{ name: item.name, image: item.avatar }} /><div className="post-reply-body"><div className="post-reply-author"><strong>{item.name}</strong><span>{item.handle} · {item.time}</span><button aria-label={`More options for ${item.name}'s reply`}><MoreHorizontal size={17} /></button></div><p>{item.text}</p><div className="post-reply-actions"><button type="button" aria-label={`Like ${item.name}'s reply`}><Heart size={15} /></button><button type="button" aria-label={`Reply to ${item.name}'s comment`}><MessageCircle size={15} /></button></div></div></article>)}
          </div>
        </section>
      </section>
    </div>
  )
}
