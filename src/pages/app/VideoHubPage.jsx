import React from 'react'
import { Clapperboard, Film, Radio, ShieldCheck, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'

const mediaFeatures = [
  { title: 'Video library', detail: 'No persistent video feed or media storage is connected.', icon: Film },
  { title: 'Video uploads', detail: 'Selecting a file will not publish it to iConnect.', icon: Upload },
  { title: 'Live video', detail: 'No live-streaming provider or broadcast service is connected.', icon: Radio },
]

export default function VideoHubPage() {
  return (
    <div className="app-content-width video-unavailable-page">
      <AppPageHeader
        eyebrow="VIDEO · NOT CONNECTED"
        title="Watch & share"
        description="A home for short videos and longer stories, once secure media services are available."
      />
      <section className="video-unavailable-card" role="status">
        <span className="video-unavailable-icon"><Clapperboard size={22} /></span>
        <div>
          <span className="app-page-eyebrow">MEDIA SERVICES UNAVAILABLE</span>
          <h2>Video is not connected.</h2>
          <p>There is no backend media storage, video feed, or streaming provider. This page cannot upload, publish, or broadcast video, and it does not save activity to this browser.</p>
        </div>
      </section>
      <section className="video-capabilities" aria-label="Video feature status">
        {mediaFeatures.map(({ title, detail, icon: Icon }) => (
          <article key={title}>
            <span><Icon size={17} /></span>
            <div><h3>{title}</h3><p>{detail}</p></div>
            <small>NOT CONNECTED</small>
          </article>
        ))}
      </section>
      <div className="video-feed-link">
        <ShieldCheck size={17} />
        <p><strong>Want to share an update?</strong> The text feed supports persistent posts, likes, bookmarks, and comments.</p>
        <Link to="/app/home">Open the feed</Link>
      </div>
    </div>
  )
}
