import { apiRequest } from './api.js'

export function getAjoPlans() {
  return apiRequest('/api/ajo/plans').then((payload) => payload.plans)
}

export function createAjoPlan(plan) {
  return apiRequest('/api/ajo/plans', {
    method: 'POST',
    body: JSON.stringify({
      name: plan.name,
      currency: plan.currency,
      target_amount_minor: Math.round(Number(plan.target) * 100),
      contribution_amount_minor: Math.round(Number(plan.contribution) * 100),
      frequency: plan.frequency,
      start_date: plan.startDate,
      target_date: plan.targetDate || null,
    }),
  }).then((payload) => payload.plan)
}

export function setAjoPlanStatus(planId, status) {
  return apiRequest(`/api/ajo/plans/${encodeURIComponent(planId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  }).then((payload) => payload.plan)
}

export function addAjoContribution(planId, contribution) {
  return apiRequest(`/api/ajo/plans/${encodeURIComponent(planId)}/contributions`, {
    method: 'POST',
    body: JSON.stringify({
      amount_minor: Math.round(Number(contribution.amount) * 100),
      contributed_on: contribution.date,
      note: contribution.note || '',
    }),
  }).then((payload) => payload.plan)
}

export function deleteAjoContribution(planId, contributionId) {
  return apiRequest(`/api/ajo/plans/${encodeURIComponent(planId)}/contributions/${encodeURIComponent(contributionId)}`, {
    method: 'DELETE',
  }).then((payload) => payload.plan)
}
