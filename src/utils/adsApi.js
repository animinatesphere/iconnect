import { apiRequest } from './api.js'

export function getAdPackages() {
  return apiRequest('/api/ads/packages')
}

export function getMyAds() {
  return apiRequest('/api/ads/mine').then((payload) => payload.campaigns)
}

export function createAdCampaign(ad) {
  return apiRequest('/api/ads/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      package_id: ad.packageId,
      title: ad.title,
      body: ad.body,
      image_url: ad.imageUrl || null,
      link_url: ad.linkUrl || null,
      cta_label: ad.ctaLabel || 'Learn more',
    }),
  })
}

export function cancelAdCampaign(campaignId) {
  return apiRequest(`/api/ads/campaigns/${encodeURIComponent(campaignId)}/cancel`, { method: 'POST' })
}

export function getFeedAds(limit = 2) {
  return apiRequest(`/api/ads/feed?limit=${limit}`).then((payload) => payload.ads)
}

export function recordAdClick(adId) {
  return apiRequest(`/api/ads/${encodeURIComponent(adId)}/click`, { method: 'POST' })
}

export function getAdminAds() {
  return apiRequest('/api/admin/ads')
}

export function saveAdminAdPackage(pkg) {
  const body = {
    name: pkg.name,
    description: pkg.description || '',
    duration_days: Number(pkg.durationDays),
    currency: pkg.currency,
    amount_minor: Math.round(Number(pkg.amount) * 100),
    country_codes: pkg.countryCodes ?? [],
    active: pkg.active,
  }
  return apiRequest(pkg.id ? `/api/admin/ads/packages/${encodeURIComponent(pkg.id)}` : '/api/admin/ads/packages', {
    method: pkg.id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  })
}

export function reviewAdminAd(campaignId, decision, note) {
  return apiRequest(`/api/admin/ads/campaigns/${encodeURIComponent(campaignId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, note: note || '' }),
  })
}
