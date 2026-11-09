import React, { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, BadgeCheck, CreditCard, Heart, MapPin, RefreshCw, ShieldCheck } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { cancelBillingSubscription, confirmBillingPayment, getBillingCatalog, getMyBilling, startBillingCheckout } from '../../utils/billingApi.js'

const categories = [
  ['jobs', 'Job listings'],
  ['products', 'iBuy products'],
  ['marketplace', 'Local listings'],
  ['videos', 'Uploaded videos'],
]

function formatPrice(amountMinor, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'NGN' ? 0 : 2,
  }).format(amountMinor / 100)
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

function formatDate(value) {
  if (!value) return 'the end of your current billing period'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export default function BillingPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState(null)
  const [billing, setBilling] = useState(null)
  const [currency, setCurrency] = useState('NGN')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const [nextCatalog, nextBilling] = await Promise.all([getBillingCatalog(), getMyBilling()])
    setCatalog(nextCatalog)
    setBilling(nextBilling)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([getBillingCatalog(), getMyBilling()])
      .then(([nextCatalog, nextBilling]) => {
        if (!active) return
        setCatalog(nextCatalog)
        setBilling(nextBilling)
        setError('')
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not load billing details.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const reference = searchParams.get('reference')
    const status = searchParams.get('status')
    if (!reference || (status && status !== 'success')) return
    let active = true
    setBusy('confirm')
    setError('')
    confirmBillingPayment(reference)
      .then(async () => {
        if (!active) return
        await refresh()
        setNotice('Payment confirmed. Your purchase is active.')
        navigate('/app/billing', { replace: true })
      })
      .catch((confirmError) => { if (active) setError(confirmError.message || 'We could not confirm this payment yet.') })
      .finally(() => { if (active) setBusy('') })
    return () => { active = false }
  }, [navigate, refresh, searchParams])

  async function checkout(item, key) {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      const { checkoutUrl } = await startBillingCheckout(item)
      window.location.assign(checkoutUrl)
    } catch (checkoutError) {
      setError(checkoutError.message || 'Could not start secure checkout.')
      setBusy('')
    }
  }

  async function cancelSubscription() {
    if (!window.confirm('Cancel your publisher subscription? You will keep access through the current paid period when supported by your provider.')) return
    setBusy('cancel')
    setError('')
    setNotice('')
    try {
      const result = await cancelBillingSubscription()
      await refresh()
      setNotice(result.cancelAtPeriodEnd
        ? `Your plan will end on ${formatDate(result.currentPeriodEnd)}.`
        : 'Your subscription has been cancelled.')
    } catch (cancelError) {
      setError(cancelError.message || 'Could not cancel this subscription.')
    } finally {
      setBusy('')
    }
  }

  if (loading) return <div className="app-content-width"><p role="status">Loading billing…</p></div>
  const country = catalog?.location?.country
  // With a detected country the server already returns only local prices.
  // Without one, every plan comes back and the member picks a currency.
  const availableCurrencies = [...new Set((catalog?.plans ?? []).map((plan) => plan.currency))]
  const pickedCurrency = availableCurrencies.includes(currency) ? currency : availableCurrencies[0]
  const plans = country ? catalog?.plans ?? [] : catalog?.plans?.filter((plan) => plan.currency === pickedCurrency) ?? []
  const datingProducts = country
    ? catalog?.datingProducts ?? []
    : catalog?.datingProducts?.filter((product) => product.currency === pickedCurrency) ?? []
  const subscription = billing?.subscription
  const hasCurrentSubscription = Boolean(subscription && ['active', 'past_due'].includes(subscription.status))

  return (
    <div className="app-content-width billing-page">
      <AppPageHeader eyebrow="MEMBER BILLING" title="Plans & publishing" description="Manage monthly publishing limits, view your free allowances, and purchase optional dating extras." />
      {error && <p className="billing-feedback billing-error" role="alert">{error}</p>}
      {notice && <p className="billing-feedback billing-notice" role="status">{notice}</p>}

      <section className="billing-current-card">
        <div className="billing-current-icon"><ShieldCheck size={21} /></div>
        <div className="billing-current-copy">
          <span className="app-page-eyebrow">YOUR PUBLISHER PLAN</span>
          <h2>{subscription ? subscription.name : 'Free monthly allowances'}</h2>
          <p>{subscription
            ? `${formatPrice(subscription.amountMinor, subscription.currency)} per month · ${subscription.status === 'active' ? 'Active' : subscription.status}`
            : 'No paid plan is active. Free monthly category limits apply.'}</p>
          {subscription?.cancelAtPeriodEnd && <small>Scheduled to end on {formatDate(subscription.currentPeriodEnd)}.</small>}
        </div>
        {hasCurrentSubscription && !subscription.cancelAtPeriodEnd && <button type="button" className="billing-cancel-button" disabled={busy !== ''} onClick={cancelSubscription}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel plan'}</button>}
      </section>

      <section className="billing-section">
        <div className="billing-section-heading">
          <div><span className="app-page-eyebrow">THIS MONTH</span><h2>Your publishing allowance</h2></div>
          <button type="button" className="billing-refresh" aria-label="Refresh billing" onClick={() => refresh().catch((refreshError) => setError(refreshError.message))}><RefreshCw size={15} /> Refresh</button>
        </div>
        <div className="billing-quota-grid">
          {categories.map(([key, label]) => {
            const quota = billing?.postingQuotas?.[key]
            return <article className="billing-quota-card" key={key}>
              <span>{label}</span>
              <strong>{quota?.used ?? 0}<small> / {quota?.limit ?? 0}</small></strong>
              <div className="billing-quota-track"><i style={{ width: `${quota?.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 0}%` }} /></div>
              <small>{quota?.remaining ?? 0} remaining this month</small>
            </article>
          })}
        </div>
      </section>

      <section className="billing-section">
        <div className="billing-section-heading">
          <div><span className="app-page-eyebrow">MONTHLY PLANS</span><h2>Choose your publishing plan</h2></div>
          {country
            ? <p className="billing-location-note"><MapPin size={14} /> Prices for {countryName(country)}</p>
            : <label className="billing-currency-picker">Currency
              <select value={pickedCurrency ?? ''} onChange={(event) => setCurrency(event.target.value)} aria-label="Payment currency">
                {availableCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>}
        </div>
        <div className="billing-plan-grid">
          {plans.map((plan) => <article className="billing-plan-card" key={plan.id}>
            <span className="billing-plan-tag"><CreditCard size={14} /> Monthly</span>
            <h3>{plan.name}</h3>
            <p className="billing-plan-price">{formatPrice(plan.amountMinor, plan.currency)}<small> / month</small></p>
            <ul>{categories.map(([key, label]) => <li key={key}><BadgeCheck size={15} /> Up to {plan.postingLimits[key] ?? 0} {label.toLowerCase()} / month</li>)}</ul>
            <button type="button" className="app-primary-button" disabled={busy !== '' || hasCurrentSubscription} onClick={() => checkout({ plan_id: plan.id }, `plan-${plan.id}`)}>
              {busy === `plan-${plan.id}` ? 'Opening checkout…' : subscription?.status === 'active' && subscription.planId === plan.id ? 'Current plan' : hasCurrentSubscription ? 'Publisher plan active' : <>Choose plan <ArrowUpRight size={15} /></>}
            </button>
          </article>)}
          {!plans.length && <p className="billing-empty">{country ? `No publisher plans are available in ${countryName(country)} yet.` : 'No publisher plans are available in this currency right now.'}</p>}
        </div>
      </section>

      <section className="billing-section billing-dating-section">
        <div className="billing-section-heading"><div><span className="app-page-eyebrow">OPTIONAL DATING EXTRAS</span><h2>More ways to connect</h2></div></div>
        <div className="billing-dating-summary"><Heart size={17} /><span>{billing?.dating?.likesUsedToday ?? 0} of {billing?.dating?.freeLikesPerDay ?? 0} free likes used today · {billing?.dating?.extraLikesRemaining ?? 0} extra likes remaining</span><span>{billing?.dating?.profileBoostActive ? 'Profile boost active' : 'Your profile is not boosted'}</span></div>
        <div className="billing-plan-grid">
          {datingProducts.map((product) => <article className="billing-plan-card billing-addon-card" key={product.id}>
            <span className="billing-plan-tag"><Heart size={14} /> Dating extra</span><h3>{product.name}</h3>
            <p className="billing-plan-price">{formatPrice(product.amountMinor, product.currency)}<small>{product.quantity > 1 ? ` · ${product.quantity} likes` : product.durationHours ? ` · ${product.durationHours} hours` : ''}</small></p>
            <button type="button" className="app-primary-button" disabled={busy !== ''} onClick={() => checkout({ dating_product_id: product.id }, `dating-${product.id}`)}>
              {busy === `dating-${product.id}` ? 'Opening checkout…' : <>Continue to checkout <ArrowUpRight size={15} /></>}
            </button>
          </article>)}
          {!datingProducts.length && <p className="billing-empty">Dating extras are not currently available in this currency.</p>}
        </div>
      </section>
    </div>
  )
}
