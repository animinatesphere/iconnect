import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, CircleDollarSign, Clock3, Plus, ShieldCheck, Trash2, WalletCards } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { addSavingsContribution, createSavingsPlan, deleteSavingsPlan, getSavingsContributions, getSavingsPlans, setSavingsPlanActive } from '../../utils/savingsApi.js'

const currency = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })
const frequencies = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
]
const frequencyUnits = { daily: 'day', weekly: 'week', monthly: 'month' }

function formatDate(value) {
  if (!value) return 'No target date'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
}

export default function InvestPage() {
  const [plans, setPlans] = useState([])
  const [contributions, setContributions] = useState({})
  const [expandedPlan, setExpandedPlan] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingPlan, setSavingPlan] = useState(false)
  const [busyPlan, setBusyPlan] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ name: '', target_amount: '', contribution_amount: '', frequency: 'weekly', target_date: '' })
  const totalSaved = useMemo(() => plans.reduce((sum, plan) => sum + Number(plan.saved_amount || 0), 0), [plans])

  async function loadPlans() {
    setError('')
    const loadedPlans = await getSavingsPlans()
    setPlans(loadedPlans)
    return loadedPlans
  }

  useEffect(() => {
    let active = true
    getSavingsPlans()
      .then((loadedPlans) => { if (active) setPlans(loadedPlans) })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not load your savings plans.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function createPlan(event) {
    event.preventDefault()
    setSavingPlan(true)
    setError('')
    setNotice('')
    try {
      await createSavingsPlan({
        ...form,
        target_amount: Number(form.target_amount),
        contribution_amount: Number(form.contribution_amount),
        target_date: form.target_date || null,
      })
      setForm({ name: '', target_amount: '', contribution_amount: '', frequency: 'weekly', target_date: '' })
      await loadPlans()
      setNotice('Your savings plan is ready. Add contributions whenever you save outside iConnect.')
    } catch (saveError) {
      setError(saveError.message || 'Could not create this savings plan.')
    } finally {
      setSavingPlan(false)
    }
  }

  async function toggleContributions(planId) {
    const nextId = expandedPlan === planId ? '' : planId
    setExpandedPlan(nextId)
    if (nextId && !contributions[nextId]) {
      try {
        const history = await getSavingsContributions(nextId)
        setContributions((current) => ({ ...current, [nextId]: history }))
      } catch (loadError) {
        setError(loadError.message || 'Could not load contribution history.')
      }
    }
  }

  async function recordContribution(plan) {
    setBusyPlan(plan.id)
    setError('')
    setNotice('')
    try {
      await addSavingsContribution(plan.id, { amount: Number(plan.contribution_amount), note: '' })
      const [updatedPlans, history] = await Promise.all([
        loadPlans(),
        getSavingsContributions(plan.id),
      ])
      setContributions((current) => ({ ...current, [plan.id]: history }))
      setExpandedPlan(plan.id)
      const updatedPlan = updatedPlans.find((item) => item.id === plan.id)
      setNotice(`Recorded ${currency.format(Number(plan.contribution_amount))}${updatedPlan ? ` toward ${updatedPlan.name}` : ''}. This is a personal record only.`)
    } catch (saveError) {
      setError(saveError.message || 'Could not record this contribution.')
    } finally {
      setBusyPlan('')
    }
  }

  async function changePlanStatus(plan) {
    setBusyPlan(plan.id)
    setError('')
    try {
      await setSavingsPlanActive(plan.id, !plan.active)
      await loadPlans()
    } catch (saveError) {
      setError(saveError.message || 'Could not update this savings plan.')
    } finally {
      setBusyPlan('')
    }
  }

  async function removePlan(plan) {
    if (!window.confirm(`Delete “${plan.name}” and its contribution history?`)) return
    setBusyPlan(plan.id)
    setError('')
    try {
      await deleteSavingsPlan(plan.id)
      setPlans((current) => current.filter((item) => item.id !== plan.id))
      setContributions((current) => {
        const next = { ...current }
        delete next[plan.id]
        return next
      })
      setNotice('Savings plan and its history deleted.')
    } catch (saveError) {
      setError(saveError.message || 'Could not delete this savings plan.')
    } finally {
      setBusyPlan('')
    }
  }

  return (
    <div className="app-content-width savings-page">
      <AppPageHeader eyebrow="YOUR PERSONAL SAVINGS TRACKER" title="Save at your pace" description="Set a goal, choose a rhythm, and keep a private record of what you save." />
      <div className="savings-disclaimer" role="note">
        <ShieldCheck size={18} />
        <span><strong>Tracking only — no money moves through iConnect.</strong> Contributions are self-reported records, not deposits, payments, or verified balances. iConnect does not hold your funds.</span>
      </div>
      {error && <p className="savings-feedback savings-error" role="alert">{error}</p>}
      {notice && <p className="savings-feedback savings-notice" role="status">{notice}</p>}
      <section className="savings-summary">
        <div className="savings-summary-icon"><CircleDollarSign size={23} /></div>
        <div><span>RECORDED SAVINGS</span><strong>{currency.format(totalSaved)}</strong><small>Based on contributions you have manually logged</small></div>
        <div className="savings-plan-count"><strong>{plans.length}</strong><span>{plans.length === 1 ? 'plan' : 'plans'}</span></div>
      </section>
      <div className="savings-layout">
        <section className="savings-plan-list">
          <div className="savings-section-heading"><div><span className="app-page-eyebrow">YOUR GOALS</span><h2>Savings plans</h2></div><span className="savings-count">{plans.length}</span></div>
          {loading ? <div className="savings-empty" role="status">Loading your savings plans…</div>
            : !plans.length ? <div className="savings-empty"><WalletCards size={26} /><strong>Your first goal starts here</strong><span>Create a personal plan and log contributions as you make them.</span></div>
              : <div className="savings-plan-cards">{plans.map((plan) => {
                const saved = Number(plan.saved_amount || 0)
                const target = Number(plan.target_amount)
                const progress = Math.min(100, Math.round((saved / target) * 100))
                const busy = busyPlan === plan.id
                return (
                  <article className={`savings-plan-card ${!plan.active ? 'savings-plan-paused' : ''}`} key={plan.id}>
                    <div className="savings-plan-card-top">
                      <div><span className="savings-plan-frequency"><Clock3 size={13} /> {plan.frequency}</span><h3>{plan.name}</h3></div>
                      <span className={`savings-active-pill ${plan.active ? 'is-active' : ''}`}>{plan.active ? 'Active' : 'Paused'}</span>
                    </div>
                    <div className="savings-amount-row"><strong>{currency.format(saved)}</strong><span>of {currency.format(target)}</span></div>
                    <div className="savings-progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100" aria-label={`${plan.name} progress`}><span style={{ width: `${progress}%` }} /></div>
                    <div className="savings-plan-meta"><span>{progress}% saved</span><span>{currency.format(Number(plan.contribution_amount))} / {frequencyUnits[plan.frequency]}</span></div>
                    <div className="savings-plan-date"><CalendarDays size={14} /> {formatDate(plan.target_date)}</div>
                    <div className="savings-plan-actions">
                      <button type="button" className="app-primary-button" disabled={!plan.active || busy} onClick={() => recordContribution(plan)}><Check size={15} /> {busy ? 'Saving…' : 'Log contribution'}</button>
                      <button type="button" className="savings-quiet-button" onClick={() => toggleContributions(plan.id)} aria-expanded={expandedPlan === plan.id}><ChevronDown size={15} /> History</button>
                      <button type="button" className="savings-icon-button" disabled={busy} onClick={() => changePlanStatus(plan)} aria-label={plan.active ? `Pause ${plan.name}` : `Resume ${plan.name}`}>{plan.active ? 'Pause' : 'Resume'}</button>
                      <button type="button" className="savings-icon-button savings-delete-button" disabled={busy} onClick={() => removePlan(plan)} aria-label={`Delete ${plan.name}`}><Trash2 size={15} /></button>
                    </div>
                    {expandedPlan === plan.id && <div className="savings-history">
                      {!contributions[plan.id] ? <span>Loading contribution history…</span>
                        : contributions[plan.id].length ? contributions[plan.id].map((item) => <div key={item.id}><span>{formatDate(String(item.contributed_at).slice(0, 10))}{item.note ? ` · ${item.note}` : ''}</span><strong>{currency.format(Number(item.amount))}</strong></div>)
                          : <span>No contributions recorded yet.</span>}
                    </div>}
                  </article>
                )
              })}</div>}
        </section>
        <aside className="savings-create-card">
          <span className="savings-create-icon"><Plus size={19} /></span>
          <span className="app-page-eyebrow">MAKE A PLAN</span>
          <h2>Start a new goal</h2>
          <p>Choose an amount and schedule that fit your own budget.</p>
          <form onSubmit={createPlan} className="savings-form">
            <label>What are you saving for?<input required maxLength={100} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. New laptop" /></label>
            <label>Target amount (₦)<input required type="number" min="1" step="1" value={form.target_amount} onChange={(event) => setForm((current) => ({ ...current, target_amount: event.target.value }))} placeholder="500000" /></label>
            <label>Contribution amount (₦)<input required type="number" min="1" step="1" value={form.contribution_amount} onChange={(event) => setForm((current) => ({ ...current, contribution_amount: event.target.value }))} placeholder="10000" /></label>
            <label>How often?<select value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}>{frequencies.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}</select></label>
            <label>Target date <span className="savings-optional">(optional)</span><input type="date" min={new Date().toISOString().slice(0, 10)} value={form.target_date} onChange={(event) => setForm((current) => ({ ...current, target_date: event.target.value }))} /></label>
            <button type="submit" className="app-primary-button" disabled={savingPlan}>{savingPlan ? 'Creating plan…' : 'Create savings plan'}</button>
          </form>
        </aside>
      </div>
      <section className="invest-learning-section savings-invest-section">
        <div><span className="app-page-eyebrow">INVESTING · NOT LIVE YET</span><h2>Understand the risk<br />before the return.</h2><p>Investment products are not available in iConnect yet. This preview does not recommend investments, accept deposits, or make purchases. Any future service needs suitable regulated partners and clear risk information.</p></div>
        <div className="invest-safety-list">
          <article><ShieldCheck size={18} /><div><strong>Know what you are buying</strong><span>Understand fees, access to funds, and how an investment can lose value.</span></div></article>
          <article><CircleDollarSign size={18} /><div><strong>Keep savings separate</strong><span>Your plans above are manual records, not an investment or verified balance.</span></div></article>
          <article><Clock3 size={18} /><div><strong>Wait for verified availability</strong><span>No investment orders or transfers can be made from this page.</span></div></article>
        </div>
      </section>
    </div>
  )
}
