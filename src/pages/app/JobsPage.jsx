import React, { useEffect, useState } from 'react'
import { Bookmark, BriefcaseBusiness, Camera, CheckCircle2, ChevronDown, FileText, MapPin, Plus, Search, SlidersHorizontal, Users } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { applyToJob, createJob, getJobApplications, getJobBusinessProfile, getJobs, setJobSaved, submitJobBusinessProfile } from '../../utils/jobsApi.js'
import { uploadImage } from '../../utils/mediaApi.js'

const filters = ['All opportunities', 'Remote', 'Hybrid', 'On-site', 'Saved roles', 'My applications', 'My listings']
const emptyDraft = {
  title: '',
  company: '',
  location: '',
  employment_type: 'Full-time',
  workplace_type: 'remote',
  summary: '',
  description: '',
  company_image_url: null,
}
const emptyBusinessProfile = {
  company_name: '',
  registration_number: '',
  business_type: '',
  business_address: '',
  contact_phone: '',
  description: '',
}
const maxBusinessDocumentBytes = 10 * 1024 * 1024
const businessDocumentTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

function collectionForFilter(filter) {
  if (filter === 'Saved roles') return 'saved'
  if (filter === 'My applications') return 'applied'
  if (filter === 'My listings') return 'mine'
  return 'all'
}

function workplaceForFilter(filter) {
  if (filter === 'Remote') return 'remote'
  if (filter === 'Hybrid') return 'hybrid'
  if (filter === 'On-site') return 'onsite'
  return ''
}

