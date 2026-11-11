import React, { useEffect, useState } from 'react'
import { CalendarClock, Flame, PiggyBank, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { addAjoContribution, createAjoPlan, deleteAjoContribution, getAjoPlans, setAjoPlanStatus } from '../../utils/ajoApi.js'

const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'CAD', 'GHS', 'KES', 'ZAR']
const FREQUENCIES = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }

function today() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

function money(minor, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'NGN' ? 0 : 2 }).format(minor / 100)
}

function dateLabel(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : ''
}

const emptyPlan = { name: '', currency: 'NGN', target: '', contribution: '', frequency: 'weekly', startDate: today(), targetDate: '' }

function PlanCard({ plan, busy, onContribute, onDelete, onStatus }) {
  const [amount, setAmount] = useState(String(plan.contributionAmountMinor / 100))
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const summary = plan.summary
  const open = plan.status === 'active' || plan.status === 'paused'

  return (
    <article className={`ajo-plan ${plan.status}`}>
      <div className="ajo-plan-head">
        <div><span className="app-page-eyebrow">{FREQUENCIES[plan.frequency].toUpperCase()} · {money(plan.contributionAmountMinor, plan.currency)}</span><h3>{plan.name}</h3></div>
        <span className={`ajo-status ${plan.status}`}>{summary.reachedTarget ? 'Target reached' : plan.status}</span>
      </div>
      <div className="ajo-progress"><i style={{ width: `${summary.progressPct}%` }} /></div>
      <div className="ajo-figures">
        <div><small>Saved</small><strong>{money(summary.savedMinor, plan.currency)}</strong></div>
        <div><small>Target</small><strong>{money(plan.targetAmountMinor, plan.currency)}</strong></div>
        <div><small>Progress</small><strong>{summary.progressPct}%</strong></div>
      </div>
      <ul className="ajo-facts">
        {summary.nextDueDate && <li className={summary.overdue ? 'warn' : ''}><CalendarClock size={14} /> {summary.overdue ? 'Overdue since' : 'Next contribution'} {dateLabel(summary.nextDueDate)}</li>}
        <li><Flame size={14} /> {summary.streak} {plan.frequency === 'daily' ? 'day' : plan.frequency === 'weekly' ? 'week' : 'month'} streak</li>
        {summary.behindByMinor > 0 && <li className="warn">{money(summary.behindByMinor, plan.currency)} behind schedule</li>}
        {summary.projectedFinish && <li>On schedule you'll finish around {dateLabel(summary.projectedFinish)}{plan.targetDate ? ` (goal: ${dateLabel(plan.targetDate)})` : ''}</li>}
      </ul>

      {open && (
        <form className="ajo-contribute" onSubmit={(event) => { event.preventDefault(); onContribute(plan, { amount, date, note }).then((ok) => { if (ok) setNote('') }) }}>
          <label>Amount<input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Date<input type="date" max={today()} min={plan.startDate} required value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="wide">Note (optional)<input maxLength="160" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Transferred to my savings account" /></label>
          <button type="submit" className="app-primary-button" disabled={busy}><Plus size={14} /> Record contribution</button>
        </form>
      )}

      <div className="ajo-plan-actions">
        <button type="button" onClick={() => setShowHistory((value) => !value)}>{showHistory ? 'Hide' : 'Show'} contributions ({plan.contributions.length})</button>
        {plan.status === 'active' && <button type="button" disabled={busy} onClick={() => onStatus(plan, 'paused')}>Pause</button>}
        {plan.status === 'paused' && <button type="button" disabled={busy} onClick={() => onStatus(plan, 'active')}>Resume</button>}
        {open && summary.reachedTarget && <button type="button" disabled={busy} onClick={() => onStatus(plan, 'completed')}>Mark completed</button>}
        {plan.status === 'completed' && <button type="button" disabled={busy} onClick={() => onStatus(plan, 'active')}>Reopen</button>}
        <button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm(`Close "${plan.name}"? It will be removed from your list.`)) onStatus(plan, 'cancelled') }}>Close plan</button>
      </div>
      {showHistory && (
        <ul className="ajo-history">
          {plan.contributions.map((item) => (
            <li key={item.id}>
              <span>{dateLabel(item.contributedOn)}</span>
              <strong>{money(item.amountMinor, plan.currency)}</strong>
              <small>{item.note}</small>
              <button type="button" aria-label="Remove contribution" disabled={busy} onClick={() => { if (window.confirm('Remove this contribution?')) onDelete(plan, item) }}><Trash2 size={13} /></button>
            </li>
          ))}
          {!plan.contributions.length && <li className="empty">No contributions recorded yet.</li>}
        </ul>
      )}
    </article>
  )
}

