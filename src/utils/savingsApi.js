import { apiRequest } from './api.js'

export async function getSavingsPlans() {
  const { plans } = await apiRequest('/api/savings/plans')
  return plans
}

export async function createSavingsPlan(plan) {
  const { plan: createdPlan } = await apiRequest('/api/savings/plans', {
    method: 'POST',
    body: JSON.stringify(plan),
  })
  return createdPlan
}

export async function addSavingsContribution(planId, contribution) {
  const { contribution: createdContribution } = await apiRequest(`/api/savings/plans/${planId}/contributions`, {
    method: 'POST',
    body: JSON.stringify(contribution),
  })
  return createdContribution
}

export async function getSavingsContributions(planId) {
  const { contributions } = await apiRequest(`/api/savings/plans/${planId}/contributions`)
  return contributions
}

export async function setSavingsPlanActive(planId, active) {
  return apiRequest(`/api/savings/plans/${planId}/active?active=${active}`, { method: 'PUT' })
}

export async function deleteSavingsPlan(planId) {
  return apiRequest(`/api/savings/plans/${planId}`, { method: 'DELETE' })
}
