import React, { useEffect, useState } from 'react'
import { Bookmark, Heart, Image, MessageCircle, MoreHorizontal, PenLine, Send, TrendingUp } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { getDemoProfile } from '../../utils/demoAccount.js'
import { getPeople } from '../../utils/peopleApi.js'
import { getSocialPosts, resolveFeedImageUrl, setSocialPostBookmark, setSocialPostLike } from '../../utils/socialApi.js'

function FeedPost({ post, sharePost, onLike, liking, onBookmark, bookmarking }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const liked = post.likedByMe
  const saved = post.bookmarkedByMe
  const images = post.images?.length ? post.images : post.image ? [post.image] : []

  return (
    <article className="feed-card">
      <Link to={`/app/post/${post.id}`} className="feed-post-open" aria-label={`View ${post.name}'s post`}>
        <div className="feed-card-header">
          <Avatar person={{ name: post.name, image: post.avatar }} />
          <div className="feed-author"><strong>{post.name}</strong><span>{post.handle} · {post.time === 'just now' ? post.time : `${post.time} ago`} · <span className="feed-location">{post.location}</span></span></div>
        </div>
        <p className="feed-card-copy">{post.text}</p>
        {images.length > 0 && <div className={`feed-card-gallery feed-card-gallery-${Math.min(images.length, 3)}`}>
          {images.map((image, index) => post.mediaType === 'video'
            ? <video key={image} className="feed-card-image feed-card-video" src={image} controls playsInline preload="metadata" aria-label={`Video shared by ${post.name}`} />
            : <img key={`${image}-${index}`} className="feed-card-image" src={resolveFeedImageUrl(image)} alt={`Photo ${index + 1} shared by ${post.name}`} loading="lazy" />)}
        </div>}
        <div className="feed-card-tag">{post.tag}</div>
      </Link>
      <div className="feed-post-menu-wrap">
        <button type="button" className="quiet-icon-button feed-card-more" aria-label={`More options for ${post.name}'s post`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button>
        {menuOpen && <div className="feed-post-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { onBookmark(post); setMenuOpen(false) }}><Bookmark size={15} />{saved ? 'Unsave post' : 'Save post'}</button>
        </div>}
      </div>
      <div className="feed-card-actions">
        <button type="button" className={liked ? 'feed-action liked' : 'feed-action'} onClick={() => onLike(post)} disabled={liking} aria-pressed={liked} aria-label={liked ? `Unlike ${post.name}'s post` : `Like ${post.name}'s post`}><Heart size={17} fill={liked ? 'currentColor' : 'none'} /> <span>{post.likes}</span></button>
        <Link to={`/app/post/${post.id}`} className="feed-action"><MessageCircle size={17} /> <span>{post.comments} replies</span></Link>
        <button type="button" className={saved ? 'feed-action saved' : 'feed-action'} onClick={() => onBookmark(post)} disabled={bookmarking} aria-pressed={saved} aria-label={saved ? 'Remove saved post' : 'Save post'}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /></button>
        <button type="button" className="feed-action feed-share" onClick={() => sharePost(post)} aria-label="Share post link"><Send size={16} /></button>
      </div>
      <Link to={`/app/post/${post.id}`} className="feed-view-details">View conversation</Link>
    </article>
  )
}

export default function FeedPage() {
  const [filter, setFilter] = useState('For you')
  const [sort, setSort] = useState('Recent')
  const [socialPosts, setSocialPosts] = useState([])
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [feedLoadError, setFeedLoadError] = useState('')
  const [retryFeedLoad, setRetryFeedLoad] = useState(0)
  const [followedPeople, setFollowedPeople] = useState([])
  const [loadingFollowedPeople, setLoadingFollowedPeople] = useState(true)
  const [followedPeopleError, setFollowedPeopleError] = useState('')
  const [likingPostIds, setLikingPostIds] = useState([])
  const [bookmarkingPostIds, setBookmarkingPostIds] = useState([])
  const [feedError, setFeedError] = useState('')
  const [notice, setNotice] = useState('')
  const navigate = useNavigate()
  const profile = getDemoProfile()
  const viewer = { name: profile?.name ?? 'You', image: profile?.avatar ?? '' }
  const filters = ['For you', 'Following', 'Saved']

  useEffect(() => {
    let active = true
    setLoadingPosts(true)
    setFeedLoadError('')
    getSocialPosts({
      followingOnly: filter === 'Following',
      bookmarkedOnly: filter === 'Saved',
    })
      .then((posts) => {
        if (active) {
          setSocialPosts(posts)
          setFeedError('')
        }
      })
      .catch((error) => {
        if (active) {
          setFeedLoadError(error instanceof Error ? error.message : 'Could not load published posts.')
          setFeedError(error instanceof Error ? error.message : 'Could not load published posts.')
        }
      })
      .finally(() => {
        if (active) setLoadingPosts(false)
      })
    return () => { active = false }
  }, [filter, retryFeedLoad])

  useEffect(() => {
    let active = true
    getPeople({ followingOnly: true })
      .then((people) => {
        if (active) setFollowedPeople(people)
      })
      .catch((error) => {
        if (active) setFollowedPeopleError(error instanceof Error ? error.message : 'Could not load the people you follow.')
      })
      .finally(() => {
        if (active) setLoadingFollowedPeople(false)
      })
    return () => { active = false }
  }, [])

  async function toggleSocialLike(post) {
    if (likingPostIds.includes(post.id)) return
    setLikingPostIds((current) => [...current, post.id])
    try {
      const updatedPost = await setSocialPostLike(post.id, !post.likedByMe)
      setSocialPosts((current) => current.map((item) => item.id === post.id ? updatedPost : item))
      setFeedError('')
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Could not update this like.')
    } finally {
      setLikingPostIds((current) => current.filter((id) => id !== post.id))
    }
  }

  async function toggleSocialBookmark(post) {
    if (bookmarkingPostIds.includes(post.id)) return
    const bookmarked = !post.bookmarkedByMe
    setBookmarkingPostIds((current) => [...current, post.id])
    try {
      await setSocialPostBookmark(post.id, bookmarked)
      setSocialPosts((current) => current.map((item) => item.id === post.id
        ? { ...item, bookmarkedByMe: bookmarked }
        : item))
      if (filter === 'Saved' && !bookmarked) {
        setSocialPosts((current) => current.filter((item) => item.id !== post.id))
      }
      setNotice(bookmarked ? 'Post saved to your account.' : 'Post removed from your saved posts.')
      setFeedError('')
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Could not update your saved post.')
    } finally {
      setBookmarkingPostIds((current) => current.filter((id) => id !== post.id))
    }
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

  const visiblePosts = [...socialPosts].sort((left, right) => sort === 'Most liked'
    ? right.likes - left.likes
    : new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR iCONNECT HOME" title="Your home" description="A little of what your people are sharing." />
      <div className="feed-welcome-callout"><span className="welcome-icon"><Heart size={17} /></span><span><strong>Welcome, {profile?.name.split(' ')[0] ?? 'friend'}.</strong> Here’s what your people are sharing.</span><Link to="/app/profile">Your profile →</Link></div>
      <div className="feed-layout-grid">
        <section className="feed-main-column">
          <Link to="/app/social" className="quick-compose">
            <Avatar person={viewer} />
            <span>What would you like to share?</span>
            <span className="compose-add"><PenLine size={16} /> Write a post</span>
          </Link>
          <div className="feed-filter-bar">
            <div className="feed-filters" role="tablist" aria-label="Feed filter">{filters.map((item) => <button type="button" role="tab" aria-selected={filter === item} className={filter === item ? 'feed-filter-active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div>
            <button type="button" className="feed-sort" onClick={() => setSort((current) => current === 'Recent' ? 'Most liked' : 'Recent')} aria-label={`Sort by ${sort === 'Recent' ? 'most liked' : 'recent'}`}><TrendingUp size={15} /> {sort}</button>
          </div>
          <div className="feed-account-note">Posts, likes, replies, and saved posts are connected to your account.</div>
          {feedError && <p className="feed-interaction-notice feed-error" role="alert">{feedError}</p>}
          {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
          {loadingPosts
            ? <p className="inbox-empty-state">Loading posts…</p>
            : feedLoadError
              ? <section className="feed-empty-state"><h2>Posts couldn’t be loaded.</h2><p>{feedLoadError}</p><button type="button" className="app-primary-button" onClick={() => setRetryFeedLoad((current) => current + 1)}>Try again</button></section>
            : visiblePosts.length
              ? visiblePosts.map((post) => <FeedPost key={post.id} post={post} sharePost={sharePost} onLike={toggleSocialLike} liking={likingPostIds.includes(post.id)} onBookmark={toggleSocialBookmark} bookmarking={bookmarkingPostIds.includes(post.id)} />)
              : <section className="feed-empty-state"><h2>{filter === 'Following' ? 'Your circle is just getting started.' : filter === 'Saved' ? 'No saved posts yet.' : 'No posts in your feed yet.'}</h2><p>{filter === 'Following' ? 'Follow people in Connect and their posts will show up here.' : filter === 'Saved' ? 'Save a post and it will be waiting here.' : 'When you or people you follow share a post, it will appear here.'}</p><button type="button" className="app-primary-button" onClick={() => filter === 'Following' ? navigate('/app/connect') : filter === 'Saved' ? setFilter('For you') : navigate('/app/social')}>{filter === 'Following' ? 'Find people' : filter === 'Saved' ? 'Show all posts' : 'Write a post'}</button></section>}
        </section>
        <aside className="feed-right-column">
          <section className="side-widget daily-prompt">
            <span className="widget-eyebrow">A THOUGHT FOR TODAY</span>
            <h3>What’s a small thing that made you smile this week?</h3>
            <Link to="/app/create" state={{ prompt: 'What’s a small thing that made you smile this week?' }}>Share a moment <span>→</span></Link>
            <div className="prompt-decoration">“</div>
          </section>
          <section className="side-widget community-widget">
            <div className="widget-heading"><div><span className="widget-eyebrow">YOUR CIRCLE</span><h3>People you follow</h3></div><Link to="/app/connect" aria-label="Find people to follow">→</Link></div>
            {loadingFollowedPeople && <p className="inbox-empty-state">Loading your circle…</p>}
            {!loadingFollowedPeople && followedPeopleError && <p className="inbox-empty-state" role="alert">{followedPeopleError}</p>}
            {!loadingFollowedPeople && !followedPeopleError && followedPeople.length === 0 && <p className="inbox-empty-state">Follow people in Connect to see their posts here.</p>}
            {followedPeople.slice(0, 3).map((person) => <Link to="/app/connect" state={{ activeTab: 'People', search: person.name }} className="mini-community" key={person.id}><Avatar person={person} /><span><strong>{person.name}</strong><small>@{person.username}</small></span><span className="mini-arrow">↗</span></Link>)}
            <Link to="/app/connect" className="widget-footer-link">Find people <span>→</span></Link>
          </section>
        </aside>
      </div>
      <div className="mobile-compose-button"><Link to="/app/create"><Image size={17} /> Share a moment</Link></div>
    </div>
  )
}
