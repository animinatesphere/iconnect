import React from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Bot, Briefcase, ChevronDown, CreditCard, Eye, Heart, Home, LockKeyhole, Megaphone, MessageCircle, PiggyBank, Plane, Radio, Send, ShieldCheck, ShoppingBag, Store, TrendingUp, UserPlus, Users, Video } from 'lucide-react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import PageMeta from '../components/PageMeta.jsx'
import { communities, faqs, people, principles } from '../data/siteContent.js'

// The four iConnect divisions and what members can use in each today.
const divisions = [
  {
    id: 'social',
    name: 'iConnect Social',
    title: 'Share, chat and belong',
    description: 'A social network built around real connection: post your moments, talk privately, and find communities around what you love.',
    tone: 'lp-tone-lime',
    image: 'photo-1543269865-cbf427effbad',
    imageAlt: 'Friends chatting and sharing on their phones at a café',
    features: [
      { icon: Home, name: 'Home feed & stories', text: 'Post photos and updates, react, comment, save posts and share 24-hour status updates.' },
      { icon: MessageCircle, name: 'Private chat', text: 'One-to-one messages with photos and voice notes.' },
      { icon: Users, name: 'Communities & Connect', text: 'Follow people, start a community, or join one around your interests.' },
      { icon: Radio, name: 'Live video', text: 'Go live with your camera and chat with viewers in real time.' },
      { icon: Video, name: 'Video hub', text: 'Upload and watch videos from members.' },
      { icon: Heart, name: 'iConnect Date', text: 'A separate dating profile and inbox to meet new people.' },
    ],
  },
  {
    id: 'commerce',
    name: 'iConnect Commerce',
    title: 'Buy, sell, book and hire',
    description: 'An online marketplace and opportunities hub, with secure checkout for buyers and simple tools for sellers.',
    tone: 'lp-tone-coral',
    image: 'photo-1556742049-0cfed4f6a45d',
    imageAlt: 'A customer paying with her phone at a small shop',
    features: [
      { icon: ShoppingBag, name: 'iConnect Market', text: 'Shop products from members and pay securely online.' },
      { icon: Store, name: 'Homes & local services', text: 'List and find local items, homes and services near you.' },
      { icon: Briefcase, name: 'iConnect Jobs', text: 'Post job openings and discover new opportunities.' },
      { icon: Plane, name: 'iBook stays & rides', text: 'List or request rooms, apartments and local rides from other members.' },
      { icon: Megaphone, name: 'iConnect Ads', text: 'Promote your business in the home feed with simple ad packages.' },
    ],
  },
  {
    id: 'finance',
    name: 'iConnect Finance',
    title: 'Plan your money, practise smart',
    description: 'Tools that help you save and learn, introduced carefully and only with licensed partners where money is involved.',
    tone: 'lp-tone-lilac',
    image: 'photo-1579621970563-ebec7560ff3e',
    imageAlt: 'A young plant growing from a pile of coins',
    features: [
      { icon: PiggyBank, name: 'iConnect Ajo', text: 'Create a personal savings plan, set your schedule and track every contribution.' },
      { icon: TrendingUp, name: 'iConnect Trade (practice)', text: 'Practise FX trading with strict risk rules, without real money.' },
      { icon: CreditCard, name: 'iConnect Premium', text: 'Publisher plans with higher monthly posting limits.' },
    ],
    note: 'Wallet, transfers and investing are coming soon with a licensed payments partner.',
  },
  {
    id: 'intelligence',
    name: 'iConnect Intelligence',
    title: 'Help when you need it',
    description: 'An AI assistant built into iConnect to help you write, plan and find answers faster.',
    tone: 'lp-tone-sky',
    image: 'photo-1677442136019-21780ecad995',
    imageAlt: 'An illustration of artificial intelligence',
    features: [
      { icon: Bot, name: 'iConnect AI', text: 'Ask questions, draft posts and captions, and get ideas in seconds.' },
    ],
  },
]

const quickFacts = [
  { value: '15+', label: 'features live on the web' },
  { value: '1', label: 'free account for everything' },
  { value: '2', label: 'trusted payment providers: Paystack & Stripe' },
  { value: 'Soon', label: 'Android and iPhone apps' },
]

