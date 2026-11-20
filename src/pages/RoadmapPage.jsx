import React from 'react'
import { ArrowRight, Check, CircleDot, Clock3, Rocket } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'
import { productAreas } from '../data/siteContent.js'

const phases = [
  {
    key: 'live',
    status: 'Live',
    icon: CircleDot,
    phase: 'Phase 1',
    title: 'The iConnect web app',
    description: 'Open to everyone on the web. Create a free account and use the full set of social, commerce and everyday tools.',
    points: [
      'Free accounts with verified email, profiles and privacy controls',
      'Feed, chat, communities, live video, marketplace, jobs and more',
      'Secure payments through Paystack and Stripe',
      'Admin tools for moderation, ads and pricing',
    ],
  },
  {
    key: 'now',
    status: 'In progress',
    icon: Clock3,
    phase: 'Phase 2',
    title: 'Polish and money features',
    description: 'Improving what members already use, and adding money features only through properly licensed partners.',
    points: [
      'Fixing rough edges members report',
      'Wallet and transfers with a licensed partner',
      'Live market data for iConnect Trade',
      'Faster pages and better phone layouts',
    ],
  },
  {
    key: 'next',
    status: 'Next',
    icon: Rocket,
    phase: 'Phase 3',
    title: 'Mobile apps',
    description: 'Android and iPhone apps built around what members use most on the web.',
    points: [
      'Same account across web and mobile',
      'Notifications for messages and activity',
      'Designed for phone-first use',
    ],
  },
]

export default function RoadmapPage() {
  const live = productAreas.filter((area) => area.status.startsWith('Live'))
  const soon = productAreas.filter((area) => !area.status.startsWith('Live'))

  return (
    <>
      <PageMeta
        title="Roadmap"
        description="Where iConnect is today and what comes next: the web app is live, money features are being added with licensed partners, and Android and iPhone apps are next."
      />

      <section className="rm-hero">
        <div className="section-kicker"><span>01</span> ROADMAP</div>
        <h1 className="page-title">Live on the web.<br /><span className="serif-italic">Mobile next.</span></h1>
        <p className="rm-hero-lead">iConnect is open to everyone on the web today. Here is what is already live, what we are working on now, and what comes after.</p>
        <div className="rm-summary">
          <div className="rm-summary-item rm-live"><strong>{live.length}</strong><span>features live now</span></div>
          <div className="rm-summary-item rm-now"><strong>{phases[1].points.length}</strong><span>things in progress</span></div>
          <div className="rm-summary-item rm-next"><strong>{soon.length}</strong><span>coming soon</span></div>
        </div>
      </section>

      <section className="rm-section">
        <div className="rm-phases">
          {phases.map(({ key, status, icon: Icon, phase, title, description, points }, index) => (
            <article className={`rm-phase rm-${key} reveal`} style={{ '--reveal-delay': `${index * 100}ms` }} key={key}>
              <div className="rm-phase-top">
                <span className="rm-status"><Icon size={14} /> {status}</span>
                <span className="rm-phase-label">{phase}</span>
              </div>
              <h2>{title}</h2>
              <p>{description}</p>
              <ul>{points.map((point) => <li key={point}><Check size={15} />{point}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="rm-section rm-features">
        <div className="rm-features-grid">
          <div>
            <h2 className="rm-subheading">What's live today</h2>
            <div className="rm-chips">
              {live.map(({ name, icon: Icon }) => <span className="rm-chip rm-chip-live" key={name}><Icon size={15} /> {name}</span>)}
            </div>
          </div>
          <div>
            <h2 className="rm-subheading">Coming soon</h2>
            <div className="rm-chips">
              {soon.map(({ name, icon: Icon }) => <span className="rm-chip" key={name}><Icon size={15} /> {name}</span>)}
            </div>
            <p className="rm-note">Money features such as the wallet and investing launch only with properly licensed partners.</p>
          </div>
        </div>
      </section>

      <section className="rm-section rm-closing">
        <div className="rm-closing-inner">
          <div>
            <div className="section-kicker"><span>02</span> A LIVING PLAN</div>
            <h2>Shaped by<br /><span className="serif-italic">what members need.</span></h2>
          </div>
          <div>
            <p>We add features in the order members need them, and only when they can be done safely and legally. Tell us what you want next from inside the app.</p>
            <div className="rm-closing-actions">
              <Link className="button-primary" to="/app/onboarding">Create your free account <ArrowRight size={17} /></Link>
              <Link className="arrow-link" to="/product">See every feature <span><ArrowRight size={17} /></span></Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
