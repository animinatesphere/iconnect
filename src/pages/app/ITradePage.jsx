import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  Gauge,
  History,
  LockKeyhole,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import {
  authorizeTradingTicket,
  closeTradingTicket,
  declineTradingTicket,
  draftTradingTicket,
  getTradingOverview,
  reportExternalTicket,
  saveTradingProfile,
} from '../../utils/tradingApi.js'

const PAIR_NAMES = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CAD', 'EUR/GBP', 'EUR/JPY', 'EUR/CAD', 'GBP/JPY', 'GBP/CAD', 'CAD/JPY']

const TOLERANCE_PRESETS = {
  capital_preservation: { minProbability: 75, maxRiskPerIdeaPct: 0.5, maxCorrelatedRiskPct: 1, maxOpenIdeas: 2, dailyLossLimitPct: 1.5, weeklyLossLimitPct: 3 },
  conservative: { minProbability: 70, maxRiskPerIdeaPct: 0.75, maxCorrelatedRiskPct: 1.5, maxOpenIdeas: 2, dailyLossLimitPct: 2, weeklyLossLimitPct: 4 },
  balanced: { minProbability: 65, maxRiskPerIdeaPct: 1, maxCorrelatedRiskPct: 2, maxOpenIdeas: 3, dailyLossLimitPct: 3, weeklyLossLimitPct: 6 },
  custom_restrictive: { minProbability: 65, maxRiskPerIdeaPct: 1, maxCorrelatedRiskPct: 2, maxOpenIdeas: 3, dailyLossLimitPct: 3, weeklyLossLimitPct: 6 },
}

const initialProfile = {
  operatingMode: 'paper',
  accountCurrency: 'USD',
  capital: '10000',
  riskTolerance: 'conservative',
  ...TOLERANCE_PRESETS.conservative,
  referenceQuantity: '50000',
  maxQuantity: '100000',
  maxRiskPerIdea: '75',
  permittedPairs: PAIR_NAMES.slice(0, 5),
  acknowledgeRisk: false,
  acknowledgeManualExecution: false,
  acknowledgeExternalUnverified: false,
}

const initialTicket = {
  pair: 'EUR/USD',
  side: 'buy',
  entryPrice: '',
  stopPrice: '',
  targetPrice: '',
  spreadPips: '1',
  slippagePips: '0.5',
  commissionPer100k: '0',
  gapAllowancePips: '0',
  probability: '',
  releaseState: 'FULL_PRINT',
  microstructureUsable: false,
  dataChecked: false,
  quoteToAccountRate: '',
  rationale: '',
  eventLabel: '',
}

const STATUS_LABELS = {
  rejected: 'No trade',
  drafted: 'Draft — awaiting you',
  expired: 'Expired',
  declined: 'Declined',
  accepted_manual: 'Accepted for manual entry',
  open: 'Open (paper)',
  not_filled: 'Not filled',
  cancelled: 'Cancelled',
  closed: 'Closed',
}

const LIMIT_LABELS = {
  perIdeaAmount: 'per-idea amount',
  perIdeaEquityPct: 'per-idea % of equity',
  correlatedExposure: 'correlated currency cap',
  wideStopReference: 'reference size (wide-stop cut)',
  absoluteMaximum: 'absolute maximum',
}

const MODE_LABELS = { paper: 'PAPER', external_manual: 'EXTERNAL MANUAL' }

const AUDIT_LABELS = {
  profile_saved: 'Risk profile saved',
  ticket_drafted: 'Ticket drafted',
  ticket_rejected: 'Ticket rejected',
  ticket_authorized: 'Ticket authorized',
  ticket_declined: 'Ticket declined',
  ticket_expired: 'Ticket expired',
  revalidation_failed: 'Final check failed',
  external_filled: 'External fill reported',
  external_not_filled: 'External: not filled',
  external_cancelled: 'External: cancelled',
  position_closed: 'Position closed',
}

function pipSize(pair) {
  return pair.endsWith('JPY') ? 0.01 : 0.0001
}

function formatPrice(pair, value) {
  if (value === null || value === undefined) return '—'
  return Number(value).toFixed(pair.endsWith('JPY') ? 3 : 5)
}

function formatMoney(value, currency) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value))
}

