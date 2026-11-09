import { apiRequest } from './api.js'

export function getTradingOverview() {
  return apiRequest('/api/trading/overview')
}

export function saveTradingProfile(profile) {
  return apiRequest('/api/trading/profile', {
    method: 'PUT',
    body: JSON.stringify({
      operating_mode: profile.operatingMode,
      account_currency: profile.accountCurrency,
      capital: Number(profile.capital),
      risk_tolerance: profile.riskTolerance,
      min_probability: Number(profile.minProbability),
      reference_quantity: Number(profile.referenceQuantity),
      max_quantity: Number(profile.maxQuantity),
      max_risk_per_idea: Number(profile.maxRiskPerIdea),
      max_risk_per_idea_pct: Number(profile.maxRiskPerIdeaPct),
      max_correlated_risk_pct: Number(profile.maxCorrelatedRiskPct),
      max_open_ideas: Number(profile.maxOpenIdeas),
      daily_loss_limit_pct: Number(profile.dailyLossLimitPct),
      weekly_loss_limit_pct: Number(profile.weeklyLossLimitPct),
      permitted_pairs: profile.permittedPairs,
      acknowledge_risk: profile.acknowledgeRisk,
      acknowledge_manual_execution: profile.acknowledgeManualExecution,
      acknowledge_external_unverified: profile.acknowledgeExternalUnverified,
    }),
  })
}

function optionalNumber(value) {
  return value === '' || value === null || value === undefined ? null : Number(value)
}

export function draftTradingTicket(ticket) {
  return apiRequest('/api/trading/tickets', {
    method: 'POST',
    body: JSON.stringify({
      pair: ticket.pair,
      side: ticket.side,
      entry_price: Number(ticket.entryPrice),
      stop_price: Number(ticket.stopPrice),
      target_price: Number(ticket.targetPrice),
      spread_pips: Number(ticket.spreadPips),
      slippage_pips: Number(ticket.slippagePips || 0),
      commission_per_100k: Number(ticket.commissionPer100k || 0),
      gap_allowance_pips: Number(ticket.gapAllowancePips || 0),
      probability: Number(ticket.probability),
      release_state: ticket.releaseState,
      microstructure_usable: ticket.microstructureUsable,
      data_checked: ticket.dataChecked,
      quote_to_account_rate: optionalNumber(ticket.quoteToAccountRate),
      rationale: ticket.rationale,
      event_label: ticket.eventLabel,
    }),
  })
}

export function authorizeTradingTicket(ticketId, idempotencyKey, quantity) {
  return apiRequest(`/api/trading/tickets/${encodeURIComponent(ticketId)}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: idempotencyKey, quantity: Number(quantity) }),
  })
}

export function declineTradingTicket(ticketId) {
  return apiRequest(`/api/trading/tickets/${encodeURIComponent(ticketId)}/decline`, { method: 'POST' })
}

export function reportExternalTicket(ticketId, report) {
  return apiRequest(`/api/trading/tickets/${encodeURIComponent(ticketId)}/report`, {
    method: 'POST',
    body: JSON.stringify({
      result: report.result,
      fill_price: optionalNumber(report.fillPrice),
      quantity: optionalNumber(report.quantity),
    }),
  })
}

export function closeTradingTicket(ticketId, exitPrice) {
  return apiRequest(`/api/trading/tickets/${encodeURIComponent(ticketId)}/close`, {
    method: 'POST',
    body: JSON.stringify({ exit_price: Number(exitPrice) }),
  })
}
