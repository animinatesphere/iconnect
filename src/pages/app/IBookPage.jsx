import React from 'react'
import { CalendarClock, CarFront, MapPin, Plane, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'

const bookingTypes = [
  { title: 'Flights', detail: 'Airline schedules, live fares, and ticketing are not connected.', icon: Plane },
  { title: 'Local rides', detail: 'No driver availability, dispatch, or ride tracking is connected.', icon: CarFront },
  { title: 'Stays & rentals', detail: 'Live inventory and confirmed reservations are not available.', icon: CalendarClock },
]

export default function IBookPage() {
  return (
    <div className="app-content-width ibook-page">
      <AppPageHeader
        eyebrow="TRAVEL & MOBILITY"
        title="iBook journeys"
        description="A single place for travel and local transport, when verified providers are connected."
      />
      <section className="ibook-unavailable" role="status">
        <span className="ibook-unavailable-icon"><MapPin size={22} /></span>
        <div>
          <span className="app-page-eyebrow">NOT AVAILABLE YET</span>
          <h2>Booking is not connected.</h2>
          <p>iConnect has no airline, transport, accommodation, or payment provider connected. No availability or prices are shown, and this page cannot create a reservation or charge you.</p>
        </div>
      </section>
      <section className="ibook-capabilities" aria-label="Planned booking services">
        {bookingTypes.map(({ title, detail, icon: Icon }) => (
          <article key={title}>
            <span><Icon size={17} /></span>
            <div><h3>{title}</h3><p>{detail}</p></div>
            <small>NOT CONNECTED</small>
          </article>
        ))}
      </section>
      <div className="ibook-member-listings">
        <ShieldCheck size={17} />
        <p><strong>Looking for a local provider?</strong> Member listings are separate from booking and do not confirm a service or reservation.</p>
        <Link to="/app/marketplace">Browse member listings</Link>
      </div>
    </div>
  )
}