function formatUnits(value) {
  return value ? `${Number(value).toLocaleString('en-US')} units` : '—'
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

function profileToForm(settings) {
  return {
    operatingMode: settings.operating_mode,
    accountCurrency: settings.account_currency,
    capital: String(settings.capital),
    riskTolerance: settings.risk_tolerance,
    minProbability: settings.min_probability,
    referenceQuantity: String(settings.reference_quantity),
    maxQuantity: String(settings.max_quantity),
    maxRiskPerIdea: String(settings.max_risk_per_idea),
    maxRiskPerIdeaPct: settings.max_risk_per_idea_pct,
    maxCorrelatedRiskPct: settings.max_correlated_risk_pct,
    maxOpenIdeas: settings.max_open_ideas,
    dailyLossLimitPct: settings.daily_loss_limit_pct,
    weeklyLossLimitPct: settings.weekly_loss_limit_pct,
    permittedPairs: settings.permitted_pairs,
    acknowledgeRisk: false,
    acknowledgeManualExecution: false,
    acknowledgeExternalUnverified: false,
  }
}

function GateIcon({ status }) {
  if (status === 'pass') return <CheckCircle2 size={14} className="itrade-gate-pass" />
  if (status === 'fail') return <XCircle size={14} className="itrade-gate-fail" />
  return <Circle size={14} className="itrade-gate-idle" />
}

function DecisionCard({ ticket, currency, mode, now, busy, onAuthorize, onDecline }) {
  const decision = ticket.decision
  const metrics = decision.metrics || {}
  const draft = decision.draft
  const [quantity, setQuantity] = useState(ticket.draftedQuantity || '')
  useEffect(() => setQuantity(ticket.draftedQuantity || ''), [ticket.id, ticket.draftedQuantity])
  const secondsLeft = ticket.expiresAt ? Math.max(0, Math.floor((new Date(ticket.expiresAt).getTime() - now) / 1000)) : 0
  const isDraft = ticket.status === 'drafted' && secondsLeft > 0
  const quantityNumber = Number(quantity)
  const quantityValid = quantityNumber >= 1000 && quantityNumber % 1000 === 0 && quantityNumber <= ticket.draftedQuantity
  const riskForQuantity = draft && quantityValid ? quantityNumber * draft.lossPerUnit : null
  const external = ticket.operatingMode === 'external_manual'

  return (
    <article className={`itrade-decision ${decision.qualified ? 'qualified' : 'rejected'}`}>
      <div className="itrade-decision-top">
        <span className={`itrade-mode-badge ${ticket.operatingMode}`}>{MODE_LABELS[ticket.operatingMode]}</span>
        <span className="itrade-decision-status">{STATUS_LABELS[ticket.status]}</span>
      </div>
      <div className="itrade-decision-pair">
        <strong>{ticket.pair}</strong>
        <span className={`itrade-side ${ticket.side}`}>{ticket.side.toUpperCase()}</span>
      </div>
      <p className="itrade-decision-reason">{decision.reason}</p>
      {decision.inputs?.rationale && <p className="itrade-decision-rationale">“{decision.inputs.rationale}”</p>}

      <dl className="itrade-decision-terms">
        <div><dt>Entry</dt><dd>{formatPrice(ticket.pair, ticket.entryPrice)}</dd></div>
        <div><dt>Stop</dt><dd>{formatPrice(ticket.pair, ticket.stopPrice)}{metrics.stopPips !== undefined && <small>{metrics.stopPips} pips</small>}</dd></div>
        <div><dt>Target</dt><dd>{formatPrice(ticket.pair, ticket.targetPrice)}{metrics.targetPips !== undefined && <small>{metrics.targetPips} pips</small>}</dd></div>
        <div><dt>Net R:R</dt><dd>{metrics.netRewardToRisk !== undefined ? `${metrics.netRewardToRisk}:1` : '—'}{metrics.costPips !== undefined && <small>{metrics.costPips} pips costs</small>}</dd></div>
        <div><dt>Probability</dt><dd>{metrics.probability !== undefined ? `${metrics.probability}%` : `${decision.inputs?.probability ?? '—'}%`}{metrics.requiredProbability !== undefined && <small>needs {metrics.requiredProbability}%</small>}</dd></div>
        <div><dt>Max quantity</dt><dd>{formatUnits(ticket.authorizedQuantity || ticket.draftedQuantity)}{metrics.bindingLimit && <small>by {LIMIT_LABELS[metrics.bindingLimit] ?? metrics.bindingLimit}</small>}</dd></div>
        <div><dt>Max loss</dt><dd>{formatMoney(ticket.riskAmount, currency)}{draft?.riskPct !== undefined && !ticket.authorizedQuantity && <small>{draft.riskPct}% of equity</small>}</dd></div>
      </dl>
      <p className="itrade-uncalibrated"><AlertTriangle size={12} /> Probability is your own estimate — NOT YET CALIBRATED. The system has no historical data to verify it.</p>

      <ol className="itrade-gates">
        {decision.gates.map((gate) => (
          <li key={gate.id} className={gate.status}>
            <GateIcon status={gate.status} />
            <div><strong>{gate.id} · {gate.name}</strong><span>{gate.detail}</span></div>
          </li>
        ))}
      </ol>

      {isDraft && (
        <div className="itrade-authorize">
          {external && <p className="itrade-external-warning"><AlertTriangle size={14} /> EXTERNAL BROKER — SYSTEM CANNOT VERIFY OR ENFORCE EXECUTION. Enter the entry, stop and target together as a bracket order in your broker.</p>}
          <div className="itrade-authorize-row">
            <label>Quantity (you may reduce, not increase)
              <input type="number" min="1000" step="1000" max={ticket.draftedQuantity} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <div className="itrade-authorize-risk">
              <span>Loss at stop</span>
              <strong>{riskForQuantity !== null ? formatMoney(riskForQuantity, currency) : 'Invalid quantity'}</strong>
            </div>
            <div className={`itrade-countdown ${secondsLeft < 30 ? 'urgent' : ''}`}>
              <span>Expires in</span>
              <strong>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</strong>
            </div>
          </div>
          <div className="itrade-authorize-actions">
            <button type="button" className="itrade-approve" disabled={busy || !quantityValid} onClick={() => onAuthorize(ticket, quantityNumber)}>
              <ShieldCheck size={15} /> {external ? 'Accept for manual entry' : `Authorize paper ${ticket.side.toUpperCase()}`}
            </button>
            <button type="button" className="itrade-decline" disabled={busy} onClick={() => onDecline(ticket)}>Decline</button>
          </div>
          <small className="itrade-mode-note">{mode === 'paper' ? 'Paper only — no order is sent to any broker.' : 'Nothing is sent to your broker. You place the trade yourself.'}</small>
        </div>
      )}
      {ticket.status === 'drafted' && secondsLeft === 0 && <p className="itrade-expired-note">This draft has expired. Draft a fresh ticket with current prices.</p>}
    </article>
  )
}

function PositionRow({ ticket, currency, busy, onClose, onReport }) {
  const [exitPrice, setExitPrice] = useState('')
  const [fillPrice, setFillPrice] = useState('')
  const [fillQuantity, setFillQuantity] = useState('')
  const awaitingFill = ticket.status === 'accepted_manual' && ticket.fillPrice === null
  return (
    <article className="itrade-position">
      <div className="itrade-position-head">
        <strong>{ticket.pair} <span className={`itrade-side ${ticket.side}`}>{ticket.side.toUpperCase()}</span></strong>
        <span className={`itrade-mode-badge ${ticket.operatingMode}`}>{MODE_LABELS[ticket.operatingMode]}</span>
      </div>
      <dl className="itrade-position-terms">
        <div><dt>Quantity</dt><dd>{formatUnits(ticket.authorizedQuantity)}</dd></div>
        <div><dt>{awaitingFill ? 'Planned entry' : 'Fill'}</dt><dd>{formatPrice(ticket.pair, ticket.fillPrice ?? ticket.entryPrice)}</dd></div>
        <div><dt>Stop</dt><dd>{formatPrice(ticket.pair, ticket.stopPrice)}</dd></div>
        <div><dt>Target</dt><dd>{formatPrice(ticket.pair, ticket.targetPrice)}</dd></div>
        <div><dt>Max loss</dt><dd>{formatMoney(ticket.riskAmount, currency)}</dd></div>
        <div><dt>Source</dt><dd>{ticket.executionSource === 'USER_REPORTED' ? 'User-reported' : 'Paper ledger'}</dd></div>
      </dl>
      {awaitingFill ? (
        <div className="itrade-position-actions">
          <input type="number" step="any" placeholder="Fill price" value={fillPrice} onChange={(event) => setFillPrice(event.target.value)} />
          <input type="number" step="1" placeholder={`Qty (≤ ${ticket.authorizedQuantity})`} value={fillQuantity} onChange={(event) => setFillQuantity(event.target.value)} />
          <button type="button" disabled={busy || !fillPrice} onClick={() => onReport(ticket, { result: 'filled', fillPrice, quantity: fillQuantity })}>Mark filled</button>
          <button type="button" disabled={busy} onClick={() => onReport(ticket, { result: 'not_filled' })}>Not filled</button>
          <button type="button" disabled={busy} onClick={() => onReport(ticket, { result: 'cancelled' })}>Cancelled</button>
        </div>
      ) : (
        <div className="itrade-position-actions">
          <button type="button" disabled={busy} onClick={() => setExitPrice(String(ticket.targetPrice))}>Target hit</button>
          <button type="button" disabled={busy} onClick={() => setExitPrice(String(ticket.stopPrice))}>Stop hit</button>
          <input type="number" step="any" placeholder="Exit price" value={exitPrice} onChange={(event) => setExitPrice(event.target.value)} />
          <button type="button" className="itrade-close-button" disabled={busy || !exitPrice} onClick={() => onClose(ticket, exitPrice)}>Close at {exitPrice || '…'}</button>
        </div>
      )}
      {ticket.operatingMode === 'external_manual' && <small className="itrade-mode-note">The system cannot close or modify a trade in your external broker. Record what actually happened.</small>}
    </article>
  )
}

export default function ITradePage() {
  const [overview, setOverview] = useState(null)
  const [section, setSection] = useState('desk')
  const [ticketDraft, setTicketDraft] = useState(initialTicket)
  const [profileDraft, setProfileDraft] = useState(initialProfile)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [activeTicketId, setActiveTicketId] = useState('')
  const [clockOffset, setClockOffset] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const next = await getTradingOverview()
      setOverview(next)
      setClockOffset(new Date(next.serverTime).getTime() - Date.now())
      setError('')
      return next
    } catch (loadError) {
      setError(loadError.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load().then((next) => {
      if (!next) return
      if (next.profile) {
        setProfileDraft(profileToForm(next.profile.settings))
        setProfileLoaded(true)
      } else {
        setSection('profile')
      }
    })
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 15000)
    return () => window.clearInterval(poll)
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 1000)
    return () => window.clearInterval(timer)
  }, [clockOffset])

  const profile = overview?.profile?.settings
  const account = overview?.account
  const system = overview?.system
  const currency = profile?.account_currency || profileDraft.accountCurrency
  const tickets = useMemo(() => overview?.tickets ?? [], [overview])
  const activeTicket = tickets.find((ticket) => ticket.id === activeTicketId) || tickets.find((ticket) => ticket.status === 'drafted')
  const openPositions = tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'accepted_manual')
  const history = tickets.filter((ticket) => !['open', 'accepted_manual'].includes(ticket.status))
  const locks = account?.locks ?? []

  const preview = useMemo(() => {
    const entry = Number(ticketDraft.entryPrice)
    const stop = Number(ticketDraft.stopPrice)
    const target = Number(ticketDraft.targetPrice)
    if (!entry || !stop || !target) return null
    const size = pipSize(ticketDraft.pair)
    const stopPips = Math.round((Math.abs(entry - stop) / size) * 10) / 10
    const targetPips = Math.round((Math.abs(target - entry) / size) * 10) / 10
    return { stopPips, targetPips, ratio: stopPips ? (targetPips / stopPips).toFixed(2) : '—' }
  }, [ticketDraft.entryPrice, ticketDraft.stopPrice, ticketDraft.targetPrice, ticketDraft.pair])

  const [base, quote] = ticketDraft.pair.split('/')
  const needsConversion = currency !== base && currency !== quote

  function updateTicket(field, value) {
    setTicketDraft((current) => ({ ...current, [field]: value }))
  }

  function updateProfile(field, value) {
    setProfileDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === 'riskTolerance') Object.assign(next, TOLERANCE_PRESETS[value])
      if (field === 'riskTolerance' || field === 'capital' || field === 'maxRiskPerIdeaPct') {
        const capital = Number(next.capital) || 0
        next.maxRiskPerIdea = String(Math.round(capital * Number(next.maxRiskPerIdeaPct)) / 100)
      }
      return next
    })
  }

  function mergeTicket(ticket) {
    setOverview((current) => current && ({
      ...current,
      tickets: [ticket, ...current.tickets.filter((item) => item.id !== ticket.id)],
    }))
  }

  async function run(action, success) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await action()
      if (success) setNotice(typeof success === 'function' ? success(result) : success)
      await load()
      return result
    } catch (actionError) {
      setError(actionError.message)
      await load()
      return null
    } finally {
      setBusy(false)
    }
  }

  async function submitTicket(event) {
    event.preventDefault()
    const result = await run(() => draftTradingTicket(ticketDraft))
    if (result?.ticket) {
      mergeTicket(result.ticket)
      setActiveTicketId(result.ticket.id)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  async function submitProfile(event) {
    event.preventDefault()
    const result = await run(() => saveTradingProfile(profileDraft), (saved) => (
      saved.riskIncrease
        ? `Saved as version ${saved.profile.version}. Because it increases risk, it takes effect after a ${saved.coolingPeriodHours}-hour cooling period.`
        : `Risk profile version ${saved.profile.version} is active.`
    ))
    if (result) {
      setProfileLoaded(true)
      setProfileDraft((current) => ({ ...current, acknowledgeRisk: false, acknowledgeManualExecution: false, acknowledgeExternalUnverified: false }))
      if (!result.riskIncrease) setSection('desk')
    }
  }

  const authorize = (ticket, quantity) => run(
    () => authorizeTradingTicket(ticket.id, ticket.idempotencyKey, quantity),
    (result) => (result.alreadyAuthorized ? 'This ticket was already authorized — nothing was duplicated.' : ticket.operatingMode === 'paper' ? 'Paper position opened.' : 'Accepted for manual entry. Report the fill once your broker confirms it.'),
  )
  const decline = (ticket) => run(() => declineTradingTicket(ticket.id), 'Ticket declined.')
  const closePosition = (ticket, exitPrice) => run(() => closeTradingTicket(ticket.id, exitPrice), (result) => `Closed. Realized ${formatMoney(result.ticket.realizedPnl, currency)}.`)
  const report = (ticket, values) => run(() => reportExternalTicket(ticket.id, values), 'Recorded as user-reported.')

  if (loading) {
    return <div className="app-content-width itrade-page"><AppPageHeader eyebrow="ICONNECT TRADE · PAPER DESK" title="iTrade" /><p className="itrade-muted">Loading the trading desk…</p></div>
  }

  return (
    <div className="app-content-width itrade-page">
      <AppPageHeader
        eyebrow="ICONNECT TRADE · PAPER DESK"
        title="iTrade"
        description="Draft protected FX tickets against your saved risk profile. Every order needs your manual authorization, and nothing is sent to a broker."
      />

      <section className="itrade-status-strip" aria-label="Trading status">
        <span className={`itrade-mode-badge large ${profile?.operating_mode || 'paper'}`}>{MODE_LABELS[profile?.operating_mode || 'paper']}</span>
        <span><LockKeyhole size={13} /> Order transmission: <b>disabled</b></span>
        <span><Gauge size={13} /> Probability: <b>not yet calibrated</b></span>
        <span><RadioTower size={13} /> Live feeds: <b>{system?.feeds.filter((feed) => feed.state !== 'DISCONNECTED').length ?? 0} of {system?.feeds.length ?? 0} connected</b></span>
        <span className="itrade-server-time">Server {new Date(now).toLocaleTimeString([], { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC</span>
      </section>

      {locks.map((lock) => (
        <p key={lock.id} className="itrade-lock-banner" role="alert"><LockKeyhole size={15} /><span><b>{lock.label}.</b> {lock.detail}</span></p>
      ))}
      {overview?.pendingProfile && (
        <p className="itrade-pending-banner"><History size={14} /> Profile version {overview.pendingProfile.version} increases risk and takes effect {formatTime(overview.pendingProfile.effectiveFrom)}. Saving a new version replaces it.</p>
      )}
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}

      <nav className="itrade-tabs" aria-label="iTrade sections">
        <button type="button" className={section === 'desk' ? 'active' : ''} onClick={() => setSection('desk')} disabled={!profile}><Activity size={15} /> Desk</button>
        <button type="button" className={section === 'positions' ? 'active' : ''} onClick={() => setSection('positions')} disabled={!profile}><ClipboardList size={15} /> Positions{openPositions.length ? ` (${openPositions.length})` : ''}</button>
        <button type="button" className={section === 'profile' ? 'active' : ''} onClick={() => setSection('profile')}><SlidersHorizontal size={15} /> Risk profile</button>
        <button type="button" className={section === 'system' ? 'active' : ''} onClick={() => setSection('system')}><RadioTower size={15} /> System</button>
      </nav>

      {section === 'desk' && profile && (
        <div className="itrade-desk">
          <form className="itrade-panel itrade-ticket-form" onSubmit={submitTicket}>
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">NEW TICKET</span><h2>Describe the setup</h2><p>The server runs all eight gates in order and drafts the quantity from your profile.</p></div>
            <div className="itrade-field-row">
              <label>Pair<select value={ticketDraft.pair} onChange={(event) => updateTicket('pair', event.target.value)}>{PAIR_NAMES.map((pair) => <option key={pair} disabled={!profile.permitted_pairs.includes(pair)}>{pair}</option>)}</select></label>
              <div className="itrade-side-toggle" role="group" aria-label="Direction">
                <button type="button" className={ticketDraft.side === 'buy' ? 'active buy' : ''} onClick={() => updateTicket('side', 'buy')}>BUY</button>
                <button type="button" className={ticketDraft.side === 'sell' ? 'active sell' : ''} onClick={() => updateTicket('side', 'sell')}>SELL</button>
              </div>
            </div>
            <div className="itrade-field-row three">
              <label>Entry (executable side)<input type="number" step="any" required value={ticketDraft.entryPrice} onChange={(event) => updateTicket('entryPrice', event.target.value)} /></label>
              <label>Protective stop<input type="number" step="any" required value={ticketDraft.stopPrice} onChange={(event) => updateTicket('stopPrice', event.target.value)} /></label>
              <label>Target<input type="number" step="any" required value={ticketDraft.targetPrice} onChange={(event) => updateTicket('targetPrice', event.target.value)} /></label>
            </div>
            {preview && <p className={`itrade-preview ${preview.stopPips > 20 || preview.stopPips < 15 ? 'warn' : ''}`}>Stop {preview.stopPips} pips · target {preview.targetPips} pips · gross {preview.ratio}:1 <small>(stop must be 15–20 pips; target at least 2× stop after costs)</small></p>}
            <div className="itrade-field-row four">
              <label>Spread (pips)<input type="number" step="0.1" min="0" required value={ticketDraft.spreadPips} onChange={(event) => updateTicket('spreadPips', event.target.value)} /></label>
              <label>Slippage (pips)<input type="number" step="0.1" min="0" value={ticketDraft.slippagePips} onChange={(event) => updateTicket('slippagePips', event.target.value)} /></label>
              <label>Commission / 100k ({currency})<input type="number" step="0.01" min="0" value={ticketDraft.commissionPer100k} onChange={(event) => updateTicket('commissionPer100k', event.target.value)} /></label>
              <label>Gap allowance (pips)<input type="number" step="0.1" min="0" value={ticketDraft.gapAllowancePips} onChange={(event) => updateTicket('gapAllowancePips', event.target.value)} /></label>
            </div>
            {needsConversion && <label>{quote}→{currency} rate (1 {quote} = ? {currency})<input type="number" step="any" min="0" required value={ticketDraft.quoteToAccountRate} onChange={(event) => updateTicket('quoteToAccountRate', event.target.value)} /><small>Needed to value a pip in your account currency. It is never assumed.</small></label>}
            <div className="itrade-field-row">
              <label>Your probability estimate (%)<input type="number" min="0" max="100" step="1" required value={ticketDraft.probability} onChange={(event) => updateTicket('probability', event.target.value)} /><small>Your profile requires at least {profile.min_probability}% (+1 per pip of stop above 15).</small></label>
              <label>Release state<select value={ticketDraft.releaseState} onChange={(event) => updateTicket('releaseState', event.target.value)}>{(system?.config.releaseStates ?? []).map((state) => <option key={state} value={state}>{state.replaceAll('_', ' ')}</option>)}</select></label>
            </div>
            <label>One-line reason<input maxLength="200" required value={ticketDraft.rationale} onChange={(event) => updateTicket('rationale', event.target.value)} placeholder="e.g. US CPI beat; 2-year yields and USD crosses confirm" /></label>
            <label>Event (optional)<input maxLength="120" value={ticketDraft.eventLabel} onChange={(event) => updateTicket('eventLabel', event.target.value)} placeholder="e.g. US CPI, 15:30 Jerusalem" /></label>
            <label className="itrade-check"><input type="checkbox" checked={ticketDraft.dataChecked} onChange={(event) => updateTicket('dataChecked', event.target.checked)} /> I checked current prices and breaking news myself (live feeds are not connected).</label>
            <label className="itrade-check"><input type="checkbox" checked={ticketDraft.microstructureUsable} onChange={(event) => updateTicket('microstructureUsable', event.target.checked)} /> The order book is stable and liquid — the post-release spike is over.</label>
            <button type="submit" className="app-primary-button" disabled={busy}>{busy ? 'Checking…' : 'Run gates and draft ticket'}</button>
          </form>

          <div className="itrade-desk-side">
            {activeTicket ? (
              <DecisionCard ticket={activeTicket} currency={currency} mode={profile.operating_mode} now={now} busy={busy} onAuthorize={authorize} onDecline={decline} />
            ) : (
              <article className="itrade-panel itrade-empty"><ShieldCheck size={22} /><h3>No ticket yet</h3><p>Describe a setup to see which gates pass. NO TRADE and WAIT are normal, successful outcomes when a setup is unclear.</p></article>
            )}
            {account && (
              <article className="itrade-panel itrade-account">
                <span className="app-page-eyebrow">ACCOUNT · {account.equitySource === 'PAPER_LEDGER' ? 'PAPER LEDGER' : 'USER-REPORTED'}</span>
                <dl>
                  <div><dt>Equity</dt><dd>{formatMoney(account.equity, currency)}</dd></div>
                  <div><dt>Today</dt><dd className={account.todayPnl < 0 ? 'neg' : ''}>{formatMoney(account.todayPnl, currency)}</dd></div>
                  <div><dt>This week</dt><dd className={account.weekPnl < 0 ? 'neg' : ''}>{formatMoney(account.weekPnl, currency)}</dd></div>
                  <div><dt>Losses today</dt><dd>{account.lossesToday} / 2</dd></div>
                  <div><dt>Open ideas</dt><dd>{account.openIdeas} / {profile.max_open_ideas}</dd></div>
                  <div><dt>Correlated cap</dt><dd>{formatMoney(account.correlatedCap, currency)}</dd></div>
                </dl>
              </article>
            )}
          </div>
        </div>
      )}

      {section === 'positions' && profile && (
        <div className="itrade-positions-layout">
          <section className="itrade-panel">
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">OPEN</span><h2>Positions</h2></div>
            {openPositions.length ? openPositions.map((ticket) => (
              <PositionRow key={ticket.id} ticket={ticket} currency={currency} busy={busy} onClose={closePosition} onReport={report} />
            )) : <p className="itrade-muted">No open positions.</p>}
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">CURRENCY EXPOSURE</span><h3>Risk at stop by currency and direction</h3></div>
            <table className="itrade-table">
              <thead><tr><th>Currency</th><th>Long</th><th>Short</th></tr></thead>
              <tbody>{['USD', 'EUR', 'GBP', 'JPY', 'CAD'].map((code) => (
                <tr key={code}><td>{code}</td><td>{formatMoney(account?.exposure?.[code]?.long ?? 0, currency)}</td><td>{formatMoney(account?.exposure?.[code]?.short ?? 0, currency)}</td></tr>
              ))}</tbody>
            </table>
          </section>
          <section className="itrade-panel">
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">HISTORY</span><h2>Recent decisions</h2><p>Every decision is kept, including NO TRADE.</p></div>
            <div className="itrade-history">
              {history.length ? history.map((ticket) => (
                <button type="button" key={ticket.id} onClick={() => { setActiveTicketId(ticket.id); setSection('desk') }}>
                  <span><b>{ticket.pair}</b> {ticket.side.toUpperCase()}</span>
                  <span>{STATUS_LABELS[ticket.status]}</span>
                  <span className={ticket.realizedPnl < 0 ? 'neg' : ''}>{ticket.realizedPnl !== null ? formatMoney(ticket.realizedPnl, currency) : ticket.decision.reason?.split(' — ')[1] ?? ''}</span>
                  <small>{formatTime(ticket.createdAt)}</small>
                </button>
              )) : <p className="itrade-muted">No decisions yet.</p>}
            </div>
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">AUDIT</span><h3>Your recent actions</h3></div>
            <ul className="itrade-audit">
              {(overview?.audit ?? []).map((event, index) => (
                <li key={`${event.createdAt}-${index}`}><span>{AUDIT_LABELS[event.action] ?? event.action}</span><small>{formatTime(event.createdAt)}</small></li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {section === 'profile' && (
        <form className="itrade-panel itrade-profile-form" onSubmit={submitProfile}>
          <div className="itrade-panel-heading">
            <span className="app-page-eyebrow">{profileLoaded ? `RISK MANDATE · VERSION ${overview?.profile?.version ?? ''}` : 'STEP 1 · SET UP YOUR RISK MANDATE'}</span>
            <h2>Risk profile</h2>
            <p>The desk drafts every ticket from these limits. You can always reduce or decline a draft, but never increase it. Changes that increase risk wait {system?.config.coolingPeriodHours ?? 24} hours; reductions apply immediately.</p>
          </div>
          <fieldset className="itrade-mode-choice">
            <legend>How will you trade?</legend>
            <label className={profileDraft.operatingMode === 'paper' ? 'active' : ''}><input type="radio" name="mode" checked={profileDraft.operatingMode === 'paper'} onChange={() => updateProfile('operatingMode', 'paper')} /><b>Paper</b><span>The desk keeps a simulated ledger. No real money.</span></label>
            <label className={profileDraft.operatingMode === 'external_manual' ? 'active' : ''}><input type="radio" name="mode" checked={profileDraft.operatingMode === 'external_manual'} onChange={() => updateProfile('operatingMode', 'external_manual')} /><b>External manual</b><span>You type the drafted trade into your own broker and report what happened.</span></label>
            <label className="disabled"><input type="radio" disabled /><b>Linked broker</b><span>Not available — no broker is connected.</span></label>
          </fieldset>
          <div className="itrade-field-row">
            <label>Account currency<select value={profileDraft.accountCurrency} onChange={(event) => updateProfile('accountCurrency', event.target.value)}>{['USD', 'EUR', 'GBP', 'JPY', 'CAD'].map((code) => <option key={code}>{code}</option>)}</select></label>
            <label>{profileDraft.operatingMode === 'paper' ? 'Paper starting capital' : 'Current broker equity'}<input type="number" min="1" step="any" required value={profileDraft.capital} onChange={(event) => updateProfile('capital', event.target.value)} /></label>
          </div>
          <fieldset className="itrade-tolerance">
            <legend>Risk tolerance</legend>
            {(system?.config.riskTolerances ?? []).map((tolerance) => (
              <label key={tolerance.id} className={profileDraft.riskTolerance === tolerance.id ? 'active' : ''}>
                <input type="radio" name="tolerance" checked={profileDraft.riskTolerance === tolerance.id} onChange={() => updateProfile('riskTolerance', tolerance.id)} />
                <b>{tolerance.label}</b><span>≥ {tolerance.min_probability}% · ≤ {tolerance.max_risk_pct}% per idea</span>
              </label>
            ))}
          </fieldset>
          <div className="itrade-field-row three">
            <label>Minimum probability (%)<input type="number" min={TOLERANCE_PRESETS[profileDraft.riskTolerance].minProbability} max="95" step="1" required value={profileDraft.minProbability} onChange={(event) => updateProfile('minProbability', event.target.value)} /></label>
            <label>Max risk per idea (%)<input type="number" min="0.01" max={TOLERANCE_PRESETS[profileDraft.riskTolerance].maxRiskPerIdeaPct} step="0.01" required value={profileDraft.maxRiskPerIdeaPct} onChange={(event) => updateProfile('maxRiskPerIdeaPct', event.target.value)} /></label>
            <label>Max risk per idea ({profileDraft.accountCurrency})<input type="number" min="0.01" step="any" required value={profileDraft.maxRiskPerIdea} onChange={(event) => updateProfile('maxRiskPerIdea', event.target.value)} /></label>
          </div>
          <div className="itrade-field-row three">
            <label>15-pip reference quantity (units)<input type="number" min="1000" step="1000" required value={profileDraft.referenceQuantity} onChange={(event) => updateProfile('referenceQuantity', event.target.value)} /></label>
            <label>Absolute max quantity (units)<input type="number" min="1000" max="1000000" step="1000" required value={profileDraft.maxQuantity} onChange={(event) => updateProfile('maxQuantity', event.target.value)} /></label>
            <label>Max open ideas<input type="number" min="1" max="5" step="1" required value={profileDraft.maxOpenIdeas} onChange={(event) => updateProfile('maxOpenIdeas', event.target.value)} /></label>
          </div>
          <div className="itrade-field-row three">
            <label>Correlated currency cap (%)<input type="number" min="0.01" max="4" step="0.01" required value={profileDraft.maxCorrelatedRiskPct} onChange={(event) => updateProfile('maxCorrelatedRiskPct', event.target.value)} /></label>
            <label>Daily loss halt (%)<input type="number" min="0.01" max="5" step="0.01" required value={profileDraft.dailyLossLimitPct} onChange={(event) => updateProfile('dailyLossLimitPct', event.target.value)} /></label>
            <label>Weekly loss halt (%)<input type="number" min="0.01" max="10" step="0.01" required value={profileDraft.weeklyLossLimitPct} onChange={(event) => updateProfile('weeklyLossLimitPct', event.target.value)} /></label>
          </div>
          <fieldset className="itrade-pairs">
            <legend>Permitted pairs</legend>
            {PAIR_NAMES.map((pair) => (
              <label key={pair}><input type="checkbox" checked={profileDraft.permittedPairs.includes(pair)} onChange={(event) => updateProfile('permittedPairs', event.target.checked ? [...profileDraft.permittedPairs, pair] : profileDraft.permittedPairs.filter((item) => item !== pair))} />{pair}</label>
            ))}
          </fieldset>
          <label className="itrade-check"><input type="checkbox" checked={profileDraft.acknowledgeRisk} onChange={(event) => updateProfile('acknowledgeRisk', event.target.checked)} /> I understand trading can lose money, the probability shown is my own uncalibrated estimate, and this desk promises no profit.</label>
          <label className="itrade-check"><input type="checkbox" checked={profileDraft.acknowledgeManualExecution} onChange={(event) => updateProfile('acknowledgeManualExecution', event.target.checked)} /> I understand every trade requires my manual authorization and this cannot be turned off.</label>
          {profileDraft.operatingMode === 'external_manual' && <label className="itrade-check"><input type="checkbox" checked={profileDraft.acknowledgeExternalUnverified} onChange={(event) => updateProfile('acknowledgeExternalUnverified', event.target.checked)} /> I understand the system cannot verify or enforce anything in my external broker, and loss locks cannot stop me trading there independently.</label>}
          <button type="submit" className="app-primary-button" disabled={busy || !profileDraft.permittedPairs.length}>{busy ? 'Saving…' : profileLoaded ? 'Save new version' : 'Confirm risk profile'}</button>
        </form>
      )}

      {section === 'system' && system && (
        <div className="itrade-system">
          <section className="itrade-panel">
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">DATA QUALITY</span><h2>Feed health</h2><p>Critical feeds being disconnected is why tickets rely on your own price and news check.</p></div>
            <ul className="itrade-feeds">{system.feeds.map((feed) => <li key={feed.id}><span>{feed.name}</span><b className={feed.state.toLowerCase()}>{feed.state}</b></li>)}</ul>
          </section>
          <section className="itrade-panel">
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">BUILD STAGE</span><h2>Where iTrade is</h2></div>
            <ol className="itrade-stages">
              {[
                ['Risk engine & paper desk', 'Hard gates, drafting, locks, audit — you are here', true],
                ['Data collection', 'Benzinga, IBKR, CME and calendar adapters — no orders'],
                ['Historical replay', 'Point-in-time event library and calibration'],
                ['Live shadow', 'System-generated decisions, still no orders'],
                ['IBKR paper trading', 'Simulated execution through the broker'],
                ['Micro-live', 'Tiny real trades to find glitches, manual only'],
              ].map(([title, detail, current]) => <li key={title} className={current ? 'current' : ''}><b>{title}</b><span>{detail}</span></li>)}
            </ol>
          </section>
          <section className="itrade-panel">
            <div className="itrade-panel-heading"><span className="app-page-eyebrow">FIXED RULES</span><h2>Hard gates</h2></div>
            <ul className="itrade-rules">
              <li>Protective stop {system.config.stopMinPips}–{system.config.stopMaxPips} pips. Above 20 is always NO TRADE.</li>
              <li>Net reward-to-risk at least {system.config.minNetRewardToRisk.toFixed(2)}:1 after spread, slippage, commission and gap allowance.</li>
              <li>+1 percentage point required probability for each full pip of stop above 15; size cut to 15 ÷ stop of your reference quantity.</li>
              <li>No ticket from SCHEDULED or HEADLINE ONLY. Drafts expire after {system.config.ticketTtlSeconds} seconds.</li>
              <li>Two losing trades in a session lock new drafts until the next session.</li>
            </ul>
            <table className="itrade-table">
              <thead><tr><th>Pair</th><th>Pip</th><th>Max spread</th></tr></thead>
              <tbody>{system.config.pairs.map((pair) => <tr key={pair.pair}><td>{pair.pair}</td><td>{pair.pipSize}</td><td>{pair.maxSpreadPips} pips</td></tr>)}</tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  )
}
