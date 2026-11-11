import React, { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, ImagePlus, MapPin, Megaphone, MousePointerClick, Eye, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { cancelAdCampaign, createAdCampaign, getAdPackages, getMyAds } from '../../utils/adsApi.js'
import { confirmBillingPayment } from '../../utils/billingApi.js'
import { uploadImage } from '../../utils/mediaApi.js'

const STATUS = {
  pending_payment: ['Unpaid', 'muted'],
  in_review: ['Paid · waiting for review', 'pending'],
  active: ['Live', 'live'],
  rejected: ['Not approved', 'bad'],
  expired: ['Finished', 'muted'],
  cancelled: ['Cancelled', 'muted'],
}

const emptyAd = { packageId: '', title: '', body: '', linkUrl: '', ctaLabel: 'Learn more' }

function formatPrice(amountMinor, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'NGN' ? 0 : 2 }).format(amountMinor / 100)
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : ''
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

export default function AdsPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [packages, setPackages] = useState([])
  const [location, setLocation] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [draft, setDraft] = useState(emptyAd)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const [catalog, mine] = await Promise.all([getAdPackages(), getMyAds()])
    setPackages(catalog.packages)
    setLocation(catalog.location)
    setCampaigns(mine)
    setDraft((current) => (current.packageId || !catalog.packages[0] ? current : { ...current, packageId: catalog.packages[0].id }))
  }, [])

  useEffect(() => {
    refresh().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (!photo) { setPhotoPreview(''); return undefined }
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  // Returning from Paystack or Stripe checkout.
  useEffect(() => {
    const reference = searchParams.get('reference')
    const status = searchParams.get('status')
    if (status === 'cancelled') {
      setNotice('Checkout was cancelled. Your ad was not paid for.')
      navigate('/app/ads', { replace: true })
      return
    }
    if (!reference) return
    setBusy('confirm')
    confirmBillingPayment(reference)
      .then(async () => {
        await refresh()
        setNotice('Payment confirmed. Your ad is waiting for a quick review, and its run starts once it is approved.')
      })
      .catch((confirmError) => setError(confirmError.message || 'We could not confirm this payment yet. Refresh in a minute.'))
      .finally(() => { setBusy(''); navigate('/app/ads', { replace: true }) })
  }, [navigate, refresh, searchParams])

  const selected = packages.find((item) => item.id === draft.packageId)

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (draft.linkUrl && !/^https:\/\/[^\s]+$/i.test(draft.linkUrl.trim())) {
      setError('The link must be a full https:// address.')
      return
    }
    setBusy('pay')
    try {
      const imageUrl = photo ? await uploadImage(photo) : null
      const { checkoutUrl } = await createAdCampaign({ ...draft, imageUrl })
      window.location.assign(checkoutUrl)
    } catch (submitError) {
      setError(submitError.message || 'Could not start checkout.')
      setBusy('')
    }
  }

  async function cancel(campaign) {
    setBusy(campaign.id)
    try {
      await cancelAdCampaign(campaign.id)
      await refresh()
    } catch (cancelError) {
      setError(cancelError.message)
    } finally {
      setBusy('')
    }
  }

  if (loading) return <div className="app-content-width"><p role="status">Loading iConnect Ads…</p></div>

  return (
    <div className="app-content-width ads-page">
      <AppPageHeader eyebrow="ICONNECT ADS" title="Promote on iConnect" description="Put your business, product or event in front of members. Ads appear in the home feed, marked Sponsored." />
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      {busy === 'confirm' && <p className="feed-interaction-notice" role="status">Confirming your payment…</p>}

      <div className="ads-layout">
        <form className="ads-panel ads-form" onSubmit={submit}>
          <div className="ads-panel-heading">
            <span className="app-page-eyebrow">1 · CHOOSE A PACKAGE</span>
            {location?.country && <span className="billing-location-note"><MapPin size={13} /> Prices for {countryName(location.country)}</span>}
          </div>
          <div className="ads-packages">
            {packages.map((item) => (
              <label key={item.id} className={draft.packageId === item.id ? 'active' : ''}>
                <input type="radio" name="package" checked={draft.packageId === item.id} onChange={() => update('packageId', item.id)} />
                <b>{item.name}</b>
                <strong>{formatPrice(item.amountMinor, item.currency)}</strong>
                <span>{item.durationDays} day{item.durationDays === 1 ? '' : 's'} in the feed{item.description ? ` · ${item.description}` : ''}</span>
              </label>
            ))}
            {!packages.length && <p className="ads-empty">No ad packages are available in your country yet. Please check back soon.</p>}
          </div>

          <span className="app-page-eyebrow">2 · WRITE YOUR AD</span>
          <label>Headline<input required minLength="3" maxLength="60" value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="e.g. Fresh bread delivered every morning" /><small>{draft.title.length}/60</small></label>
          <label>Message<textarea required minLength="10" maxLength="220" rows="3" value={draft.body} onChange={(event) => update('body', event.target.value)} placeholder="What should people know?" /><small>{draft.body.length}/220</small></label>
          <label className="media-upload-picker"><ImagePlus size={18} /><span>{photo ? 'Change image' : 'Add an image (optional)'}</span><small>JPEG, PNG or WebP<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] || null)} /></small></label>
          {photo && <button type="button" className="ads-remove-photo" onClick={() => setPhoto(null)}><X size={13} /> Remove image</button>}
          <div className="ads-row">
            <label>Link (optional)<input type="url" value={draft.linkUrl} onChange={(event) => update('linkUrl', event.target.value)} placeholder="https://yourbusiness.com" /></label>
            <label>Button text<input required minLength="2" maxLength="24" value={draft.ctaLabel} onChange={(event) => update('ctaLabel', event.target.value)} /></label>
          </div>
          <p className="ads-rules">Ads are reviewed before they go live. We don't approve misleading claims, adult content, gambling, weapons, or anything illegal. Your ad's run starts when it is approved.</p>
          <button type="submit" className="app-primary-button" disabled={!selected || busy !== ''}>{busy === 'pay' ? 'Opening checkout…' : selected ? `Pay ${formatPrice(selected.amountMinor, selected.currency)} and submit` : 'Choose a package'} <ArrowUpRight size={15} /></button>
        </form>

        <aside className="ads-side">
          <span className="app-page-eyebrow">PREVIEW</span>
          <article className="feed-card sponsored-ad">
            <div className="sponsored-ad-head"><span><Megaphone size={13} /> Sponsored</span><small>You</small></div>
            {photoPreview && <img src={photoPreview} alt="" />}
            <h3>{draft.title || 'Your headline'}</h3>
            <p>{draft.body || 'Your message appears here.'}</p>
            {draft.linkUrl && <button type="button" tabIndex={-1}>{draft.ctaLabel || 'Learn more'} <ArrowUpRight size={14} /></button>}
          </article>
        </aside>
      </div>

      <section className="ads-panel ads-mine">
        <div className="ads-panel-heading"><span className="app-page-eyebrow">YOUR ADS</span></div>
        {campaigns.length ? campaigns.map((campaign) => {
          const [label, tone] = STATUS[campaign.status] ?? [campaign.status, 'muted']
          const ctr = campaign.impressions ? ((campaign.clicks / campaign.impressions) * 100).toFixed(1) : '0.0'
          return (
            <article key={campaign.id} className="ads-campaign">
              <div>
                <strong>{campaign.title}</strong>
                <small>{campaign.packageName} · {formatPrice(campaign.amountMinor, campaign.currency)} · created {formatDate(campaign.createdAt)}</small>
                {campaign.status === 'active' && <small>Live until {formatDate(campaign.endsAt)}</small>}
                {campaign.reviewNote && <small className="ads-note">Note from iConnect: {campaign.reviewNote}</small>}
              </div>
              <div className="ads-stats"><span><Eye size={13} /> {campaign.impressions}</span><span><MousePointerClick size={13} /> {campaign.clicks}</span><span>{ctr}% click rate</span></div>
              <span className={`ads-status ${tone}`}>{label}</span>
              {campaign.status === 'pending_payment' && <button type="button" disabled={busy !== ''} onClick={() => cancel(campaign)}>Discard</button>}
            </article>
          )
        }) : <p className="ads-empty">You haven't created an ad yet.</p>}
      </section>
    </div>
  )
}
