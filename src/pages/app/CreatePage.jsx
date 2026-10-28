import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarClock, Check, ImagePlus, Instagram, Linkedin, MessageCircle, PenLine, Send, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'

const destinations = ['iConnect', 'Instagram', 'LinkedIn', 'X']

export default function CreatePage() {
  const [caption, setCaption] = useState('')
  const [selected, setSelected] = useState(['iConnect'])
  const [notice, setNotice] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)

  function toggleDestination(destination) {
    setSelected((current) => current.includes(destination) ? current.filter((item) => item !== destination) : [...current, destination])
  }

  function preparePost(event) {
    event.preventDefault()
    if (!caption.trim()) {
      setNotice('Add a caption before preparing your post.')
      return
    }
    setNotice('Preview only — your post has not been published or scheduled.')
  }

  return (
    <div className="app-content-width app-create-width">
      <Link to="/app/home" className="app-back-link"><ArrowLeft size={15} /> Back to your home</Link>
      <AppPageHeader eyebrow="MAKE SOMETHING YOURS" title="Create a post" description="Shape a thought, then decide where it belongs." />
      <div className="create-demo-banner"><PenLine size={16} /> Composer concept · Publishing integrations aren’t connected in this preview.</div>
      <form className="create-layout" onSubmit={preparePost}>
        <section className="create-editor-card">
          <div className="create-author"><Avatar person={{ name: 'Taylor Reed', image: 'photo-1544005313-94ddf0286df2' }} /><span><strong>Taylor Reed</strong><small>Posting to your iConnect feed</small></span><span className="audience-select">Everyone <span>⌄</span></span></div>
          <textarea value={caption} onChange={(event) => { setCaption(event.target.value); setNotice('') }} placeholder="What would you like to share with your people?" rows={7} maxLength={500} aria-label="Post caption" />
          <div className="create-editor-tools"><button type="button" aria-label="Add image, unavailable in preview"><ImagePlus size={19} /><span>Photo</span></button><button type="button" aria-label="Suggest a caption, unavailable in preview"><MessageCircle size={18} /><span>Caption ideas</span></button><span>{caption.length}/500</span></div>
          <div className="create-upload-placeholder"><ImagePlus size={24} /><strong>Add a photo or video</strong><span>Media upload is shown as a design preview only</span><button type="button">Choose from device</button></div>
          {notice && <p className="create-notice" role="status">{notice}</p>}
          <div className="create-footer"><button className="draft-button" type="button" onClick={() => setNotice('Drafts aren’t saved in this preview.')}><X size={15} /> Discard</button><button className="app-primary-button" type="submit">Preview post <ArrowRight size={16} /></button></div>
        </section>
        <aside className="create-options">
          <section className="create-option-card"><div className="create-option-heading"><span>01</span><div><h2>Choose destinations</h2><p>Select where you’d like to share.</p></div></div>
            <div className="destination-list">{destinations.map((destination) => <button type="button" className={`destination-option ${selected.includes(destination) ? 'destination-selected' : ''}`} onClick={() => toggleDestination(destination)} key={destination}><span className={`destination-icon ${destination.toLowerCase().replace(' ', '-')}`}>{destination === 'Instagram' ? <Instagram size={16} /> : destination === 'LinkedIn' ? <Linkedin size={16} /> : destination === 'X' ? '𝕏' : 'i'}</span><span><strong>{destination}</strong><small>{destination === 'iConnect' ? 'Included in this preview' : 'Integration not connected'}</small></span><span className="destination-checkbox">{selected.includes(destination) && <Check size={12} />}</span></button>)}</div>
          </section>
          <section className="create-option-card"><div className="create-option-heading"><span>02</span><div><h2>When to share</h2><p>Post now or plan it for later.</p></div></div><button type="button" className="schedule-option" onClick={() => setScheduleOpen((open) => !open)}><CalendarClock size={17} /><span><strong>{scheduleOpen ? 'Choose a time' : 'Schedule for later'}</strong><small>Scheduling is not connected in preview</small></span><span>{scheduleOpen ? '−' : '+'}</span></button>{scheduleOpen && <p className="schedule-note">Your post won’t be scheduled. This control demonstrates the planned workflow.</p>}</section>
        </aside>
      </form>
      <p className="create-disclaimer">Your draft stays in this browser session. Nothing is published, transmitted, or stored.</p>
    </div>
  )
}
