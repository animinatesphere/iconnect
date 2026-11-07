import React, { useEffect, useState } from 'react'
import { Heart, MapPin, MessageCircle, ShieldAlert, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { blockDatingUser, getDatingDiscovery, getDatingMatches, getDatingProfile, reportDatingUser, saveDatingProfile, swipeDatingProfile, unmatchDatingUser } from '../../utils/datingApi.js'
import { uploadImage } from '../../utils/mediaApi.js'
import { getMyBilling } from '../../utils/billingApi.js'

const emptyProfile = {
  birth_date: '',
  gender: 'woman',
  seeking: 'everyone',
  location: '',
  bio: '',
  interests: [],
  image_urls: [],
  active: true,
  agree_to_adult_terms: false,
}

function datingAgeLimit() {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 18)
  return date.toISOString().slice(0, 10)
}

function ProfileForm({ initialProfile, onSaved, onCancel }) {
  const [form, setForm] = useState(initialProfile ? {
    birth_date: '',
    gender: initialProfile.gender,
    seeking: initialProfile.seeking,
    location: initialProfile.location,
    bio: initialProfile.bio,
    interests: initialProfile.interests,
    image_urls: initialProfile.image_urls,
    active: initialProfile.active,
    agree_to_adult_terms: false,
  } : emptyProfile)
  const [interestText, setInterestText] = useState((initialProfile?.interests ?? []).join(', '))
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function addPhotos(event) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    if (form.image_urls.length + files.length > 5) {
      setError('You can add up to five dating profile photos.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const urls = await Promise.all(files.map(uploadImage))
      setForm((current) => ({ ...current, image_urls: [...current.image_urls, ...urls] }))
    } catch (uploadError) {
      setError(uploadError.message || 'Could not upload your photo.')
    } finally {
      setUploading(false)
    }
  }

  async function submitProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const interests = [...new Set(interestText.split(',').map((item) => item.trim()).filter(Boolean))]
      const payload = {
        ...form,
        birth_date: form.birth_date || null,
        interests,
        agree_to_adult_terms: true,
      }
      if (!payload.birth_date && !initialProfile) {
        setError('Enter your date of birth.')
        return
      }
      const savedProfile = await saveDatingProfile(payload)
      onSaved(savedProfile)
    } catch (saveError) {
      setError(saveError.message || 'Could not save your dating profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="dating-profile-form" onSubmit={submitProfile}>
      <div className="dating-form-heading">
        <span className="dating-icon-tile"><UserRound size={20} /></span>
        <div><span className="app-page-eyebrow">{initialProfile ? 'YOUR DATING PROFILE' : '18+ DATING'}</span><h2>{initialProfile ? 'Edit your profile' : 'Create your dating profile'}</h2><p>Your dating profile is separate from your regular iConnect profile.</p></div>
      </div>
      {error && <p className="dating-feedback dating-error" role="alert">{error}</p>}
      <div className="dating-photo-editor">
        <div className="dating-photo-strip">
          {form.image_urls.map((url, index) => <div className="dating-photo-thumb" key={url}><img src={url} alt={`Dating profile ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setForm((current) => ({ ...current, image_urls: current.image_urls.filter((item) => item !== url) }))}><X size={14} /></button></div>)}
          {form.image_urls.length < 5 && <label className="dating-add-photo">{uploading ? 'Uploading…' : '+ Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={addPhotos} /></label>}
        </div>
        <small>Add at least one clear photo. You can upload up to five.</small>
      </div>
      <div className="dating-form-grid">
        <label>{initialProfile ? 'Date of birth (optional)' : 'Date of birth'}<input type="date" required={!initialProfile} max={datingAgeLimit()} value={form.birth_date} onChange={(event) => setForm((current) => ({ ...current, birth_date: event.target.value }))} /><small>Your exact birth date stays private; your age is shown. Leave blank when editing to keep the saved date.</small></label>
        <label>Gender<select value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}><option value="woman">Woman</option><option value="man">Man</option><option value="non_binary">Non-binary</option></select></label>
        <label>Interested in<select value={form.seeking} onChange={(event) => setForm((current) => ({ ...current, seeking: event.target.value }))}><option value="everyone">Everyone</option><option value="women">Women</option><option value="men">Men</option><option value="non_binary">Non-binary people</option></select></label>
        <label>Location<input required maxLength={120} value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="City, country" /></label>
      </div>
      <label className="dating-full-label">About you<textarea required maxLength={500} rows={4} value={form.bio} onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} placeholder="A little about you, what you enjoy, and what you hope to find." /></label>
      <label className="dating-full-label">Interests <span>(comma separated, up to 10)</span><input value={interestText} onChange={(event) => setInterestText(event.target.value)} placeholder="Music, travel, cooking" /></label>
      <label className="dating-consent"><input type="checkbox" required checked={form.agree_to_adult_terms} onChange={(event) => setForm((current) => ({ ...current, agree_to_adult_terms: event.target.checked }))} /><span>I confirm that I am 18 or older and agree to use this dating area respectfully.</span></label>
      <p className="dating-privacy-note"><ShieldCheck size={15} /> Dating is intended for adults. Age is checked from the date you enter; iConnect does not verify identity. Never share financial or sensitive personal information with someone you meet here.</p>
      <div className="dating-form-actions"><button type="submit" className="app-primary-button" disabled={saving || uploading || form.image_urls.length === 0}>{saving ? 'Saving…' : initialProfile ? 'Save changes' : 'Create dating profile'}</button>{initialProfile && <button type="button" className="dating-text-button" onClick={onCancel}>Cancel</button>}</div>
    </form>
  )
}

export default function DatingPage() {
  const [profile, setProfile] = useState(undefined)
  const [editing, setEditing] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [matches, setMatches] = useState([])
  const [tab, setTab] = useState('discover')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [datingBilling, setDatingBilling] = useState(null)
  const [billingError, setBillingError] = useState('')

  useEffect(() => {
    let active = true
    getDatingProfile()
      .then((loadedProfile) => { if (active) setProfile(loadedProfile) })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not load your dating profile.') })
      .finally(() => { if (active) setLoading(false) })
    getMyBilling()
      .then((billing) => { if (active) setDatingBilling(billing.dating) })
      .catch((billingLoadError) => { if (active) setBillingError(billingLoadError.message || 'Dating allowances are unavailable.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!profile || !profile.active || editing || tab === 'profile') return undefined
    let active = true
    setError('')
    const load = tab === 'matches' ? getDatingMatches().then(setMatches) : getDatingDiscovery().then(setProfiles)
    load.catch((loadError) => { if (active) setError(loadError.message || 'Could not load dating.') })
    return () => { active = false }
  }, [editing, profile, tab])

  async function handleSwipe(person, liked) {
    setBusy(person.user_id)
    setError('')
    setNotice('')
    try {
      const result = await swipeDatingProfile(person.user_id, liked)
      if (liked) {
        getMyBilling()
          .then((billing) => { setDatingBilling(billing.dating); setBillingError('') })
          .catch((billingLoadError) => setBillingError(billingLoadError.message || 'Could not refresh dating allowances.'))
      }
      setProfiles((current) => current.filter((item) => item.user_id !== person.user_id))
      if (result.matched) {
        setNotice(`It’s a match with ${person.name}! You can now message in your separate dating inbox.`)
        const updatedMatches = await getDatingMatches()
        setMatches(updatedMatches)
      } else if (liked) {
        setNotice('Like sent. If they like you too, you’ll match.')
      }
    } catch (swipeError) {
      setError(swipeError.message || 'Could not update this profile.')
    } finally {
      setBusy('')
    }
  }

  async function moderatePerson(person, action) {
    setError('')
    setNotice('')
    try {
      if (action === 'block') {
        if (!window.confirm(`Block ${person.name} from your dating experience?`)) return
        await blockDatingUser(person.user_id)
        setProfiles((current) => current.filter((item) => item.user_id !== person.user_id))
        setMatches((current) => current.filter((match) => match.profile.user_id !== person.user_id))
        setNotice('This person is blocked from your dating experience.')
        return
      }
      const reason = window.prompt('Report reason: inappropriate, fake_profile, harassment, or other', 'other')
      if (!reason) return
      const normalizedReason = reason.trim().toLowerCase()
      if (!['inappropriate', 'fake_profile', 'harassment', 'other'].includes(normalizedReason)) {
        setError('Choose inappropriate, fake_profile, harassment, or other as the report reason.')
        return
      }
      const details = window.prompt('Add details (optional):', '') ?? ''
      await reportDatingUser(person.user_id, { reason: normalizedReason, details })
      setNotice('Thank you. Your report has been submitted for review.')
    } catch (moderationError) {
      setError(moderationError.message || 'Could not complete this safety action.')
    }
  }

  async function removeMatch(match) {
    const person = match.profile
    if (!window.confirm(`Unmatch ${person.name}? Your dating conversation will be removed.`)) return
    setBusy(match.id)
    try {
      await unmatchDatingUser(match.id)
      setMatches((current) => current.filter((item) => item.id !== match.id))
      setNotice(`You unmatched ${person.name}.`)
    } catch (matchError) {
      setError(matchError.message || 'Could not remove this match.')
    } finally {
      setBusy('')
    }
  }

  async function setProfileActive(active) {
    setError('')
    try {
      const saved = await saveDatingProfile({
        birth_date: profile.birth_date,
        gender: profile.gender,
        seeking: profile.seeking,
        location: profile.location,
        bio: profile.bio,
        interests: profile.interests,
        image_urls: profile.image_urls,
        active,
        agree_to_adult_terms: true,
      })
      setProfile(saved)
      setNotice(active ? 'Your dating profile is active again.' : 'Your dating profile is paused and hidden from discovery.')
    } catch (saveError) {
      setError(saveError.message || 'Could not update your profile status.')
    }
  }

  if (loading) return <div className="app-content-width"><p role="status">Loading dating…</p></div>
  if (!profile || editing) {
    return <div className="app-content-width dating-page"><AppPageHeader eyebrow="A SEPARATE DATING EXPERIENCE" title="Meet someone new" description="Create a dating profile and discover adults who are looking for a mutual connection." />
      {error && !editing && <p className="dating-feedback dating-error" role="alert">{error}</p>}
      <ProfileForm initialProfile={editing ? profile : null} onSaved={(saved) => { setProfile(saved); setEditing(false); setError(''); setNotice('Your dating profile is ready.') }} onCancel={() => setEditing(false)} />
    </div>
  }

  return (
    <div className="app-content-width dating-page">
      <AppPageHeader eyebrow="18+ · SEPARATE FROM YOUR REGULAR INBOX" title="Dating" description="Discover people, make a mutual match, and keep dating conversations in their own inbox." />
      {error && <p className="dating-feedback dating-error" role="alert">{error}</p>}
      {billingError && <p className="dating-feedback dating-error" role="alert">{billingError}</p>}
      {notice && <p className="dating-feedback dating-notice" role="status">{notice}</p>}
      {datingBilling && <section className="dating-likes-summary">
        <div><Heart size={17} /><span><strong>{datingBilling.likesUsedToday} / {datingBilling.freeLikesPerDay}</strong> free likes used today · {datingBilling.extraLikesRemaining} extra remaining</span></div>
        <Link to="/app/billing">Dating extras & plans</Link>
      </section>}
      <div className="dating-tabs" role="tablist" aria-label="Dating sections">
        <button type="button" role="tab" aria-selected={tab === 'discover'} className={tab === 'discover' ? 'is-selected' : ''} onClick={() => { setTab('discover'); setNotice('') }}><Sparkles size={16} /> Discover</button>
        <button type="button" role="tab" aria-selected={tab === 'matches'} className={tab === 'matches' ? 'is-selected' : ''} onClick={() => { setTab('matches'); setNotice('') }}><Heart size={16} /> Matches</button>
        <button type="button" role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'is-selected' : ''} onClick={() => { setTab('profile'); setNotice('') }}><UserRound size={16} /> My profile</button>
        <Link to="/app/dating/messages" className="dating-inbox-link"><MessageCircle size={16} /> Dating inbox</Link>
      </div>
      {!profile.active && <section className="dating-paused-card"><ShieldCheck size={24} /><div><h2>Your dating profile is paused</h2><p>It is hidden from discovery until you choose to resume.</p><button className="app-primary-button" type="button" onClick={() => setProfileActive(true)}>Resume dating</button></div></section>}
      {profile.active && tab === 'profile' && <section className="dating-own-profile">
        <div className="dating-own-photo">{profile.image_urls[0] && <img src={profile.image_urls[0]} alt="Your dating profile" />}</div>
        <div className="dating-own-copy"><span className="app-page-eyebrow">YOUR PROFILE</span><h2>{profile.name}, {profile.age}</h2><p><MapPin size={14} /> {profile.location}</p><p>{profile.bio}</p><div className="dating-interest-list">{profile.interests.map((interest) => <span key={interest}>{interest}</span>)}</div>
          <div className="dating-profile-actions"><button className="app-primary-button" type="button" onClick={() => setEditing(true)}>Edit profile</button><button type="button" className="dating-text-button" onClick={() => setProfileActive(false)}>Pause profile</button></div>
        </div>
      </section>}
      {profile.active && tab === 'discover' && <section className="dating-discover-section">
        {profiles.length ? <div className="dating-card-grid">{profiles.map((person) => <article className="dating-person-card" key={person.user_id}>
          <div className="dating-person-photo"><img src={person.image_urls[0]} alt={`${person.name}'s profile`} /><span className="dating-photo-count">{person.image_urls.length} {person.image_urls.length === 1 ? 'photo' : 'photos'}</span></div>
          <div className="dating-person-copy"><h2>{person.name}, {person.age}</h2><p className="dating-location"><MapPin size={14} /> {person.location}</p><p className="dating-person-bio">{person.bio}</p><div className="dating-interest-list">{person.interests.map((interest) => <span key={interest}>{interest}</span>)}</div>
            <div className="dating-person-actions"><button className="dating-skip-button" type="button" disabled={busy === person.user_id} onClick={() => handleSwipe(person, false)} aria-label={`Pass on ${person.name}`}><X size={20} /></button><button className="dating-like-button" type="button" disabled={busy === person.user_id} onClick={() => handleSwipe(person, true)}><Heart size={18} /> Like</button></div>
            <div className="dating-safety-actions"><button type="button" onClick={() => moderatePerson(person, 'report')}><ShieldAlert size={13} /> Report</button><button type="button" onClick={() => moderatePerson(person, 'block')}>Block</button></div>
          </div>
        </article>)}</div> : <div className="dating-empty"><Sparkles size={25} /><h2>No one new to show right now</h2><p>Check back later. New profiles that match your preferences will appear here.</p></div>}
      </section>}
      {profile.active && tab === 'matches' && <section className="dating-match-list">
        {matches.length ? matches.map((match) => <article className="dating-match-card" key={match.id}>
          <Avatar person={{ name: match.profile.name, image: match.profile.image_urls[0] }} />
          <div className="dating-match-info"><strong>{match.profile.name}, {match.profile.age}</strong><span>{match.last_message || `${match.profile.location} · matched ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(match.created_at))}`}</span></div>
          <Link className="app-primary-button" to={`/app/dating/messages/${match.id}`}><MessageCircle size={15} /> Message</Link>
          <button type="button" className="dating-match-remove" disabled={busy === match.id} onClick={() => removeMatch(match)}>Unmatch</button>
          <button type="button" className="dating-match-remove" onClick={() => moderatePerson(match.profile, 'block')}>Block</button>
        </article>) : <div className="dating-empty"><Heart size={25} /><h2>Your mutual matches will appear here</h2><p>Only people you both like can start a dating conversation.</p></div>}
      </section>}
    </div>
  )
}