export default function JobsPage() {
  const [filter, setFilter] = useState(filters[0])
  const [jobs, setJobs] = useState([])
  const [search, setSearch] = useState('')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [externalJobsEnabled, setExternalJobsEnabled] = useState(false)
  const [externalSourceWarnings, setExternalSourceWarnings] = useState([])
  const [notice, setNotice] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [companyImage, setCompanyImage] = useState(null)
  const [companyImagePreview, setCompanyImagePreview] = useState('')
  const [creating, setCreating] = useState(false)
  const [savingJobIds, setSavingJobIds] = useState([])
  const [applyingJobId, setApplyingJobId] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [pendingApplicationId, setPendingApplicationId] = useState('')
  const [applicantJobId, setApplicantJobId] = useState('')
  const [applicantsByJob, setApplicantsByJob] = useState({})
  const [loadingApplicants, setLoadingApplicants] = useState(false)
  const [businessProfile, setBusinessProfile] = useState(null)
  const [businessProfileLoading, setBusinessProfileLoading] = useState(true)
  const [businessDraft, setBusinessDraft] = useState(emptyBusinessProfile)
  const [businessDocument, setBusinessDocument] = useState(null)
  const [showBusinessForm, setShowBusinessForm] = useState(false)
  const [savingBusinessProfile, setSavingBusinessProfile] = useState(false)
  const [businessUploadProgress, setBusinessUploadProgress] = useState(0)

  useEffect(() => {
    if (!companyImage) {
      setCompanyImagePreview('')
      return undefined
    }
    const preview = URL.createObjectURL(companyImage)
    setCompanyImagePreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [companyImage])

  useEffect(() => {
    let active = true
    getJobBusinessProfile()
      .then((profile) => {
        if (!active) return
        setBusinessProfile(profile)
        if (profile) {
          setBusinessDraft({
            company_name: profile.companyName,
            registration_number: profile.registrationNumber,
            business_type: profile.businessType,
            business_address: profile.businessAddress,
            contact_phone: profile.contactPhone,
            description: profile.description,
          })
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load your company profile.')
      })
      .finally(() => { if (active) setBusinessProfileLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const trimmedSearch = search.trim()
    if (trimmedSearch.length === 1) {
      setJobs([])
      setLoading(false)
      setError('')
      return () => { active = false }
    }

    setLoading(true)
    const timer = window.setTimeout(() => {
      getJobs({
        query: trimmedSearch,
        location,
        workplaceType: workplaceForFilter(filter),
        view: collectionForFilter(filter),
      })
        .then((results) => {
          if (!active) return
          setJobs(results.jobs)
          setExternalJobsEnabled(results.externalJobsEnabled)
          setExternalSourceWarnings(results.externalSourceWarnings)
          setError('')
        })
        .catch((loadError) => {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load job listings.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, trimmedSearch || location ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [filter, location, search])

  async function toggleSaved(job) {
    if (savingJobIds.includes(job.id)) return
    setSavingJobIds((current) => [...current, job.id])
    try {
      const result = await setJobSaved(job.id, !job.isSaved)
      setJobs((current) => current
        .map((item) => item.id === job.id ? { ...item, isSaved: result.saved } : item)
        .filter((item) => filter !== 'Saved roles' || result.saved))
      setNotice(result.saved ? 'Role saved to your account.' : 'Role removed from your saved list.')
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update this saved role.')
    } finally {
      setSavingJobIds((current) => current.filter((id) => id !== job.id))
    }
  }

  async function submitApplication(event, job) {
    event.preventDefault()
    setPendingApplicationId(job.id)
    try {
      const result = await applyToJob(job.id, coverLetter)
      setJobs((current) => current.map((item) => item.id === job.id
        ? {
          ...item,
          appliedByMe: true,
          applicationStatus: result.application.status,
          applicationCoverLetter: result.application.coverLetter,
        }
        : item))
      setApplyingJobId('')
      setCoverLetter('')
      setNotice(result.alreadyApplied ? 'You already applied to this role.' : 'Your application was sent.')
      setError('')
    } catch (applicationError) {
      setError(applicationError instanceof Error ? applicationError.message : 'Could not send your application.')
    } finally {
      setPendingApplicationId('')
    }
  }

  async function submitListing(event) {
    event.preventDefault()
    setCreating(true)
    try {
      const companyImageUrl = companyImage ? await uploadImage(companyImage) : draft.company_image_url
      const job = await createJob({ ...draft, company_image_url: companyImageUrl })
      setDraft(emptyDraft)
      setCompanyImage(null)
      setShowCreateForm(false)
      setFilter('My listings')
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)])
      setNotice('Your role is now listed in the Job Hub.')
      setError('')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not publish this job listing.')
    } finally {
      setCreating(false)
    }
  }

  function chooseBusinessDocument(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!businessDocumentTypes.includes(file.type)) {
      setError('Choose a CAC document in PDF, JPEG, PNG, or WebP format.')
      return
    }
    if (file.size > maxBusinessDocumentBytes) {
      setError('The CAC document must be 10 MB or smaller.')
      return
    }
    setBusinessDocument(file)
    setError('')
  }

  async function submitBusinessProfile(event) {
    event.preventDefault()
    if (!businessDocument) {
      setError('Choose a CAC registration document before submitting your company details.')
      return
    }
    setSavingBusinessProfile(true)
    setBusinessUploadProgress(0)
    setError('')
    try {
      const profile = await submitJobBusinessProfile(
        businessDocument,
        businessDraft,
        setBusinessUploadProgress,
      )
      setBusinessProfile(profile)
      setBusinessDocument(null)
      setShowBusinessForm(false)
      setShowCreateForm(true)
      setNotice('Company details and CAC document saved. You can now post jobs.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit your company details.')
    } finally {
      setSavingBusinessProfile(false)
    }
  }

  async function toggleApplicants(job) {
    if (applicantJobId === job.id) {
      setApplicantJobId('')
      return
    }
    setApplicantJobId(job.id)
    setApplicantsByJob((current) => ({ ...current, [job.id]: [] }))
    setLoadingApplicants(true)
    try {
      const results = await getJobApplications(job.id)
      setApplicantsByJob((current) => ({ ...current, [job.id]: results }))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load applications for this role.')
      setApplicantJobId('')
    } finally {
      setLoadingApplicants(false)
    }
  }

  const resultTitle = filter === 'My applications'
    ? 'Your applications'
    : filter === 'My listings'
      ? 'Roles you posted'
      : filter === 'Saved roles'
        ? 'Saved roles'
        : 'Opportunities to explore'

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="GROW AT YOUR OWN PACE" title="Job hub" description="Find opportunities shared across your world.">
        <button className="app-primary-button" type="button" onClick={() => {
          if (!businessProfile) {
            setShowBusinessForm((open) => !open)
            setShowCreateForm(false)
          } else {
            setShowCreateForm((open) => !open)
          }
        }} disabled={businessProfileLoading}>
          <Plus size={15} /> {businessProfile ? 'Post a role' : 'Set up company to post'}
        </button>
      </AppPageHeader>
      <div className="jobs-account-banner"><BriefcaseBusiness size={16} /><span><strong>Community + employer listings</strong> · Find member-posted roles alongside jobs from configured Greenhouse and SmartRecruiters career boards. External listings link to the employer to apply; member applications stay in iConnect.</span></div>
      {filter === 'All opportunities' && !externalJobsEnabled && <p className="jobs-source-notice">External job boards are not configured yet. iConnect needs each employer’s public careers-board ID; these providers do not offer one feed for every company.</p>}
      {filter === 'All opportunities' && externalSourceWarnings.length > 0 && <p className="jobs-source-notice" role="status">Some external career boards could not be reached. Showing the listings that are available.</p>}
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}

      {businessProfile && <section className="jobs-business-profile">
        <div><span className="jobs-business-profile-icon"><CheckCircle2 size={17} /></span><div><span className="app-page-eyebrow">EMPLOYER PROFILE SUBMITTED</span><h2>{businessProfile.companyName}</h2><p>{businessProfile.businessType} · CAC {businessProfile.registrationNumber}</p></div></div>
        <p>{businessProfile.description}</p>
        <div className="jobs-business-profile-details"><span>{businessProfile.businessAddress}</span><span>{businessProfile.contactPhone}</span><a href={businessProfile.documentUrl} target="_blank" rel="noreferrer"><FileText size={13} /> View submitted CAC document</a></div>
        <button type="button" className="app-secondary-button" onClick={() => { setShowBusinessForm((open) => !open); setShowCreateForm(false) }}>Update company details</button>
      </section>}

      {showBusinessForm && <form className="jobs-create-form jobs-business-form" onSubmit={submitBusinessProfile}>
        <div className="jobs-create-heading"><div><span className="app-page-eyebrow">EMPLOYER SETUP</span><h2>{businessProfile ? 'Update company details' : 'Register your company'}</h2></div><button type="button" className="app-secondary-button" onClick={() => setShowBusinessForm(false)}>Cancel</button></div>
        <p className="jobs-form-note">Submit your company details and CAC registration document to unlock member job posting. Admins can view this information in your account details. Your document is stored privately and is not shown on public job listings.</p>
        <div className="jobs-create-fields">
          <label>Registered company name<input required maxLength={120} value={businessDraft.company_name} onChange={(event) => setBusinessDraft({ ...businessDraft, company_name: event.target.value })} /></label>
          <label>CAC registration number<input required maxLength={80} value={businessDraft.registration_number} onChange={(event) => setBusinessDraft({ ...businessDraft, registration_number: event.target.value })} /></label>
          <label>Business type / industry<input required maxLength={80} value={businessDraft.business_type} onChange={(event) => setBusinessDraft({ ...businessDraft, business_type: event.target.value })} placeholder="e.g. Retail, Technology, Services" /></label>
          <label>Contact phone<input required type="tel" maxLength={40} value={businessDraft.contact_phone} onChange={(event) => setBusinessDraft({ ...businessDraft, contact_phone: event.target.value })} /></label>
          <label className="jobs-create-wide">Registered business address<input required maxLength={240} value={businessDraft.business_address} onChange={(event) => setBusinessDraft({ ...businessDraft, business_address: event.target.value })} /></label>
          <label className="jobs-create-wide">About the company<textarea required maxLength={1000} rows={4} value={businessDraft.description} onChange={(event) => setBusinessDraft({ ...businessDraft, description: event.target.value })} /></label>
          <label className="jobs-create-wide jobs-cac-document-picker"><FileText size={15} />{businessDocument ? businessDocument.name : businessProfile ? 'Upload replacement CAC document (required)' : 'Upload CAC registration document'}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required onChange={chooseBusinessDocument} disabled={savingBusinessProfile} /><small>PDF, JPEG, PNG, or WebP · maximum 10 MB</small></label>
        </div>
        {savingBusinessProfile && <div className="jobs-cac-progress" role="status"><span>Uploading CAC document… {businessUploadProgress}%</span><progress max="100" value={businessUploadProgress} /></div>}
        <button className="app-primary-button" type="submit" disabled={savingBusinessProfile || !businessDocument}>{savingBusinessProfile ? 'Submitting…' : 'Submit company details'}</button>
      </form>}

      {showCreateForm && <form className="jobs-create-form" onSubmit={submitListing}>
        <div className="jobs-create-heading"><div><span className="app-page-eyebrow">EMPLOYER TOOLS</span><h2>Share an opportunity</h2></div><button type="button" className="app-secondary-button" onClick={() => setShowCreateForm(false)}>Cancel</button></div>
        <div className="jobs-create-fields">
          <label>Role title<input required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Company<input required maxLength={120} value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></label>
          <label className="jobs-company-photo-picker"><Camera size={15} />{companyImage ? companyImage.name : 'Add company logo or photo'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
              setError('Choose a JPEG, PNG, or WebP company photo.')
              return
            }
            setCompanyImage(file)
            setError('')
          }} disabled={creating} /></label>
          <label>Location<input required maxLength={120} value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder="City, country or Remote" /></label>
          <label>Employment type<select value={draft.employment_type} onChange={(event) => setDraft({ ...draft, employment_type: event.target.value })}><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Internship</option><option>Temporary</option></select></label>
          <label>Work arrangement<select value={draft.workplace_type} onChange={(event) => setDraft({ ...draft, workplace_type: event.target.value })}><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></label>
          <label className="jobs-create-wide">Short summary<input required maxLength={250} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
          <label className="jobs-create-wide">Role description<textarea required maxLength={5000} rows={5} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        </div>
        {companyImagePreview && <img className="jobs-company-photo-preview" src={companyImagePreview} alt="Selected company photo" />}
        <p className="jobs-form-note">Your listing will be visible to signed-in iConnect members. Review it carefully before publishing.</p>
        <button className="app-primary-button" type="submit" disabled={creating}>{creating ? 'Publishing…' : 'Publish role'}</button>
      </form>}

      <form className="jobs-search-panel" onSubmit={(event) => event.preventDefault()}>
        <label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Role, company, or keyword" aria-label="Search jobs" /></label>
        <label><MapPin size={17} /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location or remote" aria-label="Search location" /></label>
        <button className="app-secondary-button" type="button" onClick={() => setFilter(filter === 'Remote' ? 'All opportunities' : 'Remote')}><SlidersHorizontal size={15} /> {filter === 'Remote' ? 'Remote only' : 'Remote'} <ChevronDown size={14} /></button>
      </form>
      <div className="job-filter-row" role="tablist" aria-label="Job listing filters">
        {filters.map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className={filter === item ? 'job-filter-selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}
      </div>
      <div className="jobs-results-heading"><div><span className="app-page-eyebrow">COMMUNITY + EMPLOYER SOURCES</span><h2>{resultTitle} <span>{jobs.length}</span></h2></div></div>
      {loading && <p className="jobs-empty-state" role="status">Loading job listings…</p>}
      {!loading && search.trim().length === 1 && <p className="jobs-empty-state">Enter at least two characters to search.</p>}
      {!loading && search.trim().length !== 1 && jobs.length === 0 && <p className="jobs-empty-state">No roles found. Try another search or share an opportunity with the community.</p>}
      <div className="jobs-list">{jobs.map((job) => (
        <article className="job-card" key={job.id}>
          <div className="job-company-mark">{job.companyImageUrl ? <img src={job.companyImageUrl} alt={`${job.company} logo`} /> : job.company.slice(0, 2).toUpperCase()}</div>
            <div className="job-info">
              <span className="job-match-label"><i /> {job.source ? `${job.source} · External listing` : job.isOwner ? 'Your listing' : `Posted by @${job.poster.username}`}</span>
            <h3>{job.title}</h3>
            <strong>{job.company}</strong>
            <p className="job-summary">{job.summary}</p>
            <div className="job-meta"><span><MapPin size={13} />{job.location}</span><span>{job.employmentType}</span><span>{job.workplaceType === 'onsite' ? 'On-site' : job.workplaceType[0].toUpperCase() + job.workplaceType.slice(1)}</span></div>
            {job.applicationCoverLetter && filter === 'My applications' && <p className="job-application-note"><strong>Your application:</strong> {job.applicationCoverLetter}</p>}
            <details className="job-description"><summary>Role details</summary><p>{job.description}</p></details>
          </div>
          <div className="job-card-actions">
            {!job.source && !job.isOwner && <button className={job.isSaved ? 'job-save saved' : 'job-save'} type="button" onClick={() => toggleSaved(job)} disabled={savingJobIds.includes(job.id)} aria-label={job.isSaved ? 'Unsave job' : 'Save job'} aria-pressed={job.isSaved}><Bookmark size={17} fill={job.isSaved ? 'currentColor' : 'none'} /></button>}
            {job.source
              ? <a className="job-apply" href={job.externalUrl} target="_blank" rel="noreferrer">Apply on {job.source}</a>
              : job.isOwner
              ? <button className="job-apply" type="button" onClick={() => toggleApplicants(job)}><Users size={14} /> Applicants {job.applicationCount}</button>
              : job.appliedByMe
                ? <button className="job-apply" type="button" disabled>Applied</button>
                : <button className="job-apply" type="button" onClick={() => { setApplyingJobId(job.id); setCoverLetter('') }}>Apply</button>}
          </div>
          {!job.source && applyingJobId === job.id && <form className="job-application-form" onSubmit={(event) => submitApplication(event, job)}>
            <label htmlFor={`application-${job.id}`}>Short note to the poster (optional)</label>
            <textarea id={`application-${job.id}`} maxLength={2000} rows={4} value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} />
            <div><button className="app-primary-button" type="submit" disabled={pendingApplicationId === job.id}>{pendingApplicationId === job.id ? 'Sending…' : 'Send application'}</button><button className="app-secondary-button" type="button" onClick={() => setApplyingJobId('')}>Cancel</button></div>
          </form>}
          {!job.source && applicantJobId === job.id && <div className="job-applicants-panel">
            <h4>Applications</h4>
            {loadingApplicants ? <p>Loading applications…</p> : applicantsByJob[job.id]?.length ? applicantsByJob[job.id].map((application) => <article key={application.id}><strong>{application.applicant.name} <span>@{application.applicant.username}</span></strong><p>{application.coverLetter || 'No note included.'}</p></article>) : <p>No applications yet.</p>}
          </div>}
        </article>
      ))}</div>
      <p className="app-disclaimer">External openings are retrieved from configured employer career boards and applications are handled on the employer’s site. Member listings are shared by users and are not independently verified; iConnect applications are stored securely with the listing owner.</p>
    </div>
  )
}
