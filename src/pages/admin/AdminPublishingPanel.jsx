import React, { useEffect, useState } from 'react'
import { BriefcaseBusiness, Building2, Camera, ImagePlus, Plus, X } from 'lucide-react'
import { createAdminJob, createAdminLocalListing, createAdminPost } from '../../utils/adminApi.js'
import { uploadImage } from '../../utils/mediaApi.js'

const emptyJob = {
  title: '',
  company: '',
  location: '',
  employment_type: 'Full-time',
  workplace_type: 'onsite',
  summary: '',
  description: '',
}

const emptyHome = {
  title: '',
  price: '',
  location: '',
  detail: '',
  description: '',
}

function usePhotoPreview(photo) {
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (!photo) {
      setPreview('')
      return undefined
    }
    const objectUrl = URL.createObjectURL(photo)
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [photo])

  return preview
}

function getSelectedPhoto(event, setPhoto, setError) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    setError('Choose a JPEG, PNG, or WebP photo.')
    return
  }
  setPhoto(file)
  setError('')
}

export default function AdminPublishingPanel() {
  const [activeForm, setActiveForm] = useState('job')
  const [job, setJob] = useState(emptyJob)
  const [home, setHome] = useState(emptyHome)
  const [companyPhoto, setCompanyPhoto] = useState(null)
  const [homePhoto, setHomePhoto] = useState(null)
  const [postText, setPostText] = useState('')
  const [postPhotos, setPostPhotos] = useState([])
  const [postPreviews, setPostPreviews] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const companyPreview = usePhotoPreview(companyPhoto)
  const homePreview = usePhotoPreview(homePhoto)

  useEffect(() => {
    const objectUrls = postPhotos.map((photo) => URL.createObjectURL(photo))
    setPostPreviews(objectUrls)
    return () => objectUrls.forEach((url) => URL.revokeObjectURL(url))
  }, [postPhotos])

  function choosePostPhotos(event) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length + postPhotos.length > 5) {
      setError('Choose up to five photos for one post.')
      return
    }
    if (selected.some((photo) => !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type))) {
      setError('Choose JPEG, PNG, or WebP photos.')
      return
    }
    setPostPhotos((current) => [...current, ...selected])
    setError('')
  }

  async function submitPost(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const imageUrls = []
      for (const photo of postPhotos) imageUrls.push(await uploadImage(photo))
      await createAdminPost({ text: postText, imageUrls })
      setPostText('')
      setPostPhotos([])
      setNotice('Post published to the member feed.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not publish this post.')
    } finally {
      setSaving(false)
    }
  }

  async function submitJob(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const companyImageUrl = companyPhoto ? await uploadImage(companyPhoto) : null
      await createAdminJob({ ...job, company_image_url: companyImageUrl })
      setJob(emptyJob)
      setCompanyPhoto(null)
      setNotice('Job published to the Job Hub. It is now visible to members.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not publish this job.')
    } finally {
      setSaving(false)
    }
  }

  async function submitHome(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const imageUrl = homePhoto ? await uploadImage(homePhoto) : null
      await createAdminLocalListing({ ...home, category: 'Homes', imageUrl })
      setHome(emptyHome)
      setHomePhoto(null)
      setNotice('Home listing published to the Homes marketplace. Members can see its photo and details.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not publish this home listing.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-products-layout">
      <section className="admin-panel admin-content-panel admin-publishing-panel">
        <div className="admin-panel-heading">
          <div>
            <span className="app-page-eyebrow">PUBLISH TO MEMBER PAGES</span>
            <h2>Official listings</h2>
          </div>
          <div className="admin-publish-tabs" role="tablist" aria-label="Content type">
            <button type="button" role="tab" aria-selected={activeForm === 'post'} className={activeForm === 'post' ? 'admin-publish-tab-active' : ''} onClick={() => { setActiveForm('post'); setError(''); setNotice('') }}><ImagePlus size={14} /> Post</button>
            <button type="button" role="tab" aria-selected={activeForm === 'job'} className={activeForm === 'job' ? 'admin-publish-tab-active' : ''} onClick={() => { setActiveForm('job'); setError(''); setNotice('') }}><BriefcaseBusiness size={14} /> Job</button>
            <button type="button" role="tab" aria-selected={activeForm === 'home'} className={activeForm === 'home' ? 'admin-publish-tab-active' : ''} onClick={() => { setActiveForm('home'); setError(''); setNotice('') }}><Building2 size={14} /> Home</button>
          </div>
        </div>
        {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
        {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}

        {activeForm === 'post' ? <form className="admin-publish-form" onSubmit={submitPost}>
          <label className="admin-publish-post-label">Post text<textarea required maxLength={500} rows={5} value={postText} onChange={(event) => setPostText(event.target.value)} placeholder="Share an update with iConnect members…" /></label>
          <label className="admin-product-upload"><ImagePlus size={16} /><span>Add up to five post photos (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={choosePostPhotos} disabled={saving || postPhotos.length >= 5} /></label>
          {!!postPreviews.length && <div className="admin-product-photo-list">{postPreviews.map((url, index) => <div key={url}><img src={url} alt={`Post photo ${index + 1} preview`} /><button type="button" onClick={() => setPostPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} aria-label={`Remove post photo ${index + 1}`} disabled={saving}><X size={13} /></button></div>)}</div>}
          <p className="jobs-form-note">The post appears in the member feed under the administrator account.</p>
          <button type="submit" className="app-primary-button" disabled={saving || !postText.trim()}><Plus size={15} />{saving ? 'Publishing…' : 'Publish post'}</button>
        </form> : activeForm === 'job' ? <form className="admin-publish-form" onSubmit={submitJob}>
          <div className="jobs-create-fields">
            <label>Role title<input required maxLength={120} value={job.title} onChange={(event) => setJob((current) => ({ ...current, title: event.target.value }))} /></label>
            <label>Company<input required maxLength={120} value={job.company} onChange={(event) => setJob((current) => ({ ...current, company: event.target.value }))} /></label>
            <label>Location<input required maxLength={120} value={job.location} onChange={(event) => setJob((current) => ({ ...current, location: event.target.value }))} placeholder="City, country or Remote" /></label>
            <label>Employment type<select value={job.employment_type} onChange={(event) => setJob((current) => ({ ...current, employment_type: event.target.value }))}><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Internship</option><option>Temporary</option></select></label>
            <label>Work arrangement<select value={job.workplace_type} onChange={(event) => setJob((current) => ({ ...current, workplace_type: event.target.value }))}><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></label>
            <label className="jobs-create-wide">Short summary<input required maxLength={250} value={job.summary} onChange={(event) => setJob((current) => ({ ...current, summary: event.target.value }))} /></label>
            <label className="jobs-create-wide">Role description<textarea required maxLength={5000} rows={5} value={job.description} onChange={(event) => setJob((current) => ({ ...current, description: event.target.value }))} /></label>
          </div>
          <label className="admin-product-upload"><Camera size={16} /><span>{companyPhoto ? companyPhoto.name : 'Add company logo or photo (optional)'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => getSelectedPhoto(event, setCompanyPhoto, setError)} disabled={saving} /></label>
          {companyPreview && <img className="admin-publish-photo-preview" src={companyPreview} alt="Selected company photo preview" />}
          <p className="jobs-form-note">The published job appears in the user-facing Job Hub. Members can save it and apply through the existing job flow.</p>
          <button type="submit" className="app-primary-button" disabled={saving}><Plus size={15} />{saving ? 'Publishing…' : 'Publish job'}</button>
        </form> : <form className="admin-publish-form" onSubmit={submitHome}>
          <div className="jobs-create-fields">
            <label>Listing title<input required maxLength={120} value={home.title} onChange={(event) => setHome((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Two-bedroom apartment" /></label>
            <label>Price or rent<input required maxLength={80} value={home.price} onChange={(event) => setHome((current) => ({ ...current, price: event.target.value }))} placeholder="e.g. ₦1,200,000 / year" /></label>
            <label>Location<input required maxLength={120} value={home.location} onChange={(event) => setHome((current) => ({ ...current, location: event.target.value }))} placeholder="City, area" /></label>
            <label>Key details<input required maxLength={280} value={home.detail} onChange={(event) => setHome((current) => ({ ...current, detail: event.target.value }))} placeholder="Bedrooms, bathrooms, furnishing…" /></label>
            <label className="jobs-create-wide">Description<textarea required maxLength={2000} rows={5} value={home.description} onChange={(event) => setHome((current) => ({ ...current, description: event.target.value }))} /></label>
          </div>
          <label className="admin-product-upload"><ImagePlus size={16} /><span>{homePhoto ? homePhoto.name : 'Add a home photo (optional)'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => getSelectedPhoto(event, setHomePhoto, setError)} disabled={saving} /></label>
          {homePreview && <img className="admin-publish-photo-preview" src={homePreview} alt="Selected home listing preview" />}
          <p className="jobs-form-note">This listing is published in the user-facing Homes marketplace and is attributed to the administrator account.</p>
          <button type="submit" className="app-primary-button" disabled={saving}><Plus size={15} />{saving ? 'Publishing…' : 'Publish home listing'}</button>
        </form>}
      </section>
      <section className="admin-panel admin-publish-help">
        <span className="app-page-eyebrow">USER-FACING SURFACES</span>
        <h2>Publish once, show up in the app</h2>
        <p>Posts appear in the member feed, jobs in Job Hub, and homes in the local marketplace. Photos are optimized and stored with the app’s media service. Use Products to publish iBuy items.</p>
        <button type="button" className="admin-row-action" onClick={() => { setActiveForm('home'); setNotice(''); setError('') }}><Building2 size={14} /> Create a home listing</button>
      </section>
    </div>
  )
}
