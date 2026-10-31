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

export async function getAdminAuditLog(limit = 100) {
  const payload = await apiRequest(`/api/admin/audit-log?limit=${limit}`)
  return payload.events
}

export async function adminLogout() {
  return apiRequest('/api/auth/logout', { method: 'POST' })
}
