import { apiRequest } from './api.js'

const maxImageBytes = 4 * 1024 * 1024
const maxImagePixels = 20_000_000
const maxImageDimension = 1920

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('This image could not be opened. Try another JPEG, PNG, or WebP file.'))
    }
    image.src = objectUrl
  })
}

function encodeCanvas(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('This image could not be optimized. Try another image.'))
    }, 'image/webp', quality)
  })
}

async function optimizeImage(file) {
  const image = await decodeImage(file)
  if (file.size <= maxImageBytes && image.width * image.height <= maxImagePixels) {
    return file
  }

  const scale = Math.min(1, maxImageDimension / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not prepare the image for upload.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  let optimized = await encodeCanvas(canvas, 0.82)
  if (optimized.size > maxImageBytes) {
    const reducedScale = Math.min(1, 1280 / Math.max(canvas.width, canvas.height))
    canvas.width = Math.max(1, Math.round(canvas.width * reducedScale))
    canvas.height = Math.max(1, Math.round(canvas.height * reducedScale))
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    optimized = await encodeCanvas(canvas, 0.7)
  }
  if (optimized.size > maxImageBytes) {
    throw new Error('This image is still too large after optimization. Try a smaller image.')
  }

  return new File([optimized], file.name.replace(/\.[^.]+$/, '.webp'), {
    type: 'image/webp',
    lastModified: file.lastModified,
  })
}

export async function uploadImage(file) {
  const optimizedImage = await optimizeImage(file)
  const payload = await apiRequest('/api/media/images', {
    method: 'POST',
    headers: { 'Content-Type': optimizedImage.type },
    body: optimizedImage,
  })
  return payload.url
}
