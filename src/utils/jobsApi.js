import { apiRequest } from './api.js'

export async function getJobs({ query = '', location = '', workplaceType = '', view = 'all' } = {}) {
  const params = new URLSearchParams()
  if (query.trim()) params.set('query', query.trim())
  if (location.trim()) params.set('location', location.trim())
  if (workplaceType) params.set('workplace_type', workplaceType)
  if (view !== 'all') params.set('view', view)
  const search = params.toString()
  const payload = await apiRequest(`/api/jobs${search ? `?${search}` : ''}`)
  return payload.jobs
}

export async function createJob(input) {
  const payload = await apiRequest('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return payload.job
}

export async function setJobSaved(jobId, saved) {
  return apiRequest(`/api/jobs/${encodeURIComponent(jobId)}/save`, {
    method: 'PUT',
    body: JSON.stringify({ saved }),
  })
}

export async function applyToJob(jobId, coverLetter) {
  return apiRequest(`/api/jobs/${encodeURIComponent(jobId)}/applications`, {
    method: 'POST',
    body: JSON.stringify({ cover_letter: coverLetter }),
  })
}

export async function getJobApplications(jobId) {
  const payload = await apiRequest(`/api/jobs/${encodeURIComponent(jobId)}/applications`)
  return payload.applications
}
