import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Heart, MessageCircle, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import PageMeta from '../../components/PageMeta.jsx'
import PostEditForm from '../../components/PostEditForm.jsx'
import { createSocialComment, deleteSocialPost, getSocialComments, getSocialPost, resolveFeedImageUrl, setSocialPostBookmark, setSocialPostLike, updateSocialPost } from '../../utils/socialApi.js'

export default function PostDetailPage() {
  const { postId } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState(null)
  const [comments, setComments] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reply, setReply] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingPost, setEditingPost] = useState(false)
  const [submittingReply, setSubmittingReply] = useState(false)
  const [likingPost, setLikingPost] = useState(false)
  const [bookmarkingPost, setBookmarkingPost] = useState(false)
  const replyInput = useRef(null)

  useEffect(() => {
    let active = true
    setLoaded(false)
    setPost(null)
    setComments([])
    setError('')
    Promise.all([getSocialPost(postId), getSocialComments(postId)])
      .then(([loadedPost, loadedComments]) => {
        if (!active) return
        setPost(loadedPost)
        setComments(loadedComments)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this post.')
      })
      .finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [postId])

  if (!loaded) return <div className="app-content-width post-detail-page" aria-live="polite">Loading post…</div>

  if (!post) {
    return (
      <div className="app-content-width post-detail-page">
        <PageMeta title="Post not found" />
        <Link to="/app/home" className="app-back-link"><ArrowLeft size={15} /> Back to your home</Link>
        <section className="post-not-found"><h1>We couldn't find that post.</h1><p>{error || 'It may have been removed or is no longer available.'}</p><Link to="/app/home">Return to your feed</Link></section>
      </div>
    )
  }

  async function addReply(event) {
    event.preventDefault()
    const text = reply.trim()
    if (!text || submittingReply) return
    setSubmittingReply(true)
    setError('')
    try {
      const newComment = await createSocialComment(post.id, text)
      setComments((current) => [...current, newComment])
      setPost((current) => ({ ...current, comments: current.comments + 1 }))
      setReply('')
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Your reply could not be published.')
    } finally {
      setSubmittingReply(false)
    }
  }

  async function togglePostLike() {
    if (likingPost) return
    setLikingPost(true)
    setError('')
    try {
      setPost(await setSocialPostLike(post.id, !post.likedByMe))
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : 'Could not update this like.')
    } finally {
      setLikingPost(false)
    }
  }

  async function togglePostBookmark() {
    if (bookmarkingPost) return
    setBookmarkingPost(true)
    setError('')
    try {
      const bookmarkedByMe = !post.bookmarkedByMe
      await setSocialPostBookmark(post.id, bookmarkedByMe)
      setPost((current) => ({ ...current, bookmarkedByMe }))
      setNotice(bookmarkedByMe ? 'Post saved to your account.' : 'Post removed from your saved posts.')
    } catch (bookmarkError) {
      setError(bookmarkError instanceof Error ? bookmarkError.message : 'Could not update your saved post.')
    } finally {
      setBookmarkingPost(false)
    }
  }

  async function savePostEdit(text) {
    const updatedPost = await updateSocialPost(post.id, text, post.images)
    setPost(updatedPost)
    setEditingPost(false)
    setNotice('Your post was updated.')
  }

  async function removePost() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    setError('')
    try {
      await deleteSocialPost(post.id)
      navigate('/app/home', { replace: true })
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Your post could not be deleted.')
      setMenuOpen(false)
    }
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
        setNotice(`Copy this post link: ${url}`)
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      setNotice('This browser could not share the post. You can copy its URL from the address bar.')
    }
  }

  return (
    <div className="app-content-width post-detail-page">
      <PageMeta title={`Post by ${post.name}`} description={post.text} />
      <Link to="/app/home" className="post-detail-back"><ArrowLeft size={17} /><span>Back to feed</span></Link>
      <section className="post-detail-card">
        <div className="post-detail-heading">
          <div><span className="app-page-eyebrow">POST DETAILS</span><h1>Conversation</h1></div>
          <button type="button" className="quiet-icon-button" aria-label={`More options for ${post.name}'s post`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={20} /></button>
          {menuOpen && <div className="feed-post-menu post-detail-menu" role="menu">
            {post.isMine && <>
              <button type="button" role="menuitem" onClick={() => { setEditingPost(true); setMenuOpen(false) }}><Pencil size={15} />Edit post</button>
              <button type="button" role="menuitem" className="feed-post-delete-action" onClick={removePost}><Trash2 size={15} />Delete post</button>
            </>}
            <button type="button" role="menuitem" onClick={() => { togglePostBookmark(); setMenuOpen(false) }}><Bookmark size={15} />{post.bookmarkedByMe ? 'Unsave post' : 'Save post'}</button>
          </div>}
        </div>
        <article className="post-detail-original">
          <div className="feed-card-header">
            <Avatar person={{ name: post.name, image: post.avatar }} />
            <div className="feed-author"><strong>{post.name}</strong><span>{post.handle}</span></div>
          </div>
          {editingPost
            ? <PostEditForm initialText={post.text} onCancel={() => setEditingPost(false)} onSave={savePostEdit} />
            : <p className="post-detail-copy">{post.text}</p>}
          {!!post.images?.length && <div className="post-detail-gallery">{post.images.map((image, index) => <img key={`${image}-${index}`} className="post-detail-image" src={resolveFeedImageUrl(image)} alt={`Photo ${index + 1} shared by ${post.name}`} />)}</div>}
          <p className="post-detail-time">{post.time === 'just now' ? 'Just now' : `${post.time} ago`} · Shared with their circle</p>
          <div className="post-detail-stats"><span><strong>{post.likes}</strong> likes</span><span><strong>{post.comments}</strong> replies</span></div>
          <div className="post-detail-actions">
            <button type="button" className={post.likedByMe ? 'post-detail-action liked' : 'post-detail-action'} onClick={togglePostLike} disabled={likingPost} aria-pressed={post.likedByMe}><Heart size={19} fill={post.likedByMe ? 'currentColor' : 'none'} /><span>{post.likedByMe ? 'Liked' : 'Like'}</span></button>
            <button type="button" className="post-detail-action" onClick={() => { replyInput.current?.focus(); replyInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><MessageCircle size={19} /><span>Reply</span></button>
            <button type="button" className={post.bookmarkedByMe ? 'post-detail-action saved' : 'post-detail-action'} onClick={togglePostBookmark} disabled={bookmarkingPost} aria-pressed={post.bookmarkedByMe}><Bookmark size={18} fill={post.bookmarkedByMe ? 'currentColor' : 'none'} /><span>{post.bookmarkedByMe ? 'Saved' : 'Save'}</span></button>
            <button type="button" className="post-detail-action" onClick={sharePost}><Send size={18} /><span>Share</span></button>
          </div>
        </article>
        <section className="post-replies-section" aria-label="Replies">
          <div className="post-replies-heading"><h2>Replies</h2><span>{post.comments}</span></div>
          <form id="reply-composer" className="post-reply-composer" onSubmit={addReply}>
            <Avatar person={{ name: 'You' }} />
            <label><span className="sr-only">Write a reply</span><textarea ref={replyInput} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a thoughtful reply…" rows={2} maxLength={280} /></label>
            <button type="submit" className="app-primary-button" disabled={!reply.trim() || submittingReply}><Send size={15} /><span>{submittingReply ? 'Sending…' : 'Reply'}</span></button>
          </form>
          {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
          {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
          <p className="post-detail-preview-note">Replies, likes, and saved posts are connected to your account.</p>
          <div className="post-replies-list">
            {comments.map((comment) => <article className="post-reply" key={comment.id}><Avatar person={{ name: comment.name, image: comment.avatar }} /><div className="post-reply-body"><div className="post-reply-author"><strong>{comment.name}</strong><span>{comment.handle} · {comment.time}</span></div><p>{comment.text}</p></div></article>)}
            {!comments.length && <p className="inbox-empty-state">No replies yet. Start the conversation.</p>}
          </div>
        </section>
      </section>
    </div>
  )
}
