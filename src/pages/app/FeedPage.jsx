import React, { useState } from 'react'
import { Bookmark, Heart, Image, MessageCircle, MoreHorizontal, PenLine, Send, Smile, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoPosts } from '../../data/demoContent.js'
import { people } from '../../data/siteContent.js'

const storyPeople = [
  { ...people[0], note: 'Slow morning' },
  { ...people[1], note: 'On repeat' },
  { ...people[2], note: 'Little walk' },
  { ...people[3], note: 'Weekend bits' },
]

function FeedPost({ post }) {
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [commentOpen, setCommentOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [replies, setReplies] = useState([])

  function addReply(event) {
    event.preventDefault()
    const text = reply.trim()
    if (!text) return
    setReplies((current) => [...current, text])
    setReply('')
  }

  return (
    <article className="feed-card">
      <div className="feed-card-header">
        <Avatar person={{ name: post.name, image: post.avatar }} />
        <div className="feed-author"><strong>{post.name}</strong><span>{post.handle} · {post.time} ago · <span className="feed-location">{post.location}</span></span></div>
        <button className="quiet-icon-button" aria-label={`More options for ${post.name}'s post`}><MoreHorizontal size={19} /></button>
      </div>
      <p className="feed-card-copy">{post.text}</p>
      {post.image && <img className="feed-card-image" src={`https://images.unsplash.com/${post.image}?auto=format&fit=crop&w=1100&q=85`} alt={`A moment shared by ${post.name}`} loading="lazy" />}
      <div className="feed-card-tag">{post.tag}</div>
      <div className="feed-card-actions">
        <button className={liked ? 'feed-action liked' : 'feed-action'} onClick={() => setLiked((value) => !value)} aria-pressed={liked}><Heart size={17} fill={liked ? 'currentColor' : 'none'} /> <span>{post.likes + Number(liked)}</span></button>
        <button className="feed-action" onClick={() => setCommentOpen((value) => !value)} aria-expanded={commentOpen}><MessageCircle size={17} /> <span>{post.comments} replies</span></button>
        <button className={saved ? 'feed-action saved' : 'feed-action'} onClick={() => setSaved((value) => !value)} aria-pressed={saved} aria-label={saved ? 'Remove saved post' : 'Save post'}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /></button>
        <button className="feed-action feed-share" aria-label="Share post"><Send size={16} /></button>
      </div>
      {commentOpen && <div className="feed-replies">
        {replies.map((text, index) => <p className="feed-local-reply" key={`${post.id}-${index}`}><strong>You</strong> {text}</p>)}
        <form className="feed-comment-preview" onSubmit={addReply}><Avatar person={people[0]} /><input aria-label={`Reply to ${post.name}'s post`} placeholder="Write a reply…" value={reply} onChange={(event) => setReply(event.target.value)} /><button type="submit" aria-label="Send reply"><Send size={15} /></button></form>
        <p className="feed-reply-note">Preview only · Your reply is not published</p>
      </div>}
    </article>
  )
}

export default function FeedPage() {
  const [filter, setFilter] = useState('For you')
  const filters = ['For you', 'Following', 'Communities']
  const visiblePosts = demoPosts.filter((post) => {
    if (filter === 'Following') return post.name !== 'Marcus Lee'
    if (filter === 'Communities') return post.location !== 'Camera roll club'
    return true
  })

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="WEDNESDAY, OCTOBER 28" title="Your home" description="A little of what your people are sharing." />
      <div className="feed-welcome-callout"><span className="welcome-icon"><Heart size={17} /></span><span><strong>Welcome to your iConnect preview.</strong> Everything you see here is sample content.</span><Link to="/app/profile">Your profile →</Link></div>
      <section className="stories-panel">
        <div className="panel-title-row"><div><h2>Your circles</h2><p>Little updates from your people</p></div><Link to="/app/connect">Find people <span>→</span></Link></div>
        <div className="story-list">
          <Link to="/app/create" className="story-bubble story-create"><span className="story-avatar"><Avatar person={{ name: 'Taylor', image: 'photo-1544005313-94ddf0286df2' }} /><i>+</i></span><span>Your story</span></Link>
          {storyPeople.map((person, index) => <button className="story-bubble" key={person.name} onClick={() => setFilter('Following')}><span className={`story-avatar story-ring ring-${index + 1}`}><Avatar person={person} /></span><span>{person.name}</span><small>{person.note}</small></button>)}
        </div>
      </section>
      <div className="feed-layout-grid">
        <section className="feed-main-column">
          <Link to="/app/create" className="quick-compose">
            <Avatar person={{ name: 'Taylor', image: 'photo-1544005313-94ddf0286df2' }} />
            <span>What would you like to share?</span>
            <span className="compose-add"><PenLine size={16} /> Write a post</span>
          </Link>
          <div className="feed-filter-bar">
            <div className="feed-filters" role="tablist" aria-label="Feed filter">{filters.map((item) => <button role="tab" aria-selected={filter === item} className={filter === item ? 'feed-filter-active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div>
            <button className="feed-sort"><TrendingUp size={15} /> Recent</button>
          </div>
          <div className="demo-feed-note"><span className="demo-indicator" /> Preview feed · Posts and profiles are illustrative</div>
          {visiblePosts.map((post) => <FeedPost key={post.id} post={post} />)}
        </section>
        <aside className="feed-right-column">
          <section className="side-widget daily-prompt">
            <span className="widget-eyebrow">A THOUGHT FOR TODAY</span>
            <h3>What’s a small thing that made you smile this week?</h3>
            <Link to="/app/create">Share a moment <span>→</span></Link>
            <div className="prompt-decoration">“</div>
          </section>
          <section className="side-widget community-widget">
            <div className="widget-heading"><div><span className="widget-eyebrow">YOUR CORNERS</span><h3>Spaces to wander into</h3></div><Link to="/app/connect" aria-label="Browse communities">→</Link></div>
            <Link to="/app/connect" className="mini-community"><span className="mini-community-icon mini-green">↗</span><span><strong>Outside, eventually</strong><small>For the long way home</small></span><span className="mini-arrow">↗</span></Link>
            <Link to="/app/connect" className="mini-community"><span className="mini-community-icon mini-purple">▤</span><span><strong>The reading nook</strong><small>Readers welcome</small></span><span className="mini-arrow">↗</span></Link>
            <Link to="/app/connect" className="mini-community"><span className="mini-community-icon mini-peach">♫</span><span><strong>Currently on repeat</strong><small>What are you listening to?</small></span><span className="mini-arrow">↗</span></Link>
            <Link to="/app/connect" className="widget-footer-link">Explore all communities <span>→</span></Link>
          </section>
          <div className="side-preview-note">iConnect is a concept preview.<br />No accounts are connected.</div>
        </aside>
      </div>
      <div className="mobile-compose-button"><Link to="/app/create"><Image size={17} /> Share a moment</Link></div>
    </div>
  )
}
