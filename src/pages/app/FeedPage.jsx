import React, { useCallback, useEffect, useState } from 'react'
import { Bookmark, Heart, Image, MessageCircle, MoreHorizontal, PenLine, Send, TrendingUp, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoPosts } from '../../data/demoContent.js'
import { people } from '../../data/siteContent.js'
import { demoAvatar, getDemoProfile } from '../../utils/demoAccount.js'
import { emptyDemoFeedState, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'

const storyPeople = [
  { ...people[0], note: 'Slow morning', image: 'photo-1470252649378-9c29740c9fa8', text: 'Taking a slow start and letting the morning find its own pace.' },
  { ...people[1], note: 'On repeat', image: 'photo-1516280440614-37939bbacd81', text: 'Found the perfect soundtrack for a long walk.' },
  { ...people[2], note: 'Little walk', image: 'photo-1441974231531-c6227db76b6e', text: 'Took the scenic route, as usual.' },
  { ...people[3], note: 'Weekend bits', image: 'photo-1470770841072-f978cf4d019e', text: 'A few quiet moments from the weekend.' },
]

function FeedPost({ post, state, updateState, announce, sharePost, hidePost }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const liked = state.likedPostIds.includes(post.id)
  const saved = state.savedPostIds.includes(post.id)

  function togglePostList(key) {
    const updated = state[key].includes(post.id)
      ? state[key].filter((id) => id !== post.id)
      : [...state[key], post.id]
    updateState({ ...state, [key]: updated })
  }

  return (
    <article className="feed-card">
      <Link to={`/app/post/${post.id}`} className="feed-post-open" aria-label={`View ${post.name}'s post`}>
        <div className="feed-card-header">
          <Avatar person={{ name: post.name, image: post.avatar }} />
          <div className="feed-author"><strong>{post.name}</strong><span>{post.handle} · {post.time === 'just now' ? post.time : `${post.time} ago`} · <span className="feed-location">{post.location}</span></span></div>
        </div>
        <p className="feed-card-copy">{post.text}</p>
        {post.image && (post.mediaType === 'video'
          ? <video className="feed-card-image feed-card-video" src={post.image} controls playsInline preload="metadata" aria-label={`Video shared by ${post.name}`} />
          : <img className="feed-card-image" src={post.image.startsWith('data:') ? post.image : `https://images.unsplash.com/${post.image}?auto=format&fit=crop&w=1100&q=85`} alt={`A moment shared by ${post.name}`} loading="lazy" />)}
        <div className="feed-card-tag">{post.tag}</div>
      </Link>
      <div className="feed-post-menu-wrap">
        <button type="button" className="quiet-icon-button feed-card-more" aria-label={`More options for ${post.name}'s post`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button>
        {menuOpen && <div className="feed-post-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { togglePostList('savedPostIds'); announce(saved ? 'Post removed from your saved list.' : 'Post saved in this browser.'); setMenuOpen(false) }}><Bookmark size={15} />{saved ? 'Unsave post' : 'Save post'}</button>
          <button type="button" role="menuitem" onClick={() => { hidePost(post); setMenuOpen(false) }}><X size={15} />Hide post</button>
        </div>}
      </div>
      <div className="feed-card-actions">
        <button type="button" className={liked ? 'feed-action liked' : 'feed-action'} onClick={() => togglePostList('likedPostIds')} aria-pressed={liked} aria-label={liked ? `Unlike ${post.name}'s post` : `Like ${post.name}'s post`}><Heart size={17} fill={liked ? 'currentColor' : 'none'} /> <span>{post.likes + Number(liked)}</span></button>
        <Link to={`/app/post/${post.id}`} className="feed-action"><MessageCircle size={17} /> <span>{post.comments + (state.replies[post.id]?.length ?? 0)} replies</span></Link>
        <button type="button" className={saved ? 'feed-action saved' : 'feed-action'} onClick={() => togglePostList('savedPostIds')} aria-pressed={saved} aria-label={saved ? 'Remove saved post' : 'Save post'}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /></button>
        <button type="button" className="feed-action feed-share" onClick={() => sharePost(post)} aria-label="Share post link"><Send size={16} /></button>
      </div>
      <Link to={`/app/post/${post.id}`} className="feed-view-details">View conversation</Link>
    </article>
  )
}

function StoryViewer({ person, onClose, onPrevious, onNext, index, total }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onPrevious()
      if (event.key === 'ArrowRight') onNext()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, onNext, onPrevious])

  return (
    <div className="story-viewer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="story-viewer" role="dialog" aria-modal="true" aria-label={`${person.name}'s story`}>
        <img src={`https://images.unsplash.com/${person.image}?auto=format&fit=crop&w=900&h=1400&q=85`} alt="" />
        <div className="story-viewer-shade" />
        <div className="story-viewer-progress"><span style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
        <div className="story-viewer-header"><Avatar person={person} /><span><strong>{person.name}</strong><small>iConnect story · preview</small></span><button type="button" onClick={onClose} aria-label="Close story"><X size={20} /></button></div>
        <p>{person.text}</p>
        <div className="story-viewer-controls"><button type="button" onClick={onPrevious} aria-label="Previous story">‹</button><button type="button" onClick={onNext} aria-label="Next story">›</button></div>
      </section>
    </div>
  )
}

