import { apiRequest } from './api.js'

export async function adminLogin(email, password) {
  return apiRequest('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function getAdminSession(options = {}) {
  return apiRequest('/api/admin/me', options)
}

export async function getAdminOverview() {
  const payload = await apiRequest('/api/admin/overview')
  return payload.overview
}

export async function getAdminUsers({ query = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (query.trim()) params.set('query', query.trim())
  return apiRequest(`/api/admin/users?${params}`)
}

export async function getAdminUserDetails(userId, { limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const payload = await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}?${params}`)
  return payload.user
}

export async function updateAdminUserPost(postId, { text, imageUrls }) {
  const payload = await apiRequest(`/api/admin/posts/${encodeURIComponent(postId)}`, {
    method: 'PUT',
    body: JSON.stringify({ text, image_urls: imageUrls }),
  })
  return payload.post
}

export async function setAdminUserSuspended(userId, suspended) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
    method: 'POST',
    body: JSON.stringify({ suspended }),
  })
}

export async function getAdminAuditLog(limit = 100) {
  const payload = await apiRequest(`/api/admin/audit-log?limit=${limit}`)
  return payload.events
}

export async function getAdminContent(type, { query = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ type, limit: String(limit), offset: String(offset) })
  if (query.trim()) params.set('query', query.trim())
  return apiRequest(`/api/admin/content?${params}`)
}

export async function deleteAdminContent(type, id) {
  return apiRequest(`/api/admin/content/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function updateAdminProduct(productId, product) {
  return apiRequest(`/api/admin/products/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: product.name,
      category: product.category,
      price: Number(product.price),
      stock: Number(product.stock),
      description: product.description,
      image_urls: product.imageUrls ?? [],
      published: product.published,
    }),
  })
}

export async function createAdminProduct(product) {
  const payload = await apiRequest('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      name: product.name,
      category: product.category,
      price: Number(product.price),
      stock: Number(product.stock),
      description: product.description,
      image_urls: product.imageUrls ?? [],
      published: product.published ?? true,
    }),
  })
  return payload.product
}

export async function createAdminPost(post) {
  const payload = await apiRequest('/api/admin/posts', {
    method: 'POST',
    body: JSON.stringify({
      text: post.text,
      image_urls: post.imageUrls ?? [],
    }),
  })
  return payload.post
}

export async function createAdminJob(job) {
  const payload = await apiRequest('/api/admin/jobs', {
    method: 'POST',
    body: JSON.stringify(job),
  })
  return payload.job
}

export async function createAdminLocalListing(listing) {
  const payload = await apiRequest('/api/admin/local-listings', {
    method: 'POST',
    body: JSON.stringify({
      category: listing.category,
      title: listing.title,
      price: listing.price,
      location: listing.location,
      detail: listing.detail,
      description: listing.description,
      image_url: listing.imageUrl || null,
    }),
  })
  return payload.listing
}

export async function getAdminSubadmins() {
  return apiRequest('/api/admin/subadmins')
}

export async function createAdminSubadmin(email) {
  return apiRequest('/api/admin/subadmins', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function revokeAdminSubadmin(userId) {
  return apiRequest(`/api/admin/subadmins/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export async function getAdminMonetization() {
  return apiRequest('/api/admin/monetization')
}

export async function saveAdminSubscriptionPlan(plan) {
  const body = {
    name: plan.name,
    currency: plan.currency,
    amount_minor: Number(plan.amountMinor),
    jobs_limit: Number(plan.postingLimits.jobs),
    products_limit: Number(plan.postingLimits.products),
    marketplace_limit: Number(plan.postingLimits.marketplace),
    videos_limit: Number(plan.postingLimits.videos),
    active: plan.active,
  }
  const path = plan.id
    ? `/api/admin/monetization/plans/${encodeURIComponent(plan.id)}`
    : '/api/admin/monetization/plans'
  return apiRequest(path, {
    method: plan.id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  })
}

export async function saveAdminMonetizationSettings(settings) {
  return apiRequest('/api/admin/monetization/settings', {
    method: 'PUT',
    body: JSON.stringify({
      free_jobs_limit: Number(settings.freeMonthlyLimits.jobs),
      free_products_limit: Number(settings.freeMonthlyLimits.products),
      free_marketplace_limit: Number(settings.freeMonthlyLimits.marketplace),
      free_videos_limit: Number(settings.freeMonthlyLimits.videos),
      free_daily_dating_likes: Number(settings.freeDailyDatingLikes),
      marketplace_commission_bps: Math.round(Number(settings.marketplaceCommissionPercent) * 100),
    }),
  })
}

export async function saveAdminDatingProduct(product) {
  return apiRequest(`/api/admin/monetization/dating-products/${encodeURIComponent(product.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: product.name,
      amount_minor: Number(product.amountMinor),
      quantity: Number(product.quantity),
      duration_hours: Number(product.durationHours),
      active: product.active,
    }),
  })
}

export async function adminLogout() {
  return apiRequest('/api/auth/logout', { method: 'POST' })
}
