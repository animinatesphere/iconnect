import React, { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarClock, Check, ImagePlus, MessageCircle, PenLine, Send, X } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoAvatar, getDemoProfile } from '../../utils/demoAccount.js'
import { addDemoPost, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'

export default function CreatePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const imageInput = useRef(null)
  const profile = getDemoProfile()
  const author = { name: profile?.name ?? 'Taylor Reed', image: demoAvatar }
  const [caption, setCaption] = useState(location.state?.prompt ?? '')
  const [image, setImage] = useState(null)
  const [notice, setNotice] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)

  function chooseImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setNotice('Choose an image file to add to your demo post.')
      return
    }
    if (file.size > 800_000) {
      setNotice('Choose an image under 800 KB so it can fit in this browser demo.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setNotice('This image could not be previewed. Try another image.')
        return
      }
      setImage(reader.result)
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
    if (imageInput.current) imageInput.current.value = ''
    setNotice('Your draft has been cleared.')
  }

  function preparePost(event) {
    event.preventDefault()
    if (!caption.trim()) {
      setNotice('Add a caption before preparing your post.')
      return
    }

    try {
      const currentState = readDemoFeedState()
      const nextState = addDemoPost(currentState, {
        name: author.name,
        email: profile?.email ?? 'demo@example.com',
        text: caption.trim(),
        image,
      })
      writeDemoFeedState(nextState)
      navigate(`/app/post/${nextState.posts[0].id}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Your post could not be saved in this browser.')
    }
  }

  return (
    <div className="app-content-width app-create-width">
      <Link to="/app/home" className="app-back-link"><ArrowLeft size={15} /> Back to your home</Link>
      <AppPageHeader eyebrow="MAKE SOMETHING YOURS" title="Create a post" description="Shape a thought, then decide where it belongs." />
      <div className="create-demo-banner"><PenLine size={16} /> Composer concept · Publishing integrations aren’t connected in this preview.</div>
      <form className="create-layout" onSubmit={preparePost}>
        <section className="create-editor-card">
          <div className="create-author"><Avatar person={author} /><span><strong>{author.name}</strong><small>Posting to your iConnect feed</small></span><span className="audience-select">Everyone <span>⌄</span></span></div>
          <textarea value={caption} onChange={(event) => { setCaption(event.target.value); setNotice('') }} placeholder="What would you like to share with your people?" rows={7} maxLength={500} aria-label="Post caption" />
          <div className="create-editor-tools"><button type="button" onClick={() => imageInput.current?.click()}><ImagePlus size={19} /><span>Photo</span></button><button type="button" onClick={suggestCaption}><MessageCircle size={18} /><span>Caption ideas</span></button><span>{caption.length}/500</span></div>
          <input ref={imageInput} className="create-image-input" type="file" accept="image/*" onChange={chooseImage} />
          <div className={`create-upload-placeholder ${image ? 'has-image' : ''}`}>{image ? <img src={image} alt="Selected post preview" /> : <><ImagePlus size={24} /><strong>Add a photo</strong><span>Choose an image from this device (up to 800 KB)</span><button type="button" onClick={() => imageInput.current?.click()}>Choose from device</button></>}</div>
          {image && <button type="button" className="create-remove-image" onClick={() => { setImage(null); if (imageInput.current) imageInput.current.value = '' }}>Remove image</button>}
          {notice && <p className="create-notice" role="status">{notice}</p>}
          <div className="create-footer"><button className="draft-button" type="button" onClick={discardDraft}><X size={15} /> Discard</button><button className="app-primary-button" type="submit">Add to my feed <ArrowRight size={16} /></button></div>
        </section>
        <aside className="create-options">
          <section className="create-option-card"><div className="create-option-heading"><span>01</span><div><h2>Choose destinations</h2><p>Select where you’d like to share.</p></div></div>
            <div className="destination-list"><div className="destination-option destination-selected"><span className="destination-icon">i</span><span><strong>iConnect</strong><small>Saved to your local demo feed</small></span><span className="destination-checkbox"><Check size={12} /></span></div><p className="schedule-note">Other social platforms aren’t connected in this demo.</p></div>
          </section>
          <section className="create-option-card"><div className="create-option-heading"><span>02</span><div><h2>When to share</h2><p>Post now or plan it for later.</p></div></div><button type="button" className="schedule-option" onClick={() => setScheduleOpen((open) => !open)}><CalendarClock size={17} /><span><strong>{scheduleOpen ? 'Choose a time' : 'Schedule for later'}</strong><small>Scheduling is not connected in preview</small></span><span>{scheduleOpen ? '−' : '+'}</span></button>{scheduleOpen && <p className="schedule-note">Your post won’t be scheduled. This control demonstrates the planned workflow.</p>}</section>
        </aside>
      </form>
      <p className="create-disclaimer">Posts are saved only in this browser’s demo feed. Nothing is published or sent to a service.</p>
    </div>
  )
}
