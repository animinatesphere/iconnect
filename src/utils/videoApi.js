import { ApiError, apiRequest } from './api.js'

export async function getVideos({ query = '', view = 'all' } = {}) {
  const params = new URLSearchParams({ view })
  if (query.trim()) params.set('query', query.trim())
  const payload = await apiRequest(`/api/videos?${params.toString()}`)
  return payload.videos
}

export async function deleteVideo(videoId) {
  await apiRequest(`/api/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' })
}

export function uploadVideo(file, { title, caption, onProgress }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/videos')
    request.withCredentials = true
    request.timeout = 30 * 60 * 1000
    request.setRequestHeader('Content-Type', file.type)
    request.setRequestHeader('X-Video-Title', encodeURIComponent(title))
    request.setRequestHeader('X-Video-Caption', encodeURIComponent(caption))
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
          payload?.error?.message ?? 'The video could not be uploaded.',
          payload?.error?.code,
        ))
        return
      }
      resolve(payload.video)
    })
    request.addEventListener('error', () => reject(new Error('The video upload failed. Check your connection and try again.')))
    request.addEventListener('timeout', () => reject(new Error('The video upload timed out. Check your connection and try again.')))
    request.send(file)
  })
}
