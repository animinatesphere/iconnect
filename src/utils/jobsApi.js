import { ApiError, apiRequest } from './api.js'

export async function getJobBusinessProfile() {
  const payload = await apiRequest('/api/jobs/business-profile')
  return payload.businessProfile
}

export function submitJobBusinessProfile(file, profile, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/jobs/business-profile')
    request.withCredentials = true
    request.timeout = 5 * 60 * 1000
    request.setRequestHeader('Content-Type', file.type)
    request.setRequestHeader('X-Company-Details', encodeURIComponent(JSON.stringify(profile)))
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener('load', () => {
      let payload
      try {
        payload = JSON.parse(request.responseText)
      } catch {
        reject(new Error('The server returned an invalid response. Try again later.'))
        return
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError(
          payload?.error?.message ?? 'The company profile could not be submitted.',
          payload?.error?.code,
        ))
        return
      }
      resolve(payload.businessProfile)
    })
    request.addEventListener('error', () => reject(new Error('The CAC document upload failed. Check your connection and try again.')))
    request.addEventListener('timeout', () => reject(new Error('The CAC document upload timed out. Check your connection and try again.')))
    request.send(file)
  })
}

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
