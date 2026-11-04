import React, { useEffect, useMemo, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Eye, Plus, Trash2, X } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { uploadImage } from '../utils/mediaApi.js'
import { createStatus, deleteStatus, getStatus, getStatuses } from '../utils/statusApi.js'

function groupStatuses(statuses) {
  const grouped = new Map()
  for (const status of statuses) {
    const authorId = status.author.id
    if (!grouped.has(authorId)) {
      grouped.set(authorId, { author: status.author, statuses: [] })
    }
    grouped.get(authorId).statuses.push(status)
  }
  return [...grouped.values()]
}

export default function StatusExperience({
  mode = 'home',
  userId = '',
  currentUser = null,
  onClose = () => {},
}) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(mode === 'contact')
  const [loadError, setLoadError] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [image, setImage] = useState(null)
  const [caption, setCaption] = useState('')
  const [posting, setPosting] = useState(false)
  const [activeGroup, setActiveGroup] = useState(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeStatus, setActiveStatus] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const imagePreview = useMemo(() => image ? URL.createObjectURL(image) : '', [image])

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  useEffect(() => {
    let active = true
    setLoading(true)
    async function refreshStatuses() {
      try {
        const statuses = await getStatuses(mode === 'contact' ? userId : '')
        if (!active) return
        const nextGroups = groupStatuses(statuses)
        setGroups(nextGroups)
        setLoadError('')
        if (mode === 'contact') {
          if (nextGroups[0]?.statuses.length) {
            await showStatus(nextGroups[0], 0)
          } else {
            setLoadError('This person has no active status right now.')
          }
        }
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : 'Statuses could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    refreshStatuses()
    if (mode === 'home') {
      const timer = window.setInterval(refreshStatuses, 60000)
      return () => {
        active = false
        window.clearInterval(timer)
      }
    }
    return () => { active = false }
  }, [mode, userId])

  async function showStatus(group, index) {
    const status = group.statuses[index]
    if (!status) return
    setActiveGroup(group)
    setActiveIndex(index)
    setActiveStatus(null)
    setLoadingStatus(true)
    setActionError('')
    try {
      const opened = await getStatus(status.id)
      setActiveStatus(opened)
      setGroups((current) => current.map((item) => item.author.id !== group.author.id
        ? item
        : {
          ...item,
          statuses: item.statuses.map((entry) => entry.id === opened.id
            ? { ...entry, viewedByMe: opened.viewedByMe, viewCount: opened.viewCount }
            : entry),
        }))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'This status could not be opened.')
    } finally {
      setLoadingStatus(false)
    }
  }

  async function submitStatus(event) {
    event.preventDefault()
    if (!image) {
      setActionError('Choose a photo for your status.')
      return
    }
    setPosting(true)
    setActionError('')
    try {
      const imageUrl = await uploadImage(image)
      const created = await createStatus(imageUrl, caption)
      setGroups((current) => {
        const ownGroup = current.find((group) => group.author.id === created.author.id)
        if (!ownGroup) return [{ author: created.author, statuses: [created] }, ...current]
        return current.map((group) => group.author.id === created.author.id
          ? { ...group, statuses: [created, ...group.statuses] }
          : group)
      })
      setImage(null)
      setCaption('')
      setComposerOpen(false)
      setActionError('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Your status could not be posted.')
    } finally {
      setPosting(false)
    }
  }

  async function removeActiveStatus() {
    if (!activeStatus?.isMine || deleting) return
    setDeleting(true)
    setActionError('')
    try {
      await deleteStatus(activeStatus.id)
      const nextGroups = groups
        .map((group) => ({
          ...group,
          statuses: group.statuses.filter((status) => status.id !== activeStatus.id),
        }))
        .filter((group) => group.statuses.length)
      setGroups(nextGroups)
      if (nextGroups.some((group) => group.author.id === activeGroup?.author.id)) {
        const remaining = nextGroups.find((group) => group.author.id === activeGroup.author.id)
        const nextIndex = Math.min(activeIndex, remaining.statuses.length - 1)
        await showStatus(remaining, nextIndex)
      } else {
        closeViewer()
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Your status could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  function closeViewer() {
    setActiveGroup(null)
    setActiveStatus(null)
    setActionError('')
    if (mode === 'contact') onClose()
  }

  async function moveStatus(direction) {
    if (!activeGroup) return
    const nextIndex = activeIndex + direction
    if (nextIndex < 0 || nextIndex >= activeGroup.statuses.length) {
      closeViewer()
      return
    }
    await showStatus(activeGroup, nextIndex)
  }

  if (mode === 'contact') {
    return (
      <>
        {loading && <div className="status-viewer-backdrop"><p className="status-viewer-message">Loading status…</p></div>}
        {!loading && loadError && !activeGroup && <div className="status-viewer-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}>
          <section className="status-viewer-message" role="status"><p>{loadError}</p><button type="button" className="quiet-icon-button" aria-label="Close status" onClick={onClose}><X size={17} /></button></section>
        </div>}
        {activeGroup && <StatusViewer
          group={activeGroup}
          index={activeIndex}
          status={activeStatus}
          loading={loadingStatus}
          deleting={deleting}
          error={actionError}
          onClose={closeViewer}
          onMove={moveStatus}
          onDelete={removeActiveStatus}
        />}
      </>
    )
  }

  return (
    <>
      <section className="status-home-section" aria-label="Member statuses">
        <div className="status-home-heading"><div><span className="app-page-eyebrow">MOMENTS · LAST 24 HOURS</span><h2>Status</h2></div>
          <button type="button" className="status-create-button" onClick={() => { setComposerOpen((open) => !open); setActionError('') }}><Plus size={15} /> Add status</button>
        </div>
        {loadError && <p className="status-inline-error" role="alert">{loadError}</p>}
        {loading && <p className="status-loading">Loading statuses…</p>}
        {!loading && !loadError && groups.length === 0 && <p className="status-loading">Share a photo status or check back when your circle posts an update.</p>}
        <div className="status-story-row">
          <button type="button" className="status-story-item" onClick={() => groups.find((group) => group.author.id === currentUser?.id)
            ? showStatus(groups.find((group) => group.author.id === currentUser.id), 0)
            : setComposerOpen(true)}>
            <span className="status-story-avatar status-story-own"><Avatar person={{ name: currentUser?.name ?? 'You', image: currentUser?.profileImageUrl }} /><i><Plus size={12} /></i></span>
            <span>Your status</span>
          </button>
          {groups.filter((group) => group.author.id !== currentUser?.id).map((group) => <button type="button" className={`status-story-item ${group.statuses.every((status) => status.viewedByMe) ? 'status-story-seen' : ''}`} key={group.author.id} onClick={() => showStatus(group, 0)}>
            <span className="status-story-avatar"><Avatar person={{ name: group.author.name, image: group.author.avatar }} /></span>
            <span>{group.author.name.split(' ')[0]}</span>
          </button>)}
        </div>
        {composerOpen && <form className="status-composer" onSubmit={submitStatus}>
          <div className="status-composer-heading"><strong>Share a status photo</strong><button type="button" className="quiet-icon-button" aria-label="Close status composer" onClick={() => setComposerOpen(false)}><X size={16} /></button></div>
          {actionError && <p className="status-inline-error" role="alert">{actionError}</p>}
          <label className="status-photo-picker"><Camera size={17} /><span>{image ? image.name : 'Choose a photo'}</span><small>Visible to people in your circle for 24 hours</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
              setActionError('Choose a JPEG, PNG, or WebP photo.')
              return
            }
            setImage(file)
            setActionError('')
          }} disabled={posting} /></label>
          {imagePreview && <img className="status-compose-preview" src={imagePreview} alt="Status preview" />}
          <label className="status-caption-label">Caption <input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} placeholder="Add a thought…" /></label>
          <button className="app-primary-button" type="submit" disabled={posting || !image}>{posting ? 'Sharing…' : 'Share status'}</button>
        </form>}
      </section>
      {activeGroup && <StatusViewer
        group={activeGroup}
        index={activeIndex}
        status={activeStatus}
        loading={loadingStatus}
        deleting={deleting}
        error={actionError}
        onClose={closeViewer}
        onMove={moveStatus}
        onDelete={removeActiveStatus}
      />}
    </>
  )
}