export default function FeedPage() {
  const [filter, setFilter] = useState('For you')
  const [sort, setSort] = useState('Recent')
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [feedError, setFeedError] = useState('')
  const [notice, setNotice] = useState('')
  const [undoPostId, setUndoPostId] = useState('')
  const [storyIndex, setStoryIndex] = useState(null)
  const navigate = useNavigate()
  const profile = getDemoProfile()
  const viewer = { name: profile?.name ?? 'Taylor Reed', image: profile?.avatar ?? demoAvatar }
  const filters = ['For you', 'Following', 'Communities', 'Videos']

  useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Could not load saved feed activity.')
    }
  }, [])

  function updateState(nextState) {
    try {
      writeDemoFeedState(nextState)
      setFeedState(nextState)
      setFeedError('')
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Could not save this feed change.')
    }
  }

  function announce(message) {
    setNotice(message)
  }

  async function sharePost(post) {
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
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setNotice('This browser could not share the post. You can copy its URL from the address bar.')
    }
  }

  function hidePost(post) {
    updateState({ ...feedState, hiddenPostIds: [...feedState.hiddenPostIds, post.id] })
    setUndoPostId(post.id)
    setNotice(`${post.name}'s post was hidden from your feed.`)
  }

  function undoHide() {
    updateState({ ...feedState, hiddenPostIds: feedState.hiddenPostIds.filter((id) => id !== undoPostId) })
    setUndoPostId('')
    setNotice('Post restored to your feed.')
  }

  const closeStory = useCallback(() => setStoryIndex(null), [])
  const previousStory = useCallback(() => setStoryIndex((current) => (current + storyPeople.length - 1) % storyPeople.length), [])
  const nextStory = useCallback(() => setStoryIndex((current) => (current + 1) % storyPeople.length), [])

  const allPosts = [...feedState.posts, ...demoPosts]
  const visiblePosts = allPosts
    .filter((post) => !feedState.hiddenPostIds.includes(post.id))
    .filter((post) => {
      if (filter === 'Following') return feedState.followedHandles.includes(post.handle)
      if (filter === 'Videos') return post.mediaType === 'video'
      if (filter === 'Communities') return ['Outside, eventually', 'Currently on repeat', 'Camera roll club', 'The reading nook'].includes(post.location)
      return true
    })
    .sort((left, right) => sort === 'Most liked'
      ? (right.likes + Number(feedState.likedPostIds.includes(right.id))) - (left.likes + Number(feedState.likedPostIds.includes(left.id)))
      : (feedState.posts.some((post) => post.id === right.id) ? 1 : 0) - (feedState.posts.some((post) => post.id === left.id) ? 1 : 0))

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR iCONNECT HOME" title="Your home" description="A little of what your people are sharing." />
      <div className="feed-welcome-callout"><span className="welcome-icon"><Heart size={17} /></span><span><strong>Welcome, {profile?.name.split(' ')[0] ?? 'friend'}.</strong> Here’s what your people are sharing.</span><Link to="/app/profile">Your profile →</Link></div>
      <section className="stories-panel">
        <div className="panel-title-row"><div><h2>Your circles</h2><p>Little updates from your people</p></div><Link to="/app/connect">Find people <span>→</span></Link></div>
        <div className="story-list">
          <Link to="/app/create" className="story-bubble story-create"><span className="story-avatar"><Avatar person={viewer} /><i>+</i></span><span>Your story</span></Link>
          {storyPeople.map((person, index) => <button type="button" className="story-bubble" key={person.name} onClick={() => setStoryIndex(index)}><span className={`story-avatar story-ring ring-${index + 1}`}><Avatar person={person} /></span><span>{person.name}</span><small>{person.note}</small></button>)}
        </div>
      </section>
      <div className="feed-layout-grid">
        <section className="feed-main-column">
          <Link to="/app/create" className="quick-compose">
            <Avatar person={viewer} />
            <span>What would you like to share?</span>
            <span className="compose-add"><PenLine size={16} /> Write a post</span>
          </Link>
          <div className="feed-filter-bar">
            <div className="feed-filters" role="tablist" aria-label="Feed filter">{filters.map((item) => <button type="button" role="tab" aria-selected={filter === item} className={filter === item ? 'feed-filter-active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div>
            <button type="button" className="feed-sort" onClick={() => setSort((current) => current === 'Recent' ? 'Most liked' : 'Recent')} aria-label={`Sort by ${sort === 'Recent' ? 'most liked' : 'recent'}`}><TrendingUp size={15} /> {sort}</button>
          </div>
          <div className="demo-feed-note"><span className="demo-indicator" /> Preview feed · Posts and profiles are illustrative</div>
          {feedError && <p className="feed-interaction-notice feed-error" role="alert">{feedError}</p>}
          {notice && <p className="feed-interaction-notice" role="status">{notice}{undoPostId && <button type="button" onClick={undoHide}>Undo</button>}</p>}
          {visiblePosts.length
            ? visiblePosts.map((post) => <FeedPost key={post.id} post={post} state={feedState} updateState={updateState} announce={announce} sharePost={sharePost} hidePost={hidePost} />)
            : <section className="feed-empty-state"><h2>{filter === 'Following' ? 'Your circle is just getting started.' : 'No posts in this view yet.'}</h2><p>{filter === 'Following' ? 'Follow people in Connect and their posts will show up here.' : 'Try another feed or discover more communities.'}</p><button type="button" className="app-primary-button" onClick={() => filter === 'Following' ? navigate('/app/connect') : setFilter('For you')}>{filter === 'Following' ? 'Find people' : 'Show all posts'}</button></section>}
        </section>
        <aside className="feed-right-column">
          <section className="side-widget daily-prompt">
            <span className="widget-eyebrow">A THOUGHT FOR TODAY</span>
            <h3>What’s a small thing that made you smile this week?</h3>
            <Link to="/app/create" state={{ prompt: 'What’s a small thing that made you smile this week?' }}>Share a moment <span>→</span></Link>
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
      {storyIndex !== null && <StoryViewer person={storyPeople[storyIndex]} index={storyIndex} total={storyPeople.length} onClose={closeStory} onPrevious={previousStory} onNext={nextStory} />}
    </div>
  )
}
