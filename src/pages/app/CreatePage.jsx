import React, { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarClock, Check, ImagePlus, MessageCircle, PenLine, Send, Video, X } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoAvatar, getDemoProfile } from '../../utils/demoAccount.js'
import { addDemoPost, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'
import { createSocialPost } from '../../utils/socialApi.js'

export default function CreatePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const imageInput = useRef(null)
  const profile = getDemoProfile()
  const author = { name: profile?.name ?? 'Taylor Reed', image: profile?.avatar ?? demoAvatar }
  const [caption, setCaption] = useState(location.state?.prompt ?? '')
  const [image, setImage] = useState(null)
  const [mediaType, setMediaType] = useState('image')
  const [notice, setNotice] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)

  function chooseImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const fileMediaType = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
    if (!fileMediaType || (fileMediaType === 'video' && !['video/mp4', 'video/webm'].includes(file.type))) {
      setNotice('Choose a supported image, MP4, or WebM file for your demo post.')
      return
    }
    if (file.size > 800_000) {
      setNotice('Choose a media file under 800 KB so it can fit in this browser demo.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setNotice('This image could not be previewed. Try another image.')
        return
      }
      setImage(reader.result)
      setMediaType(fileMediaType)
      setNotice('')
    }
    reader.onerror = () => setNotice('This image could not be read. Try another image.')
    reader.readAsDataURL(file)
  }

  function suggestCaption() {
    const suggestion = 'A little moment I wanted to keep. What made you smile today?'
    setCaption((current) => current.trim() ? `${current.trim()}\n\n${suggestion}` : suggestion)
    setNotice('Added a caption idea. Make it your own before sharing.')
  }

  function discardDraft() {
    setCaption('')
    setImage(null)
    setMediaType('image')
    if (imageInput.current) imageInput.current.value = ''
    setNotice('Your draft has been cleared.')
  }

  async function preparePost(event) {
    event.preventDefault()
    if (!caption.trim()) {
      setNotice('Add a caption before preparing your post.')
      return
    }

    setPublishing(true)
    try {
      if (!image) {
        const post = await createSocialPost(caption.trim())
        navigate(`/app/post/${post.id}`)
        return
      }

      const currentState = readDemoFeedState()
      const nextState = addDemoPost(currentState, {
        name: author.name,
        email: profile?.email ?? 'demo@example.com',
        text: caption.trim(),
        image,
        mediaType,
      })
      writeDemoFeedState(nextState)
      navigate(`/app/post/${nextState.posts[0].id}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : image
        ? 'Your preview post could not be saved in this browser.'
        : 'Your post could not be published.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="app-content-width app-create-width">
      <Link to="/app/home" className="app-back-link"><ArrowLeft size={15} /> Back to your home</Link>
      <AppPageHeader eyebrow="MAKE SOMETHING YOURS" title="Create a post" description="Write a text update for your iConnect feed, or preview a post with media." />
      <div className="create-demo-banner"><PenLine size={16} /> {image ? 'Media uploads are not connected. Posts with a photo or video are saved only in this browser preview.' : 'Text updates publish to your iConnect account. Photo/video uploads and scheduling are not connected yet.'}</div>
      <form className="create-layout" onSubmit={preparePost}>
        <section className="create-editor-card">
          <div className="create-author"><Avatar person={author} /><span><strong>{author.name}</strong><small>{image ? 'Local media preview' : 'Posting to your iConnect account'}</small></span><span className="audience-select">Everyone <span>⌄</span></span></div>
          <textarea value={caption} onChange={(event) => { setCaption(event.target.value); setNotice('') }} placeholder="What would you like to share with your people?" rows={7} maxLength={500} aria-label="Post caption" />
          <div className="create-editor-tools"><button type="button" onClick={() => imageInput.current?.click()}><ImagePlus size={19} /><span>Photo or video</span></button><button type="button" onClick={suggestCaption}><MessageCircle size={18} /><span>Caption ideas</span></button><span>{caption.length}/500</span></div>
          <input ref={imageInput} className="create-image-input" type="file" accept="image/*,video/mp4,video/webm" onChange={chooseImage} />
          <div className={`create-upload-placeholder ${image ? 'has-image' : ''}`}>{image ? mediaType === 'video' ? <video src={image} controls playsInline aria-label="Selected video preview" /> : <img src={image} alt="Selected post preview" /> : <><Video size={24} /><strong>Add a photo or video</strong><span>Images, MP4, or WebM · up to 800 KB</span><button type="button" onClick={() => imageInput.current?.click()}>Choose from device</button></>}</div>
          {image && <button type="button" className="create-remove-image" onClick={() => { setImage(null); setMediaType('image'); if (imageInput.current) imageInput.current.value = '' }}>Remove media</button>}
          {notice && <p className="create-notice" role="status">{notice}</p>}
          <div className="create-footer"><button className="draft-button" type="button" onClick={discardDraft} disabled={publishing}><X size={15} /> Discard</button><button className="app-primary-button" type="submit" disabled={publishing || !caption.trim()}>{publishing ? 'Publishing…' : image ? 'Save preview to my feed' : 'Publish text update'} <ArrowRight size={16} /></button></div>
        </section>
        <aside className="create-options">
          <section className="create-option-card"><div className="create-option-heading"><span>01</span><div><h2>Choose destinations</h2><p>Select where you’d like to share.</p></div></div>
            <div className="destination-list"><div className="destination-option destination-selected"><span className="destination-icon">i</span><span><strong>iConnect</strong><small>Saved to your local demo feed</small></span><span className="destination-checkbox"><Check size={12} /></span></div><p className="schedule-note">Other social platforms aren’t connected in this demo.</p></div>
          </section>
          <section className="create-option-card"><div className="create-option-heading"><span>02</span><div><h2>When to share</h2><p>Post now or plan it for later.</p></div></div><button type="button" className="schedule-option" onClick={() => setScheduleOpen((open) => !open)}><CalendarClock size={17} /><span><strong>{scheduleOpen ? 'Choose a time' : 'Schedule for later'}</strong><small>Scheduling is not connected in preview</small></span><span>{scheduleOpen ? '−' : '+'}</span></button>{scheduleOpen && <p className="schedule-note">Your post won’t be scheduled. This control demonstrates the planned workflow.</p>}</section>
        </aside>
      </form>
      <p className="create-disclaimer">{image ? 'This post with media stays in this browser preview and is not published to your account.' : 'Text-only posts are published to your account. Other destinations and scheduled publishing are not connected.'}</p>
    </div>
  )
}
