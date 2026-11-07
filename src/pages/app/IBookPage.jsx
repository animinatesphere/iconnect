import React, { useCallback, useEffect, useState } from 'react'
import { CalendarDays, CarFront, Check, ChevronRight, Clock3, Home, ImagePlus, MapPin, Search, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { uploadImage } from '../../utils/mediaApi.js'
import {
  createIbookStay,
  getIbookDrivers,
  getIbookDriverProfile,
  getIbookRides,
  getIbookStayBookings,
  getIbookStays,
  requestIbookRide,
  requestIbookStayBooking,
  updateIbookDriver,
  updateIbookRide,
  updateIbookStayBooking,
} from '../../utils/ibookApi.js'

const initialStay = {
  propertyType: 'Apartment',
  title: '',
  location: '',
  price: '',
  priceUnit: 'night',
  maxGuests: '2',
  description: '',
}
const initialDriver = {
  vehicleType: 'Car',
  vehicleDescription: '',
  serviceArea: '',
  seats: '3',
  available: true,
}
function getLocalDateTimeValue(value = Date.now() + 60 * 60 * 1000) {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}
const initialRide = {
  pickup: '',
  destination: '',
  pickupTime: getLocalDateTimeValue(),
  passengers: '1',
  note: '',
}
const stayStatusLabels = {
  requested: 'Awaiting host',
  confirmed: 'Confirmed',
  declined: 'Declined',
  cancelled: 'Cancelled',
}
const rideStatusLabels = {
  requested: 'Waiting for driver',
  accepted: 'Driver accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  completed: 'Completed',
}

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount)
}