function StatusViewer({ group, index, status, loading, deleting, error, onClose, onMove, onDelete }) {
  return (
    <div className="status-viewer-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="status-viewer" role="dialog" aria-modal="true" aria-label={`${group.author.name}'s status`}>
        <div className="status-viewer-progress">{group.statuses.map((item, itemIndex) => <i key={item.id} className={itemIndex <= index ? 'status-progress-active' : ''} />)}</div>
        <header className="status-viewer-header"><Avatar person={{ name: group.author.name, image: group.author.avatar }} /><span><strong>{group.author.name}</strong><small>{status ? new Date(status.createdAt).toLocaleString() : 'Opening status…'}</small></span>
          {status?.isMine && <button type="button" className="quiet-icon-button" aria-label="Delete status" onClick={onDelete} disabled={deleting}><Trash2 size={16} /></button>}
          <button type="button" className="quiet-icon-button" aria-label="Close status viewer" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="status-viewer-content">
          {loading && <p className="status-viewer-message">Opening status…</p>}
          {!loading && status && <><img src={status.imageUrl} alt={`${group.author.name}'s status`} /><p>{status.caption}</p></>}
          {!loading && error && <p className="status-inline-error" role="alert">{error}</p>}
          <button type="button" className="status-viewer-nav status-viewer-prev" aria-label="Previous status" onClick={() => onMove(-1)} disabled={loading}><ChevronLeft size={25} /></button>
          <button type="button" className="status-viewer-nav status-viewer-next" aria-label="Next status" onClick={() => onMove(1)} disabled={loading}><ChevronRight size={25} /></button>
        </div>
        {status?.isMine && <div className="status-viewers"><span><Eye size={14} /> Viewed by {status.viewCount}</span>{status.viewers?.length
          ? <ul>{status.viewers.map((viewer) => <li key={viewer.id}><Avatar person={{ name: viewer.name, image: viewer.avatar }} /><span><strong>{viewer.name}</strong><small>@{viewer.username}</small></span><time>{new Date(viewer.viewedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></li>)}</ul>
          : <p>No views yet.</p>}</div>}
        {deleting && <p className="status-loading">Deleting status…</p>}
      </section>
    </div>
  )
}
