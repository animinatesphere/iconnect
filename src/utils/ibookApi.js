import { apiRequest } from './api.js'

export async function getIbookStays(location = '') {
  const params = new URLSearchParams({ limit: '100' })
  if (location.trim()) params.set('location', location.trim())
  const payload = await apiRequest(`/api/ibook/stays?${params}`)
  return payload.stays
}

export async function createIbookStay(stay) {
  const payload = await apiRequest('/api/ibook/stays', {
    method: 'POST',
    body: JSON.stringify({
      property_type: stay.propertyType,
      title: stay.title,
      location: stay.location,
      price: Number(stay.price),
      price_unit: stay.priceUnit,
      max_guests: Number(stay.maxGuests),
      description: stay.description,
      image_urls: stay.imageUrls,
    }),
  })
  return payload.stay
}

export async function requestIbookStayBooking(booking) {
  return apiRequest('/api/ibook/stay-bookings', {
    method: 'POST',
    body: JSON.stringify({
      listing_id: booking.listingId,
      check_in: booking.checkIn,
      check_out: booking.checkOut,
      guests: Number(booking.guests),
      message: booking.message,
    }),
  })
}

export async function getIbookStayBookings() {
  const payload = await apiRequest('/api/ibook/stay-bookings')
  return payload.bookings
}

export async function updateIbookStayBooking(bookingId, status) {
  return apiRequest(`/api/ibook/stay-bookings/${encodeURIComponent(bookingId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}

export async function getIbookDrivers(area = '', passengers = 1) {
  const params = new URLSearchParams({ passengers: String(passengers) })
  if (area.trim()) params.set('area', area.trim())
  const payload = await apiRequest(`/api/ibook/drivers?${params}`)
  return payload.drivers
}

export async function updateIbookDriver(profile) {
  const payload = await apiRequest('/api/ibook/drivers/me', {
    method: 'PUT',
    body: JSON.stringify({
      vehicle_type: profile.vehicleType,
      vehicle_description: profile.vehicleDescription,
      service_area: profile.serviceArea,
      seats: Number(profile.seats),
      available: profile.available,
    }),
  })
  return payload.driver
}

export async function getIbookDriverProfile() {
  const payload = await apiRequest('/api/ibook/drivers/me')
  return payload.driver
}

export async function requestIbookRide(ride) {
  return apiRequest('/api/ibook/rides', {
    method: 'POST',
    body: JSON.stringify({
      driver_id: ride.driverId,
      pickup: ride.pickup,
      destination: ride.destination,
      pickup_time: new Date(ride.pickupTime).toISOString(),
      passengers: Number(ride.passengers),
      note: ride.note,
    }),
  })
}

export async function getIbookRides() {
  const payload = await apiRequest('/api/ibook/rides')
  return payload.rides
}

export async function updateIbookRide(rideId, status) {
  return apiRequest(`/api/ibook/rides/${encodeURIComponent(rideId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}
