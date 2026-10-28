import React, { useState } from 'react'
import { Bookmark, BriefcaseBusiness, ChevronDown, MapPin, Search, SlidersHorizontal } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { demoJobs } from '../../data/demoContent.js'

export default function JobsPage() {
  const [filter, setFilter] = useState('All opportunities')
  const [saved, setSaved] = useState([])

  function toggleSaved(id) {
    setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="GROW AT YOUR OWN PACE" title="Job hub" description="A concept for finding opportunities shared across your world.">
        <button className="app-secondary-button" onClick={() => setFilter(filter === 'Remote' ? 'All opportunities' : 'Remote')}><SlidersHorizontal size={15} /> Filters <ChevronDown size={14} /></button>
      </AppPageHeader>
      <div className="jobs-demo-banner"><BriefcaseBusiness size={16} /><span><strong>Opportunity discovery preview</strong> · Listings below are sample content, not live vacancies.</span></div>
      <div className="jobs-search-panel"><label><Search size={17} /><input placeholder="Role, company, or keyword" aria-label="Search jobs" /></label><label><MapPin size={17} /><input placeholder="Location or remote" aria-label="Search location" /></label><button className="app-primary-button">Explore roles <Search size={15} /></button></div>
      <div className="job-filter-row">{['All opportunities', 'Remote', 'In my area', 'Design', 'Community'].map((item) => <button key={item} className={filter === item ? 'job-filter-selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <div className="jobs-results-heading"><div><span className="app-page-eyebrow">CURATED FOR YOUR INTERESTS</span><h2>Opportunities to explore <span>03</span></h2></div><button>Most relevant <ChevronDown size={14} /></button></div>
      <div className="jobs-list">{demoJobs.map((job) => <article className="job-card" key={job.id}>
        <div className={`job-company-mark ${job.color}`}>{job.initials}</div>
        <div className="job-info"><span className="job-match-label"><i /> {job.match}</span><h3>{job.title}</h3><strong>{job.company}</strong><div className="job-meta"><span><MapPin size={13} />{job.location}</span><span>{job.type}</span></div></div>
        <div className="job-card-actions"><button className={saved.includes(job.id) ? 'job-save saved' : 'job-save'} onClick={() => toggleSaved(job.id)} aria-label={saved.includes(job.id) ? 'Unsave job' : 'Save job'} aria-pressed={saved.includes(job.id)}><Bookmark size={17} fill={saved.includes(job.id) ? 'currentColor' : 'none'} /></button><button className="job-apply" onClick={(event) => { event.currentTarget.textContent = 'Preview only' }}>View role <span>↗</span></button></div>
      </article>)}</div>
      <p className="app-disclaimer">Sample roles for product exploration. Job search, applications, and CV tools are not connected.</p>
    </div>
  )
}
