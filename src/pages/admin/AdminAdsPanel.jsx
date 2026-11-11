import React, { useEffect, useState } from 'react'
import { BadgeDollarSign, CheckCircle2, Megaphone, Save, XCircle } from 'lucide-react'
import { getAdminAds, reviewAdminAd, saveAdminAdPackage } from '../../utils/adsApi.js'

const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'CAD', 'AUD', 'NZD', 'GHS', 'KES', 'ZAR', 'INR', 'AED']
const STATUS_LABELS = { pending_payment: 'Unpaid', in_review: 'Waiting for review', active: 'Live', rejected: 'Rejected', expired: 'Finished', cancelled: 'Stopped / cancelled' }

function money(minor, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'NGN' ? 0 : 2 }).format(Number(minor) / 100)
}

function parseCountries(text) {
  return [...new Set(String(text || '').split(/[\s,]+/).map((code) => code.trim().toUpperCase()).filter(Boolean))]
}

function packageDraft(item) {
  return { ...item, amount: (item.amountMinor / 100).toString(), countriesText: (item.countryCodes ?? []).join(', ') }
}

const newPackage = { name: '', description: '', durationDays: 7, currency: 'NGN', amount: '', countriesText: 'NG', active: true }

function ReviewRow({ campaign, busy, onReview }) {
  const [note, setNote] = useState('')
  return (
    <article className="admin-ad-review">
      <div className="admin-ad-preview">
        {campaign.imageUrl && <img src={campaign.imageUrl} alt="" />}
        <div>
          <strong>{campaign.title}</strong>
          <p>{campaign.body}</p>
          {campaign.linkUrl && <a href={campaign.linkUrl} target="_blank" rel="noopener noreferrer">{campaign.ctaLabel} → {campaign.linkUrl}</a>}
          <small>{campaign.advertiser?.name} ({campaign.advertiser?.email}) · {campaign.packageName} · {money(campaign.amountMinor, campaign.currency)} paid · {campaign.durationDays} days</small>
        </div>
      </div>
      <div className="admin-ad-review-actions">
        <input value={note} maxLength="300" onChange={(event) => setNote(event.target.value)} placeholder="Note to the advertiser (required to reject)" />
        <button type="button" className="admin-row-action" disabled={busy} onClick={() => onReview(campaign, 'approve', note)}><CheckCircle2 size={13} /> Approve & start</button>
        <button type="button" className="admin-row-action admin-row-danger" disabled={busy || !note.trim()} onClick={() => onReview(campaign, 'reject', note)}><XCircle size={13} /> Reject</button>
      </div>
    </article>
  )
}