export default function AjoPage() {
  const [plans, setPlans] = useState([])
  const [draft, setDraft] = useState(emptyPlan)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    getAjoPlans()
      .then((result) => { setPlans(result); if (!result.length) setShowForm(true) })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false))
  }, [])

  function replace(plan) {
    setPlans((current) => (plan.status === 'cancelled'
      ? current.filter((item) => item.id !== plan.id)
      : current.some((item) => item.id === plan.id) ? current.map((item) => (item.id === plan.id ? plan : item)) : [plan, ...current]))
  }

  async function run(action, message) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const plan = await action()
      replace(plan)
      if (message) setNotice(typeof message === 'function' ? message(plan) : message)
      return true
    } catch (actionError) {
      setError(actionError.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitPlan(event) {
    event.preventDefault()
    const ok = await run(() => createAjoPlan(draft), (plan) => `"${plan.name}" created. Record each contribution as you make it.`)
    if (ok) { setDraft(emptyPlan); setShowForm(false) }
  }

  const per = Number(draft.contribution) || 0
  const target = Number(draft.target) || 0
  const estimate = per > 0 && target > 0 ? Math.ceil(target / per) : null

  if (loading) return <div className="app-content-width"><p role="status">Loading iConnect Ajo…</p></div>

  return (
    <div className="app-content-width ajo-page">
      <AppPageHeader eyebrow="ICONNECT AJO · PERSONAL SAVINGS" title="iConnect Ajo" description="Set a savings goal, decide how much and how often, and keep yourself on track.">
        {!showForm && <button type="button" className="app-primary-button" onClick={() => setShowForm(true)}><Plus size={15} /> New savings plan</button>}
      </AppPageHeader>
      <p className="ajo-safety"><ShieldCheck size={15} /> Your money stays in your own bank account. iConnect Ajo tracks your plan and contributions; it does not hold or move money.</p>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}

      {showForm && (
        <form className="ajo-form" onSubmit={submitPlan}>
          <div className="ajo-form-head"><div><span className="app-page-eyebrow">NEW PLAN</span><h2>What are you saving for?</h2></div>{plans.length > 0 && <button type="button" aria-label="Close form" onClick={() => setShowForm(false)}><X size={17} /></button>}</div>
          <label>Plan name<input required minLength="2" maxLength="60" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. School fees, New phone, Rent" /></label>
          <div className="ajo-form-row">
            <label>Currency<select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })}>{CURRENCIES.map((code) => <option key={code}>{code}</option>)}</select></label>
            <label>Target amount<input type="number" min="1" step="0.01" required value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} /></label>
          </div>
          <div className="ajo-form-row">
            <label>Each contribution<input type="number" min="1" step="0.01" required value={draft.contribution} onChange={(event) => setDraft({ ...draft, contribution: event.target.value })} /></label>
            <label>How often<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value })}>{Object.entries(FREQUENCIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <div className="ajo-form-row">
            <label>Start date<input type="date" required value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
            <label>Goal date (optional)<input type="date" min={draft.startDate} value={draft.targetDate} onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })} /></label>
          </div>
          {estimate && <p className="ajo-estimate"><PiggyBank size={15} /> That's {estimate} contribution{estimate === 1 ? '' : 's'} of {money(per * 100, draft.currency)} to reach {money(target * 100, draft.currency)}.</p>}
          <button type="submit" className="app-primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create plan'}</button>
        </form>
      )}

      <div className="ajo-plans">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            busy={busy}
            onContribute={(item, values) => run(() => addAjoContribution(item.id, values), 'Contribution recorded.')}
            onDelete={(item, contribution) => run(() => deleteAjoContribution(item.id, contribution.id), 'Contribution removed.')}
            onStatus={(item, status) => run(() => setAjoPlanStatus(item.id, status), status === 'cancelled' ? 'Plan closed.' : 'Plan updated.')}
          />
        ))}
        {!plans.length && !showForm && <p className="ajo-empty">No savings plans yet.</p>}
      </div>
    </div>
  )
}
