import { apiRequest } from './api.js'

export async function getDatingProfile() {
  const { profile } = await apiRequest('/api/dating/profile')
  return profile
}

export async function saveDatingProfile(profile) {
  const { profile: savedProfile } = await apiRequest('/api/dating/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
  return savedProfile
}

export async function getDatingDiscovery() {
  const { profiles } = await apiRequest('/api/dating/discovery')
  return profiles
}

export async function swipeDatingProfile(userId, liked) {
  return apiRequest(`/api/dating/profiles/${userId}/swipe`, {
    method: 'POST',
    body: JSON.stringify({ liked }),
  })
}

export async function getDatingMatches() {
  const { matches } = await apiRequest('/api/dating/matches')
  return matches
}

export async function getDatingMessages(matchId) {
  const { messages } = await apiRequest(`/api/dating/matches/${matchId}/messages`)
  return messages
}

export async function sendDatingMessage(matchId, text) {
  const { message } = await apiRequest(`/api/dating/matches/${matchId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
  return message
}

export async function unmatchDatingUser(matchId) {
  return apiRequest(`/api/dating/matches/${matchId}`, { method: 'DELETE' })
}

export async function blockDatingUser(userId) {
  return apiRequest(`/api/dating/users/${userId}/block`, { method: 'POST' })
}

export async function reportDatingUser(userId, report) {
  return apiRequest(`/api/dating/users/${userId}/report`, {
    method: 'POST',
    body: JSON.stringify(report),
  })
}