export default function AdminAdsPanel() {
  const [data, setData] = useState(null)
  const [packages, setPackages] = useState([])
  const [draft, setDraft] = useState(newPackage)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const result = await getAdminAds()
    setData(result)
    setPackages(result.packages.map(packageDraft))
  }

  useEffect(() => { load().catch((loadError) => setError(loadError.message)) }, [])

  async function savePackage(item) {
    setBusy(item.id || 'new')
    setError('')
    setNotice('')
    try {
      const countryCodes = parseCountries(item.countriesText)
      if (countryCodes.some((code) => !/^[A-Z]{2}$/.test(code))) throw new Error('Countries must be two-letter codes, for example NG, US, GB.')
      await saveAdminAdPackage({ ...item, countryCodes })
      await load()
      if (!item.id) setDraft(newPackage)
      setNotice(item.id ? 'Ad package saved.' : 'Ad package created.')
    } catch (saveError) {
      setError(saveError.message || 'Could not save the package.')
    } finally {
      setBusy('')
    }
  }

  async function review(campaign, decision, note) {
    if (decision === 'stop' && !window.confirm(`Stop "${campaign.title}" now? It will no longer be shown.`)) return
    setBusy(campaign.id)
    setError('')
    setNotice('')
    try {
      await reviewAdminAd(campaign.id, decision, note)
      await load()
      setNotice(decision === 'approve' ? 'Ad approved. Its run has started.' : decision === 'reject' ? 'Ad rejected. Refund the payment from the Paystack or Stripe dashboard if appropriate.' : 'Ad stopped.')
    } catch (reviewError) {
      setError(reviewError.message)
    } finally {
      setBusy('')
    }
  }

  if (!data) return <section className="admin-panel"><p>{error || 'Loading ads…'}</p></section>
  const queue = data.campaigns.filter((item) => item.status === 'in_review')
  const others = data.campaigns.filter((item) => item.status !== 'in_review')

  function packageFields(item, onChange) {
    return (
      <div className="admin-monetization-fields">
        <label>Package name<input required maxLength="80" value={item.name} onChange={(event) => onChange('name', event.target.value)} /></label>
        <label>Short description<input maxLength="200" value={item.description} onChange={(event) => onChange('description', event.target.value)} placeholder="e.g. Shown in the home feed" /></label>
        <label>Days in the feed<input type="number" min="1" max="365" required value={item.durationDays} onChange={(event) => onChange('durationDays', event.target.value)} /></label>
        <label>Currency<select value={item.currency} onChange={(event) => onChange('currency', event.target.value)}>{CURRENCIES.map((code) => <option key={code}>{code}</option>)}</select></label>
        <label>Price<input type="number" min="1" step={item.currency === 'NGN' ? '1' : '0.01'} required value={item.amount} onChange={(event) => onChange('amount', event.target.value)} /></label>
        <label>Countries (codes)<input value={item.countriesText} onChange={(event) => onChange('countriesText', event.target.value)} placeholder="Empty = everyone else" /></label>
      </div>
    )
  }

  return (
    <div className="admin-monetization">
      {error && <p className="admin-panel-note admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-panel-note" role="status">{notice}</p>}

      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">AD REVENUE</span><h2>Paid ads</h2></div></div>
        <div className="admin-ads-revenue">
          {Object.entries(data.revenue).map(([currency, totals]) => <div key={currency}><span>{currency}</span><strong>{money(totals.totalMinor, currency)}</strong><small>{totals.paidCampaigns} paid ads</small></div>)}
          {!Object.keys(data.revenue).length && <p className="admin-panel-note">Ad revenue will appear after the first paid ad.</p>}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">REVIEW QUEUE</span><h2>Paid ads waiting for approval ({queue.length})</h2></div></div>
        {queue.map((campaign) => <ReviewRow key={campaign.id} campaign={campaign} busy={busy !== ''} onReview={review} />)}
        {!queue.length && <p className="admin-panel-note">No ads are waiting for review.</p>}
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">ALL ADS</span><h2>Recent campaigns</h2></div></div>
        <div className="admin-ads-list">
          {others.map((campaign) => (
            <div key={campaign.id} className="admin-ads-row">
              <div><strong>{campaign.title}</strong><small>{campaign.advertiser?.name} · {money(campaign.amountMinor, campaign.currency)} · {campaign.impressions} views · {campaign.clicks} clicks</small></div>
              <span className={`admin-ads-status ${campaign.status}`}>{STATUS_LABELS[campaign.status]}</span>
              {campaign.status === 'active' && <button type="button" className="admin-row-action admin-row-danger" disabled={busy !== ''} onClick={() => review(campaign, 'stop', '')}>Stop</button>}
            </div>
          ))}
          {!others.length && <p className="admin-panel-note">No other ads yet.</p>}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">AD PACKAGES & PRICES</span><h2>What members can buy</h2></div></div>
        <p className="admin-panel-note">Members see the packages for the country they browse from. Packages with no countries are the default for every other country. NGN is charged through Paystack; other currencies through Stripe.</p>
        {!data.canManagePackages && <p className="admin-panel-note">Only a super-admin can change ad prices.</p>}
        <div className="admin-monetization-plan-list">
          {packages.map((item, index) => (
            <form key={item.id} className="admin-monetization-plan" onSubmit={(event) => { event.preventDefault(); savePackage(item) }}>
              <fieldset disabled={!data.canManagePackages} className="admin-ads-fieldset">
                {packageFields(item, (field, value) => setPackages((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))))}
                <div className="admin-monetization-plan-footer">
                  <label className="admin-monetization-active"><input type="checkbox" checked={item.active} onChange={(event) => setPackages((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, active: event.target.checked } : row)))} /> Available to members</label>
                  <button type="submit" className="admin-row-action"><Save size={13} /> {busy === item.id ? 'Saving…' : 'Save package'}</button>
                </div>
              </fieldset>
            </form>
          ))}
        </div>
        {data.canManagePackages && (
          <form className="admin-monetization-plan admin-monetization-new-plan" onSubmit={(event) => { event.preventDefault(); savePackage(draft) }}>
            <h3><BadgeDollarSign size={16} /> Add an ad package</h3>
            {packageFields(draft, (field, value) => setDraft((current) => ({ ...current, [field]: value })))}
            <button type="submit" className="admin-row-action" disabled={busy !== ''}><Megaphone size={13} /> {busy === 'new' ? 'Creating…' : 'Create package'}</button>
          </form>
        )}
      </section>
    </div>
  )
}