const steps = [
  { icon: UserPlus, title: 'Create your free account', text: 'Sign up with your name and email, then confirm with the short code we send you.' },
  { icon: BadgeCheck, title: 'Set up your profile', text: 'Add a photo and your interests so the right people and communities can find you.' },
  { icon: Send, title: 'Start connecting', text: 'Post, chat, join communities, shop, find work, and explore everything iConnect offers.' },
]

const forBusiness = [
  { icon: ShoppingBag, title: 'Sell on iConnect Market', text: 'List products with photos and stock, accept secure online payments, and manage your orders.' },
  { icon: Megaphone, title: 'Advertise in the feed', text: 'Choose an ad package in your local currency. Ads are reviewed, then shown in the home feed as Sponsored.' },
  { icon: Briefcase, title: 'Hire through iConnect Jobs', text: 'Post job openings with your company details and reach people looking for work.' },
  { icon: CreditCard, title: 'Grow with Premium', text: 'Publisher plans raise your monthly limits for jobs, products, listings and videos.' },
]

const trust = [
  { icon: BadgeCheck, title: 'Verified sign-up', text: 'Every account confirms its email address before joining.' },
  { icon: Eye, title: 'You control your visibility', text: 'Hide your profile from Connect or leave people search whenever you like.' },
  { icon: LockKeyhole, title: 'Secure payments', text: 'Paystack and Stripe handle checkout, so we never see or store your card details.' },
  { icon: ShieldCheck, title: 'Moderated platform', text: 'Our team reviews ads before they run and can remove harmful content.' },
]

function SocialPreview() {
  return (
    <div className="home-preview-card">
      <div className="home-preview-top">
        <div className="home-preview-title"><span className="footer-online-dot" /> your little corner</div>
        <span className="preview-label">YOUR HOME FEED</span>
      </div>
      <div className="stories-row">
        {people.map((person, index) => (
          <div className="story-item" key={person.name}>
            <span className={`story-avatar story-ring ring-${index + 1}`}><Avatar person={person} /></span>
            <span>{person.name.toLowerCase()}</span>
          </div>
        ))}
      </div>
      <article className="home-feed-post">
        <div className="feed-post-head">
          <Avatar person={people[2]} />
          <div><strong>jules' little corner</strong><span>10 minutes ago · out for a walk</span></div>
          <span className="post-more">···</span>
        </div>
        <div className="home-feed-image">
          <img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=900&q=85" alt="Sunlight shining through a green forest" />
        </div>
        <p>took the long way home. always take the long way home. 🌿</p>
        <div className="feed-post-actions">
          <span><Heart size={14} /> 18</span>
          <span><MessageCircle size={14} /> 4 replies</span>
          <span className="post-seen">EXAMPLE POST</span>
        </div>
        <div className="home-reaction"><Heart size={17} fill="white" strokeWidth={0} /></div>
      </article>
      <div className="home-chat-note"><Avatar person={people[0]} /><span>needed this reminder today</span><Heart size={14} fill="#ff735e" strokeWidth={0} /></div>
      <p className="home-preview-disclaimer">Example of the iConnect home feed</p>
    </div>
  )
}

