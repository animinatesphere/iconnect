import { apiRequest } from './api.js'

export function getBillingCatalog() {
  return apiRequest('/api/billing/catalog')
}

export function getMyBilling() {
  return apiRequest('/api/billing/me')
}

export function startBillingCheckout(item) {
  return apiRequest('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(item),
  })
}

export function confirmBillingPayment(reference) {
  return apiRequest('/api/billing/confirm', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  })
}

export function cancelBillingSubscription() {
  return apiRequest('/api/billing/subscription/cancel', { method: 'POST' })
}
