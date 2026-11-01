import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Image as ImageIcon, MessageCircle, PenLine, X } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { apiRequest } from '../../utils/api.js'
import { uploadImage } from '../../utils/mediaApi.js'
import { createSocialPost } from '../../utils/socialApi.js'

const maxImages = 5

export default function CreatePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [caption, setCaption] = useState(location.state?.prompt ?? '')
  const [images, setImages] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [user, setUser] = useState(null)
  const [accountError, setAccountError] = useState('')
  const [error, setError] = useState('')
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    const previews = images.map((file) => URL.createObjectURL(file))
    setImagePreviews(previews)
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [images])

  useEffect(() => {
    let active = true
    apiRequest('/api/auth/me')
      .then((payload) => {
        if (active) {
          setUser(payload.user)
          setAccountError('')
        }
      })
      .catch((loadError) => {
        if (active) setAccountError(loadError instanceof Error ? loadError.message : 'Could not load your account.')
      })
    return () => { active = false }
  }, [])

  async function publishPost(event) {
    event.preventDefault()
    if (!caption.trim() || publishing || !user) return
    setPublishing(true)
    setError('')
    try {
      const imageUrls = []
      for (const image of images) imageUrls.push(await uploadImage(image))
      const post = await createSocialPost(caption.trim(), imageUrls)
      navigate(`/app/post/${post.id}`)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Your post could not be published.')
    } finally {
      setPublishing(false)
    }
  }

  function suggestCaption() {
    const suggestion = 'A little moment I wanted to keep. What made you smile today?'
    setCaption((current) => current.trim() ? `${current.trim()}\n\n${suggestion}` : suggestion)
    setError('')
  }

  function chooseImages(event) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length + images.length > maxImages) {
      setError(`Choose up to ${maxImages} images for one post.`)
      return
    }
    const invalid = selected.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    if (invalid) {
      setError('Use JPEG, PNG, or WebP images.')
      return
    }
    setImages((current) => [...current, ...selected])
    setError('')
  }

  const author = user ? { name: user.name, avatar: '' } : { name: 'Your account', avatar: '' }

  return (
    <div className="app-content-width app-create-width">
      <Link to="/app/home" className="app-back-link"><ArrowLeft size={15} /> Back to your home</Link>
      <AppPageHeader eyebrow="MAKE SOMETHING YOURS" title="Create a post" description="Share a text update and up to five photos with your iConnect feed." />
      <div className="create-account-banner"><PenLine size={16} /><span>Your post and photos are saved to iConnect and shown to signed-in members.</span></div>
      {accountError && <p className="feed-interaction-notice feed-error" role="alert">{accountError}</p>}
      <form className="create-layout" onSubmit={publishPost}>
        <section className="create-editor-card">
          <div className="create-author"><Avatar person={author} /><span><strong>{author.name}</strong><small>Posting to the iConnect feed</small></span><span className="audience-select">iConnect feed</span></div>
          <textarea value={caption} onChange={(event) => { setCaption(event.target.value); setError('') }} placeholder="What would you like to share with your people?" rows={7} maxLength={500} aria-label="Post text" required />
          <label className="media-upload-picker"><ImageIcon size={18} /><span>Add photos</span><small>{images.length}/{maxImages} · JPEG, PNG or WebP · optimized on upload</small><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} disabled={publishing || images.length >= maxImages} /></label>
          {!!images.length && <div className="media-upload-previews">{images.map((image, index) => <div className="media-upload-preview" key={`${image.name}-${image.lastModified}-${index}`}><img src={imagePreviews[index]} alt={`Selected photo ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setImages((current) => current.filter((_, imageIndex) => imageIndex !== index))} disabled={publishing}><X size={15} /></button></div>)}</div>}
          <div className="create-editor-tools"><button type="button" onClick={suggestCaption}><MessageCircle size={18} /><span>Caption idea</span></button><span>{caption.length}/500</span></div>
          {error && <p className="create-notice feed-error" role="alert">{error}</p>}
          <div className="create-footer"><button className="draft-button" type="button" onClick={() => { setCaption(''); setImages([]); setError('') }} disabled={publishing}><X size={15} /> Clear draft</button><button className="app-primary-button" type="submit" disabled={publishing || !caption.trim() || !user}>{publishing ? 'Uploading and publishing…' : 'Publish post'} <ArrowRight size={16} /></button></div>
        </section>
        <aside className="create-options">
          <section className="create-option-card"><div className="create-option-heading"><span>01</span><div><h2>Where it appears</h2><p>Your post is saved in iConnect.</p></div></div><div className="destination-list"><div className="destination-option destination-selected"><span className="destination-icon">i</span><span><strong>iConnect feed</strong><small>Persistent text post</small></span><span className="destination-checkbox">✓</span></div><p className="schedule-note">Your post is not shared with other social platforms.</p></div></section>
          <section className="create-option-card"><div className="create-option-heading"><span>02</span><div><h2>Keep it yours</h2><p>Only publish text you’re comfortable sharing with other iConnect members.</p></div></div></section>
        </aside>
      </form>
      <p className="create-disclaimer">Photos are uploaded securely and stored with your post. Video uploads and scheduled posts are not available.</p>
    </div>
  )
}