export default function HomePage() {
  return (
    <>
      <PageMeta
        title="Social network, chat, marketplace & jobs in one place"
        description="iConnect is a free social platform: share posts, chat privately, join communities, go live, buy and sell on the marketplace, find jobs, book stays and rides, and more with one account."
      />
      <section className="hero mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-8 px-6 py-12 md:grid-cols-2 md:px-10 md:py-16 xl:px-14">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> LIVE ON THE WEB · FREE TO JOIN</div>
          <h1>Your online worlds.<br />One <span className="underline-word">home.</span></h1>
          <p className="hero-intro">iConnect is a free social platform where you can share posts, chat privately, join communities, go live, buy and sell, and find work, all with one account. <em>Open now on the web.</em></p>
          <div className="hero-actions">
            <Link className="button-primary" to="/app/onboarding">Create your free account <ArrowRight size={17} /></Link>
            <Link className="text-link" to="/product"><span className="play-icon">↓</span> See what you can do</Link>
          </div>
          <div className="social-proof">
            <div className="proof-avatars">
              {people.slice(0, 3).map((person) => <Avatar key={person.name} person={person} />)}
              <span className="proof-plus">+</span>
            </div>
            <p><strong>One connected space</strong> for the things you do online</p>
          </div>
        </div>
        <div className="home-hero-art">
          <div className="home-art-glow" />
          <div className="home-art-ring home-art-ring-one" />
          <div className="home-art-ring home-art-ring-two" />
          <SocialPreview />
          <div className="home-art-float home-art-float-top"><span className="live-dot" /> made for real life</div>
          <div className="home-art-float home-art-float-bottom"><Avatar person={people[1]} /><span>your people, a little closer</span></div>
        </div>
        <Link to="/product" className="scroll-cue"><span>SEE WHAT’S LIVE</span><ArrowDown size={14} /></Link>
      </section>

      <div className="ticker" aria-label="What you can do on iConnect">
        <div className="ticker-track" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index}>FEED &amp; STORIES <b>•</b> PRIVATE CHAT <b>•</b> COMMUNITIES <b>•</b> LIVE VIDEO <b>•</b> MARKETPLACE <b>•</b> JOBS <b>•</b> STAYS &amp; RIDES <b>•</b> iCONNECT AI <b>•</b></span>
          ))}
        </div>
      </div>

      <section className="lp-facts reveal" aria-label="iConnect at a glance">
        {quickFacts.map((fact) => (
          <div key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>
        ))}
      </section>

      <section className="lp-section lp-divisions" id="features">
        <div className="lp-heading reveal">
          <div className="section-kicker"><span>01</span> EVERYTHING IN ONE ACCOUNT</div>
          <h2>One app for your<br /><span className="serif-italic">whole online life.</span></h2>
          <p>Most of us jump between a social app, a chat app, a marketplace and a job board every day. iConnect puts them together, so you keep one profile, one inbox and one set of people.</p>
        </div>
        <div className="lp-division-list">
          {divisions.map((division) => (
            <article className={`lp-division reveal ${division.tone}`} key={division.id} id={division.id}>
              <div className="lp-division-intro">
                <figure className="lp-division-photo"><img src={`https://images.unsplash.com/${division.image}?auto=format&fit=crop&w=900&h=520&q=75`} alt={division.imageAlt} loading="lazy" /></figure>
                <span className="lp-division-name">{division.name}</span>
                <h3>{division.title}</h3>
                <p>{division.description}</p>
                {division.note && <p className="lp-division-note">{division.note}</p>}
                <Link className="arrow-link" to="/app/onboarding">Get started free <span><ArrowUpRight size={17} /></span></Link>
              </div>
              <ul className="lp-feature-grid">
                {division.features.map(({ icon: Icon, name, text }) => (
                  <li key={name}>
                    <span className="lp-feature-icon"><Icon size={18} /></span>
                    <div><h4>{name}</h4><p>{text}</p></div>
                  </li>
                ))}
                {division.features.length === 1 && (
                  <li className="lp-feature-cta">
                    <div><h4>Try it free</h4><p>Create an account and ask iConnect AI your first question.</p></div>
                    <Link className="button-primary" to="/app/onboarding">Get started <ArrowRight size={15} /></Link>
                  </li>
                )}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-steps-section">
        <div className="lp-heading lp-heading-center reveal">
          <div className="section-kicker"><span>02</span> HOW IT WORKS</div>
          <h2>Up and running<br /><span className="serif-italic">in a minute.</span></h2>
        </div>
        <ol className="lp-steps">
          {steps.map(({ icon: Icon, title, text }, index) => (
            <li className="reveal" style={{ '--reveal-delay': `${index * 90}ms` }} key={title}>
              <span className="lp-step-number">{index + 1}</span>
              <span className="lp-step-icon"><Icon size={20} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className="lp-center-cta"><Link className="button-primary" to="/app/onboarding">Create your free account <ArrowRight size={17} /></Link></div>
      </section>

      <section className="home-communities-section">
        <div className="home-communities-inner">
          <div className="home-communities-heading">
            <div>
              <div className="section-kicker"><span>03</span> FIND YOUR PEOPLE</div>
              <h2>Every interest can<br />have <span className="serif-italic">a little corner.</span></h2>
            </div>
            <div>
              <p>From the songs on repeat to the long way home, members start and join communities around the things they genuinely enjoy.</p>
              <Link className="arrow-link" to="/communities">How communities work <span><ArrowUpRight size={17} /></span></Link>
            </div>
          </div>
          <div className="home-community-grid">
            {communities.slice(0, 3).map((community, index) => (
              <Link className={`home-community-card home-community-card-${index + 1} reveal`} style={{ '--reveal-delay': `${index * 90}ms` }} to="/communities" key={community.name}>
                <img src={`https://images.unsplash.com/${community.image}?auto=format&fit=crop&w=720&h=560&q=80`} alt="" loading="lazy" />
                <span className="home-community-index">IDEA TO START · 0{index + 1}</span>
                <span className="home-community-copy"><strong>{community.name}</strong><small>{community.description}</small></span>
                <ArrowUpRight className="home-community-arrow" size={18} />
              </Link>
            ))}
          </div>
          <p className="home-preview-note">Ideas for communities you could start. Members create their own after signing up.</p>
        </div>
      </section>

      <section className="lp-section lp-business">
        <div className="lp-heading reveal">
          <div className="section-kicker"><span>04</span> FOR CREATORS &amp; BUSINESSES</div>
          <h2>Reach people<br /><span className="serif-italic">where they already are.</span></h2>
          <p>Whether you run a shop, offer a service, or are hiring, iConnect gives you simple tools to be found by the people who use it every day.</p>
        </div>
        <figure className="lp-business-photo reveal"><img src="https://images.unsplash.com/photo-1556740758-90de374c12ad?auto=format&fit=crop&w=1400&h=560&q=75" alt="A shop owner serving a customer with a tablet at the counter" loading="lazy" /></figure>
        <div className="lp-card-grid">
          {forBusiness.map(({ icon: Icon, title, text }, index) => (
            <article className="lp-card reveal" style={{ '--reveal-delay': `${index * 70}ms` }} key={title}>
              <span className="lp-feature-icon"><Icon size={18} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-trust">
        <div className="lp-heading reveal">
          <div className="section-kicker"><span>05</span> SAFETY &amp; TRUST</div>
          <h2>Built to keep you<br /><span className="serif-italic">safe and in control.</span></h2>
        </div>
        <div className="lp-card-grid">
          {trust.map(({ icon: Icon, title, text }, index) => (
            <article className="lp-card lp-card-plain reveal" style={{ '--reveal-delay': `${index * 70}ms` }} key={title}>
              <span className="lp-feature-icon"><Icon size={18} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-values-section">
        <div className="home-values-inner">
          <div className="home-values-heading">
            <div className="section-kicker"><span>06</span> SOCIAL, WITH PEOPLE IN MIND</div>
            <h2>Connection over<br /><span className="serif-italic">comparison.</span></h2>
            <p>We want online spaces to feel more human, more intentional, and more like the conversations we value offline.</p>
          </div>
          <div className="home-values-list">
            {principles.map(({ title, description, icon: Icon }, index) => (
              <article className="home-value reveal" style={{ '--reveal-delay': `${index * 80}ms` }} key={title}>
                <span className="home-value-icon"><Icon size={18} /></span>
                <span className="home-value-number">0{index + 1}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-faq" id="faq">
        <div className="lp-faq-grid">
          <div className="lp-heading reveal">
            <div className="section-kicker"><span>07</span> QUESTIONS</div>
            <h2>Frequently asked<br /><span className="serif-italic">questions.</span></h2>
            <p>Can't find your answer here? Create a free account and ask iConnect AI, or explore the <Link to="/product">full feature list</Link>.</p>
          </div>
          <div className="lp-faq-list reveal">
            {faqs.map(({ question, answer }) => (
              <details key={question}>
                <summary><h3>{question}</h3><ChevronDown size={18} aria-hidden="true" /></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="home-next-step">
        <div>
          <span className="section-kicker"><span>08</span> OPEN NOW</span>
          <h2>Your people are<br /><span className="serif-italic">one sign-up away.</span></h2>
          <p>Create a free account in a minute, set up your profile, and start posting, chatting and exploring today.</p>
        </div>
        <Link className="button-dark" to="/app/onboarding">Create your free account <ArrowUpRight size={17} /></Link>
      </section>
    </>
  )
}
