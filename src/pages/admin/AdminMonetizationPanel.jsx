import React, { useEffect, useState } from 'react'
import { BadgeDollarSign, CircleDollarSign, Save } from 'lucide-react'
import { getAdminMonetization, saveAdminDatingProduct, saveAdminMonetizationSettings, saveAdminSubscriptionPlan } from '../../utils/adminApi.js'

const categoryFields = [
  ['jobs', 'Job listings'],
  ['products', 'iBuy products'],
  ['marketplace', 'Local marketplace listings'],
  ['videos', 'Uploaded videos'],
]

function amountToMajor(amountMinor) {
  return (Number(amountMinor) / 100).toFixed(2).replace(/\.00$/, '')
}

function amountToMinor(value) {
  const amount = Number(value)
  return Math.round(amount * 100)
}

function formatMoney(minor, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'NGN' ? 0 : 2,
  }).format(Number(minor) / 100)
}

function planDraft(plan) {
  return {
    ...plan,
    amount: amountToMajor(plan.amountMinor),
    postingLimits: { ...plan.postingLimits },
  }
}

export default function AdminMonetizationPanel() {
  const [data, setData] = useState(null)
  const [plans, setPlans] = useState([])
  const [products, setProducts] = useState([])
  const [settings, setSettings] = useState(null)
  const [newPlan, setNewPlan] = useState({
    name: '',
    currency: 'NGN',
    amount: '',
    postingLimits: { jobs: 10, products: 10, marketplace: 10, videos: 10 },
    active: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const result = await getAdminMonetization()
    setData(result)
    setPlans(result.plans.map(planDraft))
    setProducts(result.datingProducts.map((product) => ({
      ...product,
      amount: amountToMajor(product.amountMinor),
    })))
    setSettings({
      ...result.settings,
      freeMonthlyLimits: { ...result.settings.freeMonthlyLimits },
      marketplaceCommissionPercent: result.settings.marketplaceCommissionBps / 100,
    })
  }

  useEffect(() => {
    let active = true
    getAdminMonetization()
      .then((result) => {
        if (!active) return
        setData(result)
        setPlans(result.plans.map(planDraft))
        setProducts(result.datingProducts.map((product) => ({ ...product, amount: amountToMajor(product.amountMinor) })))
        setSettings({
          ...result.settings,
          freeMonthlyLimits: { ...result.settings.freeMonthlyLimits },
          marketplaceCommissionPercent: result.settings.marketplaceCommissionBps / 100,
        })
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not load monetization settings.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function savePlan(plan) {
    setSaving(plan.id || 'new-plan')
    setError('')
    setNotice('')
    try {
      await saveAdminSubscriptionPlan({
        ...plan,
        amountMinor: amountToMinor(plan.amount),
      })
      await load()
      if (!plan.id) setNewPlan((current) => ({ ...current, name: '', amount: '' }))
      setNotice(plan.id ? 'Publisher plan saved.' : 'Publisher plan created.')
    } catch (saveError) {
      setError(saveError.message || 'Could not save this publisher plan.')
    } finally {
      setSaving('')
    }
  }

  async function saveSettings(event) {
    event.preventDefault()
    setSaving('settings')
    setError('')
    setNotice('')
    try {
      await saveAdminMonetizationSettings(settings)
      await load()
      setNotice('Free monthly allowances and daily dating likes saved.')
    } catch (saveError) {
      setError(saveError.message || 'Could not save allowance settings.')
    } finally {
      setSaving('')
    }
  }

  async function saveDatingProduct(product) {
    setSaving(product.id)
    setError('')
    setNotice('')
    try {
      await saveAdminDatingProduct({
        ...product,
        amountMinor: amountToMinor(product.amount),
      })
      await load()
      setNotice(`${product.name} saved.`)
    } catch (saveError) {
      setError(saveError.message || 'Could not save this dating extra.')
    } finally {
      setSaving('')
    }
  }

  function updatePlan(index, key, value) {
    setPlans((current) => current.map((plan, planIndex) => planIndex === index
      ? { ...plan, [key]: value }
      : plan))
  }

  function updatePlanLimit(index, key, value) {
    setPlans((current) => current.map((plan, planIndex) => planIndex === index
      ? { ...plan, postingLimits: { ...plan.postingLimits, [key]: value } }
      : plan))
  }

  function updateNewPlanLimit(key, value) {
    setNewPlan((current) => ({ ...current, postingLimits: { ...current.postingLimits, [key]: value } }))
  }

  if (loading) return <p className="admin-detail-loading">Loading monetization settings…</p>

  return (
    <div className="admin-monetization">
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <section className="admin-monetization-revenue">
        {Object.entries(data?.revenue ?? {}).map(([currency, totals]) => <article className="admin-monetization-revenue-card" key={currency}>
          <div><CircleDollarSign size={19} /><span>{currency} revenue</span></div>
          <strong>{formatMoney(totals.thisMonthMinor, currency)}</strong><small>This month · {totals.paidTransactions} paid transactions</small>
          <p>All time: {formatMoney(totals.allTimeMinor, currency)} · {data.activeSubscriptions[currency] ?? 0} active subscriptions</p>
        </article>)}
        {!Object.keys(data?.revenue ?? {}).length && <article className="admin-monetization-revenue-card"><span>Revenue will appear here after the first successful payment.</span></article>}
      </section>
      <section className="admin-panel admin-monetization-marketplace-revenue">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">MARKETPLACE SALES</span><h2>Sales and seller settlement</h2></div></div>
        {Object.entries(data?.marketplaceRevenue ?? {}).map(([currency, totals]) => <div className="admin-marketplace-revenue-row" key={currency}>
          <strong>{currency}</strong>
          <span>This month gross <b>{formatMoney(totals.thisMonthGrossMinor, currency)}</b></span>
          <span>Commission this month <b>{formatMoney(totals.thisMonthCommissionMinor, currency)}</b></span>
          <span>All-time commission <b>{formatMoney(totals.allTimeCommissionMinor, currency)}</b></span>
          <span>Seller payouts due <b>{formatMoney(totals.sellerPayoutDueMinor, currency)}</b></span>
        </div>)}
        {!Object.keys(data?.marketplaceRevenue ?? {}).length && <p className="admin-panel-note">Marketplace sales and commission totals will appear after the first paid order.</p>}
      </section>

      <form className="admin-panel admin-monetization-settings" onSubmit={saveSettings}>
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">FREE MONTHLY TRIAL ALLOWANCE</span><h2>Member posting limits</h2></div></div>
        <div className="admin-monetization-fields">
          {categoryFields.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" max="1000" required value={settings.freeMonthlyLimits[key]} onChange={(event) => setSettings((current) => ({ ...current, freeMonthlyLimits: { ...current.freeMonthlyLimits, [key]: event.target.value } }))} /></label>)}
          <label>Free dating likes per day<input type="number" min="0" max="1000" required value={settings.freeDailyDatingLikes} onChange={(event) => setSettings((current) => ({ ...current, freeDailyDatingLikes: event.target.value }))} /></label>
          <label>Marketplace commission (%)<input type="number" min="0" max="30" step="0.1" required value={settings.marketplaceCommissionPercent} onChange={(event) => setSettings((current) => ({ ...current, marketplaceCommissionPercent: event.target.value }))} /></label>
        </div>
        <button type="submit" className="admin-row-action admin-monetization-save" disabled={saving !== ''}><Save size={14} /> {saving === 'settings' ? 'Saving…' : 'Save allowances'}</button>
      </form>

      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">RECURRING PUBLISHER PLANS</span><h2>Plan prices & category caps</h2></div></div>
        <div className="admin-monetization-plan-list">
          {plans.map((plan, index) => <form className="admin-monetization-plan" key={plan.id} onSubmit={(event) => { event.preventDefault(); savePlan(plan) }}>
            <div className="admin-monetization-fields">
              <label>Plan name<input value={plan.name} required maxLength="80" onChange={(event) => updatePlan(index, 'name', event.target.value)} /></label>
              <label>Currency<select value={plan.currency} onChange={(event) => updatePlan(index, 'currency', event.target.value)}><option value="NGN">NGN</option><option value="USD">USD</option></select></label>
              <label>Monthly price<input type="number" min="0.01" step={plan.currency === 'NGN' ? '1' : '0.01'} required value={plan.amount} onChange={(event) => updatePlan(index, 'amount', event.target.value)} /></label>
              {categoryFields.map(([key, label]) => <label key={key}>{label} / month<input type="number" min="0" max="10000" required value={plan.postingLimits[key]} onChange={(event) => updatePlanLimit(index, key, event.target.value)} /></label>)}
            </div>
            <div className="admin-monetization-plan-footer"><label className="admin-monetization-active"><input type="checkbox" checked={plan.active} onChange={(event) => updatePlan(index, 'active', event.target.checked)} /> Available to members</label><button type="submit" className="admin-row-action" disabled={saving !== ''}><Save size={13} /> {saving === plan.id ? 'Saving…' : 'Save plan'}</button></div>
          </form>)}
        </div>
        <form className="admin-monetization-plan admin-monetization-new-plan" onSubmit={(event) => { event.preventDefault(); savePlan(newPlan) }}>
          <h3><BadgeDollarSign size={16} /> Add a publisher plan</h3>
          <div className="admin-monetization-fields">
            <label>Plan name<input value={newPlan.name} required maxLength="80" onChange={(event) => setNewPlan((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>Currency<select value={newPlan.currency} onChange={(event) => setNewPlan((current) => ({ ...current, currency: event.target.value }))}><option value="NGN">NGN</option><option value="USD">USD</option></select></label>
            <label>Monthly price<input type="number" min="0.01" step={newPlan.currency === 'NGN' ? '1' : '0.01'} required value={newPlan.amount} onChange={(event) => setNewPlan((current) => ({ ...current, amount: event.target.value }))} /></label>
            {categoryFields.map(([key, label]) => <label key={key}>{label} / month<input type="number" min="0" max="10000" required value={newPlan.postingLimits[key]} onChange={(event) => updateNewPlanLimit(key, event.target.value)} /></label>)}
          </div>
          <button type="submit" className="admin-row-action" disabled={saving !== ''}><Save size={13} /> {saving === 'new-plan' ? 'Creating…' : 'Create plan'}</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="app-page-eyebrow">DATING ADD-ONS</span><h2>Optional paid extras</h2></div></div>
        <div className="admin-monetization-plan-list">
          {products.map((product, index) => <form className="admin-monetization-plan" key={product.id} onSubmit={(event) => { event.preventDefault(); saveDatingProduct(product) }}>
            <div className="admin-monetization-fields">
              <label>Product<input value={product.name} required maxLength="80" onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label>
              <label>Currency<input value={product.currency} readOnly /></label>
              <label>Price<input type="number" min="0" step={product.currency === 'NGN' ? '1' : '0.01'} required value={product.amount} onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} /></label>
              {product.code === 'extra_likes'
                ? <label>Likes included<input type="number" min="1" max="1000" required value={product.quantity} onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>
                : <label>Boost duration (hours)<input type="number" min="1" max="720" required value={product.durationHours} onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, durationHours: event.target.value } : item))} /></label>}
            </div>
            <div className="admin-monetization-plan-footer"><label className="admin-monetization-active"><input type="checkbox" checked={product.active} onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} /> Enabled · {product.code}</label><button type="submit" className="admin-row-action" disabled={saving !== ''}><Save size={13} /> {saving === product.id ? 'Saving…' : 'Save extra'}</button></div>
          </form>)}
        </div>
      </section>
    </div>
  )
}
