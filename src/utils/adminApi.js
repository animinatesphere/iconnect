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

export async function adminLogout() {
  return apiRequest('/api/auth/logout', { method: 'POST' })
}