function IBookPage() {
  const [section, setSection] = useState('stays')
  const [stays, setStays] = useState([])
  const [stayBookings, setStayBookings] = useState([])
  const [drivers, setDrivers] = useState([])
  const [rides, setRides] = useState([])
  const [location, setLocation] = useState('')
  const [rideArea, setRideArea] = useState('')
  const [guestCount, setGuestCount] = useState('1')
  const [showStayForm, setShowStayForm] = useState(false)
  const [showDriverForm, setShowDriverForm] = useState(false)
  const [stayDraft, setStayDraft] = useState(initialStay)
  const [driverDraft, setDriverDraft] = useState(initialDriver)
  const [driverProfile, setDriverProfile] = useState(null)
  const [stayPhotos, setStayPhotos] = useState([])
  const [stayPhotoPreviews, setStayPhotoPreviews] = useState([])
  const [selectedStay, setSelectedStay] = useState(null)
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [stayRequest, setStayRequest] = useState({ checkIn: '', checkOut: '', guests: '1', message: '' })
  const [rideDraft, setRideDraft] = useState(initialRide)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const previews = stayPhotos.map((photo) => URL.createObjectURL(photo))
    setStayPhotoPreviews(previews)
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [stayPhotos])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextStays, nextBookings, nextDrivers, nextRides, myDriverProfile] = await Promise.all([
        getIbookStays(location),
        getIbookStayBookings(),
        getIbookDrivers(rideArea, guestCount),
        getIbookRides(),
        getIbookDriverProfile(),
      ])
      setStays(nextStays)
      setStayBookings(nextBookings)
      setDrivers(nextDrivers)
      setRides(nextRides)
      setDriverProfile(myDriverProfile)
      if (myDriverProfile) {
        setDriverDraft({
          vehicleType: myDriverProfile.vehicleType,
          vehicleDescription: myDriverProfile.vehicleDescription,
          serviceArea: myDriverProfile.serviceArea,
          seats: String(myDriverProfile.seats),
          available: myDriverProfile.available,
        })
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load iBook. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [guestCount, location, rideArea])

  useEffect(() => { loadData() }, [loadData, refresh])

  function updateStay(key, value) {
    setStayDraft((current) => ({ ...current, [key]: value }))
  }

  async function submitStay(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const imageUrls = []
      for (const photo of stayPhotos) imageUrls.push(await uploadImage(photo))
      const created = await createIbookStay({ ...stayDraft, imageUrls })
      setStays((current) => [created, ...current])
      setStayDraft(initialStay)
      setStayPhotos([])
      setShowStayForm(false)
      setNotice('Your stay listing is published. Hosts confirm requests directly.')
    } catch (saveError) {
      setError(saveError.message || 'Could not publish the property.')
    } finally {
      setSaving(false)
    }
  }

  async function submitStayRequest(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await requestIbookStayBooking({ ...stayRequest, listingId: selectedStay.id })
      setSelectedStay(null)
      setStayRequest({ checkIn: '', checkOut: '', guests: '1', message: '' })
      setNotice('Stay request sent. It is not confirmed until the host accepts it.')
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError.message || 'Could not send this stay request.')
    } finally {
      setSaving(false)
    }
  }

  async function updateStayBooking(booking, status) {
    setBusyId(booking.id)
    setError('')
    try {
      await updateIbookStayBooking(booking.id, status)
      setNotice(`Stay request ${status}.`)
      setRefresh((value) => value + 1)
    } catch (updateError) {
      setError(updateError.message || 'Could not update the stay request.')
    } finally {
      setBusyId('')
    }
  }

  async function saveDriverProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateIbookDriver(driverDraft)
      setDriverProfile({ ...driverDraft, seats: Number(driverDraft.seats) })
      setShowDriverForm(false)
      setNotice(driverDraft.available ? 'Driver profile saved and you are available for ride requests.' : 'Driver profile saved and you are offline.')
      setRefresh((value) => value + 1)
    } catch (saveError) {
      setError(saveError.message || 'Could not save your driver profile.')
    } finally {
      setSaving(false)
    }
  }

  async function submitRideRequest(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await requestIbookRide({ ...rideDraft, driverId: selectedDriver.id })
      setSelectedDriver(null)
      setRideDraft(initialRide)
      setNotice('Ride request sent. Wait for the driver to accept before travelling.')
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError.message || 'Could not send this ride request.')
    } finally {
      setSaving(false)
    }
  }

  async function updateRide(ride, status) {
    setBusyId(ride.id)
    setError('')
    try {
      await updateIbookRide(ride.id, status)
      setNotice(status === 'completed'
        ? 'Ride completed. You are offline; update your driver settings when you are ready for another request.'
        : `Ride ${status}.`)
      setRefresh((value) => value + 1)
    } catch (updateError) {
      setError(updateError.message || 'Could not update this ride.')
    } finally {
      setBusyId('')
    }
  }

  function toggleDriverForm() {
    if (driverProfile) {
      setDriverDraft({
        vehicleType: driverProfile.vehicleType,
        vehicleDescription: driverProfile.vehicleDescription,
        serviceArea: driverProfile.serviceArea,
        seats: String(driverProfile.seats),
        available: driverProfile.available,
      })
    }
    setShowDriverForm((open) => !open)
  }

  return (
    <div className="app-content-width ibook-page">
      <AppPageHeader
        eyebrow="TRAVEL & MOBILITY"
        title="iBook journeys"
        description="Find a place to stay or request a local ride from iConnect members."
      />

      <section className="ibook-hero">
        <span className="app-page-eyebrow">YOUR NEXT JOURNEY STARTS HERE</span>
        <h2>Places to go. People to get you there.</h2>
        <p>Discover member-listed stays and request rides from drivers who are currently available.</p>
        <div><span><ShieldCheck size={14} /> Member profiles</span><span><CalendarDays size={14} /> Request and confirm</span><span><MapPin size={14} /> Search by area</span></div>
      </section>

      <nav className="ibook-primary-tabs" aria-label="iBook services">
        <button type="button" className={section === 'stays' ? 'active' : ''} onClick={() => setSection('stays')}><Home size={16} /> Stays & rentals</button>
        <button type="button" className={section === 'rides' ? 'active' : ''} onClick={() => setSection('rides')}><CarFront size={16} /> Local rides</button>
        <button type="button" disabled title="Flights will be available when an airline booking provider is connected."><CalendarDays size={16} /> Flights <small>COMING LATER</small></button>
      </nav>

      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}

      {section === 'stays' ? (
        <>
          <div className="ibook-section-heading">
            <div><span className="app-page-eyebrow">MEMBER STAYS</span><h2>Stay somewhere that feels right</h2><p>Browse homes, rooms, apartments and vacation rentals listed by members.</p></div>
            <button type="button" className="app-primary-button" onClick={() => setShowStayForm((open) => !open)}>{showStayForm ? <X size={15} /> : <Home size={15} />}{showStayForm ? 'Close form' : 'List a place'}</button>
          </div>
          {showStayForm && <form className="ibook-form ibook-stay-form" onSubmit={submitStay}>
            <div className="ibook-form-heading"><div><span className="app-page-eyebrow">HOST ON IBOOK</span><h3>List your place</h3></div><span>Photos help guests choose</span></div>
            <label>Property type<select value={stayDraft.propertyType} onChange={(event) => updateStay('propertyType', event.target.value)}><option>Apartment</option><option>House</option><option>Room</option><option>Vacation rental</option></select></label>
            <label>Listing title<input required minLength={4} maxLength={120} value={stayDraft.title} onChange={(event) => updateStay('title', event.target.value)} placeholder="Bright apartment near the city centre" /></label>
            <label>Area or city<input required minLength={2} value={stayDraft.location} onChange={(event) => updateStay('location', event.target.value)} placeholder="Victoria Island, Lagos" /></label>
            <div className="ibook-form-inline"><label>Price (NGN)<input type="number" min="1" max="1000000000" required value={stayDraft.price} onChange={(event) => updateStay('price', event.target.value)} /></label><label>Price per<select value={stayDraft.priceUnit} onChange={(event) => updateStay('priceUnit', event.target.value)}><option value="night">Night</option><option value="month">Month</option></select></label><label>Max guests<input type="number" min="1" max="30" required value={stayDraft.maxGuests} onChange={(event) => updateStay('maxGuests', event.target.value)} /></label></div>
            <label>Description<textarea required minLength={20} maxLength={2000} rows="4" value={stayDraft.description} onChange={(event) => updateStay('description', event.target.value)} placeholder="Describe the rooms, amenities, house rules and anything guests should know." /></label>
            <label className="media-upload-picker"><ImagePlus size={18} /><span>Add property photos</span><small>{stayPhotos.length}/5 · JPEG, PNG or WebP · optimized on upload<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving || stayPhotos.length >= 5} onChange={(event) => setStayPhotos((current) => [...current, ...Array.from(event.target.files || [])].slice(0, 5))} /></small></label>
            {!!stayPhotos.length && <div className="media-upload-previews">{stayPhotos.map((photo, index) => <div className="media-upload-preview" key={`${photo.name}-${photo.lastModified}-${index}`}><img src={stayPhotoPreviews[index]} alt={`Property preview ${index + 1}`} /><button type="button" aria-label={`Remove property photo ${index + 1}`} onClick={() => setStayPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}><X size={15} /></button></div>)}</div>}
            <div className="ibook-form-actions"><span>Booking requests are confirmed by you. No payment is collected here.</span><button type="submit" className="app-primary-button" disabled={saving || stayPhotos.length === 0}>{saving ? 'Publishing…' : 'Publish stay'}</button></div>
          </form>}

          <div className="ibook-search-row"><label><MapPin size={15} /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Search by city or neighborhood" /><Search size={15} /></label><span>{stays.length} places</span></div>
          {loading ? <p className="ibook-loading" role="status">Finding member stays…</p> : stays.length ? <div className="ibook-stay-grid">{stays.map((stay) => <article className="ibook-stay-card" key={stay.id}>
            <div className="ibook-stay-image"><img src={stay.imageUrls?.[0]} alt={stay.title} loading="lazy" /><span>{stay.propertyType}</span></div>
            <div className="ibook-stay-card-body"><div className="ibook-stay-location"><MapPin size={13} />{stay.location}</div><h3>{stay.title}</h3><div className="ibook-stay-host"><UserRound size={13} /> Hosted by {stay.host.name}</div><div className="ibook-stay-meta"><span><Users size={14} /> Up to {stay.maxGuests}</span><strong>{formatNaira(stay.price)} <small>/ {stay.priceUnit}</small></strong></div><p>{stay.description}</p><button type="button" className="app-primary-button" onClick={() => { setSelectedStay(stay); setStayRequest((current) => ({ ...current, guests: '1' })) }}>Request to book <ChevronRight size={15} /></button></div>
          </article>)}</div> : <div className="ibook-empty"><Home size={25} /><h3>No stays listed here yet</h3><p>Try another location, or be the first member to list a place.</p></div>}

          <section className="ibook-requests-section"><div className="ibook-section-heading"><div><span className="app-page-eyebrow">YOUR BOOKINGS</span><h2>Stay requests</h2></div></div>
            {stayBookings.length ? <div className="ibook-request-list">{stayBookings.map((booking) => <article key={booking.id}><div className="ibook-request-icon"><Home size={16} /></div><div className="ibook-request-main"><strong>{booking.title}</strong><span>{booking.checkIn} – {booking.checkOut} · {booking.guests} guest{booking.guests > 1 ? 's' : ''}</span><small>{booking.role === 'host' ? `Guest: ${booking.otherParty.name}` : `Host: ${booking.otherParty.name}`} · {booking.message || 'No note'}</small></div><span className={`ibook-status status-${booking.status}`}>{stayStatusLabels[booking.status]}</span><div className="ibook-request-actions">{booking.status === 'requested' && booking.role === 'host' && <><button type="button" disabled={busyId === booking.id} onClick={() => updateStayBooking(booking, 'confirmed')}><Check size={14} /> Confirm</button><button type="button" className="quiet" disabled={busyId === booking.id} onClick={() => updateStayBooking(booking, 'declined')}>Decline</button></>}{booking.status === 'requested' && booking.role === 'guest' && <button type="button" className="quiet" disabled={busyId === booking.id} onClick={() => updateStayBooking(booking, 'cancelled')}>Cancel</button>}</div></article>)}</div> : <div className="ibook-empty compact"><CalendarDays size={20} /><p>Your stay requests will appear here.</p></div>}
          </section>
        </>
      ) : (
        <>
          <div className="ibook-section-heading">
            <div><span className="app-page-eyebrow">LOCAL MOBILITY</span><h2>Find a ride nearby</h2><p>Request a ride from a member driver and wait for them to accept.</p></div>
            <button type="button" className="app-primary-button" onClick={toggleDriverForm}>{showDriverForm ? <X size={15} /> : <CarFront size={15} />}{showDriverForm ? 'Close form' : driverProfile ? 'Driver settings' : 'Drive with iBook'}</button>
          </div>
          {showDriverForm && <form className="ibook-form ibook-driver-form" onSubmit={saveDriverProfile}>
            <div className="ibook-form-heading"><div><span className="app-page-eyebrow">DRIVER PROFILE</span><h3>Set up your ride profile</h3></div><span>Go online when ready</span></div>
            <label>Vehicle type<select value={driverDraft.vehicleType} onChange={(event) => setDriverDraft((current) => ({ ...current, vehicleType: event.target.value }))}><option>Car</option><option>Motorcycle</option><option>Tricycle</option></select></label>
            <label>Vehicle description<input required minLength={2} maxLength={100} value={driverDraft.vehicleDescription} onChange={(event) => setDriverDraft((current) => ({ ...current, vehicleDescription: event.target.value }))} placeholder="Blue Toyota Corolla" /></label>
            <div className="ibook-form-inline"><label>Service area<input required minLength={2} maxLength={120} value={driverDraft.serviceArea} onChange={(event) => setDriverDraft((current) => ({ ...current, serviceArea: event.target.value }))} placeholder="Ikeja, Lagos" /></label><label>Passenger seats<input type="number" min="1" max="8" value={driverDraft.seats} onChange={(event) => setDriverDraft((current) => ({ ...current, seats: event.target.value }))} /></label></div>
            <label className="ibook-toggle"><input type="checkbox" checked={driverDraft.available} onChange={(event) => setDriverDraft((current) => ({ ...current, available: event.target.checked }))} /><span><strong>Available for ride requests</strong><small>Switch off when you are not taking requests.</small></span></label>
            <div className="ibook-form-actions"><span>Ride fares, live location and in-app payments are not connected.</span><button type="submit" className="app-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save driver profile'}</button></div>
          </form>}
          <div className="ibook-search-row"><label><MapPin size={15} /><input value={rideArea} onChange={(event) => setRideArea(event.target.value)} placeholder="Search drivers by city or service area" /><Search size={15} /></label><label className="ibook-passenger-filter"><Users size={14} /><select value={guestCount} onChange={(event) => setGuestCount(event.target.value)}>{[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} passenger{count > 1 ? 's' : ''}</option>)}</select></label></div>
          {loading ? <p className="ibook-loading" role="status">Finding available drivers…</p> : drivers.length ? <div className="ibook-driver-grid">{drivers.map((driver) => <article className="ibook-driver-card" key={driver.id}><div className="ibook-driver-avatar"><CarFront size={21} /></div><div className="ibook-driver-info"><span className="ibook-online-dot">AVAILABLE</span><h3>{driver.name}</h3><small>@{driver.username}</small><p>{driver.vehicleType} · {driver.vehicleDescription}</p><span><MapPin size={13} /> {driver.serviceArea}</span><span><Users size={13} /> Up to {driver.seats} passengers</span></div><button type="button" className="app-primary-button" onClick={() => setSelectedDriver(driver)}>Request ride <ChevronRight size={15} /></button></article>)}</div> : <div className="ibook-empty"><CarFront size={25} /><h3>No available drivers found</h3><p>Try a nearby area or check again later. Drivers can register above and set their availability.</p></div>}

          <section className="ibook-requests-section"><div className="ibook-section-heading"><div><span className="app-page-eyebrow">YOUR RIDES</span><h2>Ride requests</h2></div></div>
            {rides.length ? <div className="ibook-request-list">{rides.map((ride) => <article key={ride.id}><div className="ibook-request-icon"><CarFront size={16} /></div><div className="ibook-request-main"><strong>{ride.pickup} <ChevronRight size={12} /> {ride.destination}</strong><span><Clock3 size={12} /> {new Date(ride.pickupTime).toLocaleString()} · {ride.passengers} passenger{ride.passengers > 1 ? 's' : ''}</span><small>{ride.role === 'driver' ? `Rider: ${ride.otherParty.name}` : `Driver: ${ride.otherParty.name}`} · {ride.note || 'No note'}</small></div><span className={`ibook-status status-${ride.status}`}>{rideStatusLabels[ride.status]}</span><div className="ibook-request-actions">{ride.role === 'driver' && ride.status === 'requested' && <><button type="button" disabled={busyId === ride.id} onClick={() => updateRide(ride, 'accepted')}><Check size={14} /> Accept</button><button type="button" className="quiet" disabled={busyId === ride.id} onClick={() => updateRide(ride, 'declined')}>Decline</button></>}{ride.role === 'driver' && ride.status === 'accepted' && <button type="button" disabled={busyId === ride.id} onClick={() => updateRide(ride, 'completed')}>Complete ride</button>}{ride.role === 'rider' && ride.status === 'requested' && <button type="button" className="quiet" disabled={busyId === ride.id} onClick={() => updateRide(ride, 'cancelled')}>Cancel</button>}</div></article>)}</div> : <div className="ibook-empty compact"><CarFront size={20} /><p>Your ride requests and driver bookings will appear here.</p></div>}
          </section>
        </>
      )}

      <p className="ibook-safety-note"><ShieldCheck size={16} /> iBook connects members to request services. Confirm details directly before travel. No fare is charged here, live GPS tracking is not available, and bookings require the host or driver to accept.</p>

      {selectedStay && <div className="ibook-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedStay(null) }}><form className="ibook-modal" onSubmit={submitStayRequest}><button type="button" className="ibook-modal-close" aria-label="Close" onClick={() => setSelectedStay(null)}><X size={18} /></button><span className="app-page-eyebrow">REQUEST A STAY</span><h2>{selectedStay.title}</h2><p>{selectedStay.location} · Hosted by {selectedStay.host.name}</p><label>Check in<input type="date" required min={new Date().toISOString().slice(0, 10)} value={stayRequest.checkIn} onChange={(event) => setStayRequest((current) => ({ ...current, checkIn: event.target.value }))} /></label><label>Check out<input type="date" required min={stayRequest.checkIn || new Date().toISOString().slice(0, 10)} value={stayRequest.checkOut} onChange={(event) => setStayRequest((current) => ({ ...current, checkOut: event.target.value }))} /></label><label>Guests<input type="number" min="1" max={selectedStay.maxGuests} value={stayRequest.guests} onChange={(event) => setStayRequest((current) => ({ ...current, guests: event.target.value }))} /></label><label>Message to host<textarea rows="3" maxLength="500" value={stayRequest.message} onChange={(event) => setStayRequest((current) => ({ ...current, message: event.target.value }))} placeholder="Introduce yourself or ask a question." /></label><button type="submit" className="app-primary-button" disabled={saving}>{saving ? 'Sending…' : 'Send stay request'}</button><small>This is a request, not a confirmed reservation or payment.</small></form></div>}

      {selectedDriver && <div className="ibook-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDriver(null) }}><form className="ibook-modal" onSubmit={submitRideRequest}><button type="button" className="ibook-modal-close" aria-label="Close" onClick={() => setSelectedDriver(null)}><X size={18} /></button><span className="app-page-eyebrow">REQUEST A RIDE</span><h2>Ride with {selectedDriver.name}</h2><p>{selectedDriver.vehicleType} · {selectedDriver.vehicleDescription} · {selectedDriver.serviceArea}</p><label>Pickup location<input required minLength="2" maxLength="180" value={rideDraft.pickup} onChange={(event) => setRideDraft((current) => ({ ...current, pickup: event.target.value }))} placeholder="Street, landmark or neighborhood" /></label><label>Destination<input required minLength="2" maxLength="180" value={rideDraft.destination} onChange={(event) => setRideDraft((current) => ({ ...current, destination: event.target.value }))} placeholder="Where are you going?" /></label><label>Pickup date and time<input type="datetime-local" required min={getLocalDateTimeValue(Date.now())} value={rideDraft.pickupTime} onChange={(event) => setRideDraft((current) => ({ ...current, pickupTime: event.target.value }))} /></label><label>Passengers<input type="number" min="1" max={selectedDriver.seats} value={rideDraft.passengers} onChange={(event) => setRideDraft((current) => ({ ...current, passengers: event.target.value }))} /></label><label>Note for driver<textarea rows="2" maxLength="500" value={rideDraft.note} onChange={(event) => setRideDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Optional details" /></label><button type="submit" className="app-primary-button" disabled={saving}>{saving ? 'Sending…' : 'Send ride request'}</button><small>Wait for the driver to accept and confirm the fare before setting off.</small></form></div>}
    </div>
  )
}

export default IBookPage
