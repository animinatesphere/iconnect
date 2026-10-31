import { apiRequest } from './api.js'

export async function getLocalMarketplaceListings({ category = '', query = '', location = '', limit = 100 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (category) params.set('category', category)
  if (query.trim()) params.set('query', query.trim())
  if (location.trim()) params.set('location', location.trim())
  const payload = await apiRequest(`/api/local-marketplace/listings?${params}`)
  return payload.listings
}

export async function getLocalMarketplaceListing(listingId) {
  const payload = await apiRequest(`/api/local-marketplace/listings/${encodeURIComponent(listingId)}`)
  return payload.listing
}

export async function createLocalMarketplaceListing(listing) {
  const payload = await apiRequest('/api/local-marketplace/listings', {
    method: 'POST',
    body: JSON.stringify({
      category: listing.category,
      title: listing.title,
      price: listing.price,
      location: listing.location,
      detail: listing.detail,
      description: listing.description,
      image_url: listing.imageUrl || null,
    }),
  })
  return payload.listing
}
