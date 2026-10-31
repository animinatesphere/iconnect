import { apiRequest } from './api.js'

export async function uploadImage(file) {
  const payload = await apiRequest('/api/media/images', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  return payload.url
}
