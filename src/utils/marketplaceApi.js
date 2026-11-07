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

export async function updateMarketplaceProduct(productId, product) {
  const payload = await apiRequest(`/api/marketplace/products/${encodeURIComponent(productId)}`, {
    method: 'PUT',
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

export async function deleteMarketplaceProduct(productId) {
  return apiRequest(`/api/marketplace/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  })
}

export async function checkoutMarketplaceProduct(productId, quantity = 1) {
  return apiRequest('/api/marketplace/orders/checkout', {
    method: 'POST',
    body: JSON.stringify({ product_id: productId, quantity }),
  })
}

export async function getMarketplaceOrders() {
  const payload = await apiRequest('/api/marketplace/orders')
  return payload.orders
}

export async function fulfillMarketplaceOrder(orderId) {
  return apiRequest(`/api/marketplace/orders/${encodeURIComponent(orderId)}/fulfill`, {
    method: 'POST',
  })
}
