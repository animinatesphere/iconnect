import React, { useEffect, useState } from 'react'
import { CheckCircle2, Clapperboard, Film, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { uploadVideo } from '../../utils/videoApi.js'

const MAX_VIDEO_BYTES = 250 * 1024 * 1024
const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/webm']

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function VideoStudioPage() {
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [published, setPublished] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function chooseFile(event) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    setError('')
    setPublished(false)
    if (!SUPPORTED_VIDEO_TYPES.includes(selected.type)) {
      setError('Choose an MP4 or WebM video.')
      return
    }
    if (selected.size > MAX_VIDEO_BYTES) {
      setError('Videos must be 250 MB or smaller.')
      return
    }
    setFile(selected)
    setTitle((current) => current || selected.name.replace(/\.[^.]+$/, '').slice(0, 120))
  }

  async function publish(event) {
    event.preventDefault()
    if (!file || uploading) return
    setUploading(true)
    setProgress(0)
    setError('')
    setPublished(false)
    try {
      await uploadVideo(file, { title: title.trim(), caption: caption.trim(), onProgress: setProgress })
      setPublished(true)
      setFile(null)
      setTitle('')
      setCaption('')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not publish this video.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="app-content-width video-hub-page video-studio-page">
      <AppPageHeader
        eyebrow="CREATOR STUDIO"
        title="Make a video post"
        description="Upload a clip, add context, and publish it to the member video library."
      >
        <Link className="app-secondary-button" to="/app/videos">Browse videos</Link>
      </AppPageHeader>

      <div className="video-hub-grid video-studio-layout">
        <form className="video-studio-card video-studio-form" onSubmit={publish}>
          <div className="video-studio-heading">
            <span><Clapperboard size={18} /></span>
            <div><h2>Video details</h2><p>Your video is only available to signed-in members.</p></div>
          </div>

          <label className="video-form-field">Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required placeholder="Give your video a title" />
          </label>
          <label className="video-form-field">Caption <span className="video-field-optional">Optional · {caption.length}/500</span>
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} rows={4} placeholder="Add a little context for viewers" />
          </label>

          <label className="video-upload-dropzone">
            <Upload size={20} />
            <strong>{file ? 'Choose a different video' : 'Choose an MP4 or WebM video'}</strong>
            <small>{file ? `${file.name} · ${formatBytes(file.size)}` : 'Maximum file size: 250 MB'}</small>
            <input type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={chooseFile} disabled={uploading} />
          </label>

          {previewUrl && <div className="video-upload-preview"><video controls playsInline preload="metadata" src={previewUrl} /><button type="button" onClick={() => setFile(null)} disabled={uploading}>Remove selected video</button></div>}

          {error && <p className="video-error-message" role="alert">{error}</p>}
          {published && <div className="video-success-message" role="status"><CheckCircle2 size={16} /><span>Your video is published.</span><Link to="/app/videos?view=mine">View your uploads</Link></div>}

          {uploading && <div className="video-upload-progress" role="status" aria-live="polite">
            <div><span>Uploading video…</span><strong>{progress}%</strong></div>
            <progress max="100" value={progress} aria-label="Video upload progress" />
            <small>Keep this page open until the upload finishes.</small>
          </div>}

          <button type="submit" className="app-primary-button video-publish-button" disabled={!file || !title.trim() || uploading}>
            {uploading ? 'Uploading…' : <><Film size={15} /> Publish video</>}
          </button>
          <p className="video-upload-footnote">MP4 and WebM are supported. Uploads are limited to 250 MB and use your VPS media storage.</p>
        </form>

        <aside className="video-studio-column">
          <section className="video-campaign-summary">
            <div><CheckCircle2 size={16} /><strong>Before you publish</strong></div>
            <p>Use a video you have permission to share. Add a clear title so members can find it in search.</p>
            <small>Playback and uploads require a signed-in iConnect account. Live streaming and transcoding are not included.</small>
          </section>
          <section className="video-campaign-summary">
            <div><Film size={16} /><strong>Supported formats</strong></div>
            <p>MP4 (H.264/AAC recommended) or WebM (VP8/VP9).</p>
            <small>Playback depends on browser codec support. A 250 MB limit applies to each uploaded file.</small>
          </section>
        </aside>
      </div>
    </div>
  )
}
