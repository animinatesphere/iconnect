import { apiRequest } from './api.js'

export async function getMarketplaceProducts({ query = '', category = '', limit = 100 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (query.trim()) params.set('query', query.trim())
  if (category && category !== 'All') params.set('category', category)
  const payload = await apiRequest(`/api/marketplace/products?${params}`)
  return payload.products
}

export async function getMarketplaceProduct(productId) {
  const payload = await apiRequest(`/api/marketplace/products/${encodeURIComponent(productId)}`)
  return payload.product
}

export async function createMarketplaceProduct(product) {
  const payload = await apiRequest('/api/marketplace/products', {
    method: 'POST',
    body: JSON.stringify({
      name: product.name,
      category: product.category,
      price: Number(product.price),
      stock: Number(product.stock),
      description: product.description,
      image_url: product.imageUrl || null,
      image_urls: product.imageUrls ?? [],
    }),
  })
  return payload.product
}
