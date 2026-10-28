import React, { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Check, CircleDollarSign, Clapperboard, Film, Heart, Play, Plus, Search, Share2, ShieldCheck, Upload, Video } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoAvatar, getDemoProfile } from '../../utils/demoAccount.js'
import { getDemoAdminSettings } from '../../utils/demoAdmin.js'
import { emptyDemoFeedState, readDemoFeedState, writeDemoFeedState, addDemoPost } from '../../utils/demoFeed.js'

const videoFormats = [
  { id: 'short', label: 'Short video', detail: 'Vertical, quick-watch format' },
  { id: 'long', label: 'Video', detail: 'Standard video post' },
]

export default function VideoHubPage() {
  const fileInput = useRef(null)
  const profile = getDemoProfile()
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('For you')
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [format, setFormat] = useState('short')
  const [promotionPostId, setPromotionPostId] = useState('')
  const [dailyBudget, setDailyBudget] = useState('10')
  const [campaignDays, setCampaignDays] = useState('3')
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({ videoUploadsEnabled: true, campaignDraftsEnabled: true })
  const author = { name: profile?.name ?? 'Taylor Reed', image: profile?.avatar ?? demoAvatar }

  React.useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
      setSettings(getDemoAdminSettings())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your local video library.')
    } finally {
      setLoaded(true)
    }
  }, [])

  const videos = useMemo(() => {
    return feedState.posts.filter((post) => post.mediaType === 'video')
  }, [feedState.posts])

  const visibleVideos = videos.filter((post) => {
    if (tab === 'Shorts') return post.videoFormat === 'short'
    if (tab === 'Videos') return post.videoFormat !== 'short'
    if (tab === 'Saved') return feedState.savedPostIds.includes(post.id)
    if (tab === 'History') return feedState.watchedVideoIds.includes(post.id)
    return true
  }).filter((post) => `${post.videoTitle ?? ''} ${post.text} ${post.name}`.toLowerCase().includes(search.trim().toLowerCase()))

  function chooseVideo(event) {
    if (!settings.videoUploadsEnabled) {
      setError('Video uploads are disabled by the local admin demo setting.')
      return
    }
    const file = event.target.files?.[0]
    if (!file) return
    if (!['video/mp4', 'video/webm'].includes(file.type)) {
      setError('Choose an MP4 or WebM video for this browser demo.')
      event.target.value = ''
      return
    }
    if (file.size > 800_000) {
      setError('Choose a video under 800 KB to fit in browser storage.')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('This video could not be previewed. Try another file.')
        return
      }
      setVideoUrl(reader.result)
      setError('')
    }
    reader.onerror = () => setError('This video could not be read. Try another file.')
    reader.readAsDataURL(file)
  }

  function publishVideo(event) {
    event.preventDefault()
    if (!settings.videoUploadsEnabled) {
      setError('Video uploads are disabled by the local admin demo setting.')
      return
    }
    if (!title.trim() || !caption.trim() || !videoUrl) {
      setError('Add a title, description, and video before saving your demo post.')
      return
    }

    try {
      const current = readDemoFeedState()
      const updated = addDemoPost(current, {
        name: author.name,
        email: profile?.email ?? 'demo@example.com',
        text: caption.trim(),
        image: videoUrl,
        mediaType: 'video',
      })
      updated.posts[0].videoTitle = title.trim()
      updated.posts[0].videoFormat = format
      updated.posts[0].tag = format === 'short' ? 'Short video · demo' : 'Video · demo'
      writeDemoFeedState(updated)
      setFeedState(updated)
      setTitle('')
      setCaption('')
      setVideoUrl('')
      if (fileInput.current) fileInput.current.value = ''
      setTab('For you')
      setError('')
      setNotice('Video added to your browser-only library. It was not uploaded to another platform.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The video could not be saved in this browser.')
    }
  }

  function toggleSaved(post) {
    try {
      const current = readDemoFeedState()
      const savedPostIds = current.savedPostIds.includes(post.id)
        ? current.savedPostIds.filter((id) => id !== post.id)
        : [...current.savedPostIds, post.id]
      const updated = { ...current, savedPostIds }
      writeDemoFeedState(updated)
      setFeedState(updated)
      setNotice(savedPostIds.includes(post.id) ? 'Video saved in this browser.' : 'Video removed from your saved list.')
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update your saved videos.')
    }
  }

  function toggleLike(post) {
    try {
      const current = readDemoFeedState()
      const likedPostIds = current.likedPostIds.includes(post.id)
        ? current.likedPostIds.filter((id) => id !== post.id)
        : [...current.likedPostIds, post.id]
      const updated = { ...current, likedPostIds }
      writeDemoFeedState(updated)
      setFeedState(updated)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update your reaction.')
    }
  }

  function recordWatch(post) {
    try {
      const current = readDemoFeedState()
      if (current.watchedVideoIds.includes(post.id)) return
      const updated = { ...current, watchedVideoIds: [...current.watchedVideoIds, post.id] }
      writeDemoFeedState(updated)
      setFeedState(updated)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your local watch history.')
    }
  }

  async function shareVideo(post) {
    const url = `${window.location.origin}/app/post/${post.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: post.videoTitle ?? 'iConnect video', text: post.text, url })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        setNotice(`Copy this video link to share: ${url}`)
        return
      }
      setNotice('Video link shared.')
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      setError('This browser could not share the video. You can copy its URL from the address bar.')
    }
  }

  function saveCampaign(event) {
    event.preventDefault()
    if (!settings.campaignDraftsEnabled) {
      setError('Campaign drafts are disabled by the local admin demo setting.')
      return
    }
    const budget = Number(dailyBudget)
    const days = Number(campaignDays)
    if (!promotionPostId || !Number.isFinite(budget) || budget < 1 || budget > 500 || !Number.isInteger(days) || days < 1 || days > 30) {
      setError('Choose a video, a daily budget from 1–500 demo credits, and 1–30 days.')
      return
    }
    setSaving(true)
    try {
      const current = readDemoFeedState()
      const campaign = {
        id: `campaign-${Date.now()}`,
        postId: promotionPostId,
        dailyBudget: budget,
        days,
        objective: 'Reach',
        status: 'Draft demo',
        createdAt: new Date().toISOString(),
      }
      const updated = { ...current, promotionCampaigns: [...current.promotionCampaigns, campaign] }
      writeDemoFeedState(updated)
      setFeedState(updated)
      setPromotionPostId('')
      setNotice('Demo campaign saved as a draft. No payment was taken and no views are promised or generated.')
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The demo campaign could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-content-width video-hub-page">
      <Link to="/app/home" className="app-back-link"><ArrowLeft size={15} /> Back to your home</Link>
      <AppPageHeader eyebrow="VIDEO STUDIO · PREVIEW" title="Watch & create" description="A local prototype for short-form clips and longer videos." />
      <div className="video-demo-banner"><ShieldCheck size={17} /><span><strong>Browser demo only.</strong> Inspired by common video-app patterns; not affiliated with YouTube or TikTok. Uploads stay in this browser and are capped at 800 KB.</span></div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <div className="video-hub-grid">
        <section className="video-library">
          <div className="video-library-toolbar">
            <div className="video-tabs" role="tablist" aria-label="Video library">
              {['For you', 'Shorts', 'Videos', 'Saved', 'History'].map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'video-tab-active' : ''} onClick={() => setTab(item)}>{item}</button>)}
            </div>
            <label className="video-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search your video library" placeholder="Search videos" /></label>
          </div>
          {!loaded ? <p className="video-empty-state">Loading your local video library…</p> : visibleVideos.length ? <div className="video-card-grid">
            {visibleVideos.map((post) => {
              const liked = feedState.likedPostIds.includes(post.id)
              const saved = feedState.savedPostIds.includes(post.id)
              return <article className={`video-card ${post.videoFormat === 'short' ? 'video-card-short' : ''}`} key={post.id}>
                <div className="video-card-player"><video src={post.image} controls playsInline preload="metadata" onPlay={() => recordWatch(post)} aria-label={post.videoTitle ?? post.text} /><span>{post.videoFormat === 'short' ? 'SHORT' : 'VIDEO'}</span></div>
                <div className="video-card-info"><Avatar person={{ name: post.name, image: post.avatar }} /><div><h2>{post.videoTitle ?? post.text}</h2><p>{post.name} · Local demo upload</p><small>Plays are not tracked in this prototype</small></div></div>
                <div className="video-card-actions"><button type="button" onClick={() => toggleLike(post)} aria-pressed={liked}><Heart size={16} fill={liked ? 'currentColor' : 'none'} /> {post.likes + Number(liked)}</button><button type="button" onClick={() => toggleSaved(post)} aria-pressed={saved}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}</button><button type="button" onClick={() => shareVideo(post)} aria-label="Share video"><Share2 size={15} /></button><Link to={`/app/post/${post.id}`}>Comments</Link></div>
                <button type="button" className="video-promote-trigger" disabled={!settings.campaignDraftsEnabled} onClick={() => { setPromotionPostId((id) => id === post.id ? '' : post.id); setError('') }}><CircleDollarSign size={15} /> {settings.campaignDraftsEnabled ? 'Plan a promotion' : 'Campaign drafts disabled'}</button>
                {promotionPostId === post.id && <form className="video-promotion-form" onSubmit={saveCampaign}>
                  <strong>Draft a reach campaign</strong>
                  <label>Daily budget (demo credits)<input type="number" min="1" max="500" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} /></label>
                  <label>Duration (days)<input type="number" min="1" max="30" value={campaignDays} onChange={(event) => setCampaignDays(event.target.value)} /></label>
                  <p>This is a planning preview only: no money, ad delivery, or viewer guarantee.</p>
                  <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save draft campaign'}</button>
                </form>}
              </article>
            })}
          </div> : <div className="video-empty-state"><span><Play size={22} /></span><h2>{tab === 'Saved' ? 'No saved videos yet' : tab === 'History' ? 'No watch history yet' : tab === 'For you' ? 'Your demo library is empty' : `No ${tab.toLowerCase()} yet`}</h2><p>{tab === 'History' ? 'Videos you play in this browser will appear here. Playback history is local and is not an audience-view count.' : search.trim() ? 'No videos match that search. Try another title or creator.' : 'Upload a small MP4 or WebM clip to try the local player. Nothing is sent to YouTube, TikTok, or a server.'}</p><button type="button" className="app-secondary-button" onClick={() => fileInput.current?.click()}><Upload size={15} /> Choose a video</button></div>}
        </section>
        <aside className="video-studio-column">
          <form className="video-studio-card" onSubmit={publishVideo}>
            <div className="video-studio-heading"><span><Clapperboard size={17} /></span><div><h2>Upload to your library</h2><p>Only saved in this browser preview.</p></div></div>
            {!settings.videoUploadsEnabled && <p className="admin-feature-disabled">Video uploads are disabled by the local admin preview setting.</p>}
            <div className="video-format-options">{videoFormats.map((item) => <button key={item.id} type="button" className={format === item.id ? 'video-format-option is-selected' : 'video-format-option'} onClick={() => setFormat(item.id)}><span>{item.id === 'short' ? <Film size={16} /> : <Video size={16} />}</span><strong>{item.label}</strong><small>{item.detail}</small>{format === item.id && <Check size={14} />}</button>)}</div>
            <label className="video-form-field">Video title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Give your video a title" /></label>
            <label className="video-form-field">Description<textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={300} rows={3} placeholder="Tell people what this clip is about" /></label>
            <input ref={fileInput} className="create-image-input" type="file" accept="video/mp4,video/webm" onChange={chooseVideo} />
            {videoUrl ? <div className="video-upload-preview"><video src={videoUrl} controls playsInline aria-label="Video upload preview" /><button type="button" onClick={() => { setVideoUrl(''); if (fileInput.current) fileInput.current.value = '' }}>Remove video</button></div> : <button type="button" className="video-upload-dropzone" onClick={() => fileInput.current?.click()} disabled={!settings.videoUploadsEnabled}><Plus size={19} /><strong>Select a video</strong><small>MP4 or WebM · max 800 KB</small></button>}
            <button type="submit" className="app-primary-button video-publish-button" disabled={!settings.videoUploadsEnabled}><Upload size={15} /> Save to my library</button>
            <p className="video-upload-footnote">No transcoding, public publishing, or platform integration in this preview.</p>
          </form>
          <section className="video-campaign-summary"><div><CircleDollarSign size={17} /><strong>Promotion drafts</strong></div><p>{feedState.promotionCampaigns.length ? `${feedState.promotionCampaigns.length} local draft${feedState.promotionCampaigns.length === 1 ? '' : 's'} saved.` : 'No draft campaigns yet.'}</p><small>{settings.campaignDraftsEnabled ? 'A real ad product would need review, billing, and delivery systems.' : 'Campaign drafts are disabled by the local admin preview setting.'}</small></section>
        </aside>
      </div>
    </div>
  )
}
