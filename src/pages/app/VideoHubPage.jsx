import React, { useEffect, useState } from 'react'
import { Clapperboard, Film, Search, Trash2, Upload } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { deleteVideo, getVideos } from '../../utils/videoApi.js'

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export default function VideoHubPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') === 'mine' ? 'mine' : 'all'
  const [query, setQuery] = useState('')
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    if (query.trim().length === 1) {
      setVideos([])
      setLoading(false)
      setError('')
      return () => { active = false }
    }

    setLoading(true)
    const timer = window.setTimeout(() => {
      getVideos({ query, view })
        .then((results) => {
          if (!active) return
          setVideos(results)
          setError('')
        })
        .catch((loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load videos.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, query.trim() ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, retry, view])

  async function removeVideo(video) {
    if (!window.confirm(`Delete “${video.title}”? This permanently removes the video.`)) return
    setDeletingId(video.id)
    setError('')
    try {
      await deleteVideo(video.id)
      setVideos((current) => current.filter((item) => item.id !== video.id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this video.')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <div className="app-content-width video-hub-page">
      <AppPageHeader
        eyebrow="VIDEO LIBRARY"
        title="Watch & share"
        description="A member video library for short clips and longer stories."
      >
        <Link className="app-primary-button video-studio-link" to="/app/studio"><Upload size={15} /> Open Studio</Link>
      </AppPageHeader>

      <div className="video-demo-banner">
        <Clapperboard size={17} />
        <span><strong>Member videos</strong> are available to signed-in iConnect members. MP4 and WebM uploads are limited to 250 MB each.</span>
      </div>

      {error && <div className="video-error-message" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}

      <section className="video-library" aria-label="Video library">
        <div className="video-library-toolbar">
          <div className="video-tabs" role="tablist" aria-label="Video collection">
            <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'video-tab-active' : ''} onClick={() => setSearchParams({})}>All videos</button>
            <button type="button" role="tab" aria-selected={view === 'mine'} className={view === 'mine' ? 'video-tab-active' : ''} onClick={() => setSearchParams({ view: 'mine' })}>My uploads</button>
          </div>
          <label className="video-search"><Search size={14} /><input value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos" aria-label="Search videos" /></label>
        </div>

        {loading ? (
          <div className="video-empty-state" role="status"><span><Film size={21} /></span><h2>Loading videos…</h2><p>Your video library is being refreshed.</p></div>
        ) : error ? (
          <div className="video-empty-state" role="status"><span><Film size={21} /></span><h2>Videos could not load</h2><p>Check your connection and use the retry option above.</p></div>
        ) : videos.length ? (
          <div className="video-card-grid">
            {videos.map((video) => (
              <article className="video-card" key={video.id}>
                <div className="video-card-player">
                  <video controls playsInline preload="metadata" src={video.url} aria-label={`Play ${video.title}`} />
                  <span>{video.contentType === 'video/webm' ? 'WEBM' : 'MP4'}</span>
                </div>
                <div className="video-card-info">
                  <Avatar person={{ name: video.author.name, image: video.author.image }} />
                  <div>
                    <h2>{video.title}</h2>
                    <p>{video.author.name} · @{video.author.username}</p>
                    <small>{formatDate(video.createdAt)} · {formatBytes(video.fileSize)}</small>
                  </div>
                </div>
                {video.caption && <p className="video-card-caption">{video.caption}</p>}
                {view === 'mine' && (
                  <div className="video-card-actions">
                    <button type="button" disabled={deletingId === video.id} onClick={() => removeVideo(video)}>
                      <Trash2 size={14} /> {deletingId === video.id ? 'Deleting…' : 'Delete video'}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="video-empty-state">
            <span><Film size={21} /></span>
            <h2>{query.trim().length === 1 ? 'Keep typing to search' : view === 'mine' ? 'Your studio is ready' : 'No videos yet'}</h2>
            <p>{query.trim().length === 1 ? 'Search with at least two characters.' : view === 'mine' ? 'Publish your first video and it will appear here.' : 'Be one of the first members to publish a video.'}</p>
            {!query.trim() && <Link className="app-secondary-button" to="/app/studio">Upload a video</Link>}
          </div>
        )}
      </section>
    </div>
  )
}
