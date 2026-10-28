import React from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Heart, Home, MessageCircle, Send, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import PageMeta from '../components/PageMeta.jsx'
import { communities, people, principles } from '../data/siteContent.js'

const socialFeatures = [
  {
    title: 'A home for your people',
    description: 'A thoughtful feed for everyday updates, shared interests, and the moments worth keeping.',
    label: 'YOUR HOME FEED',
    icon: Home,
    to: '/app/home',
  },
  {
    title: 'Find your corner',
    description: 'Discover communities and people around the things you love and the things you are learning.',
    label: 'PEOPLE & COMMUNITIES',
    icon: Users,
    to: '/communities',
  },
  {
    title: 'Make something yours',
    description: 'Shape a thought, add a photo, and share it with the people who will get it.',
    label: 'CREATE & SHARE',
    icon: Send,
    to: '/app/create',
  },
  {
    title: 'Keep conversations close',
    description: 'A welcoming place for the chats and replies that turn a post into a connection.',
    label: 'MESSAGES',
    icon: MessageCircle,
    to: '/app/chat',
  },
]

function SocialPreview() {
  return (
    <div className="home-preview-card">
      <div className="home-preview-top">
        <div className="home-preview-title"><span className="footer-online-dot" /> your little corner</div>
        <span className="preview-label">SOCIAL FEED CONCEPT</span>
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
          <span className="post-seen">A CONCEPT PREVIEW</span>
        </div>
        <div className="home-reaction"><Heart size={17} fill="white" strokeWidth={0} /></div>
      </article>
      <div className="home-chat-note"><Avatar person={people[0]} /><span>needed this reminder today</span><Heart size={14} fill="#ff735e" strokeWidth={0} /></div>
      <p className="home-preview-disclaimer">Illustrative interface · Not a live social feed</p>
    </div>
  )
}

export default function HomePage() {
  return (
    <>
      <PageMeta
        title="Your online worlds, one home"
        description="Discover iConnect: a web-first vision for bringing social feeds, conversations, content, and opportunities closer together."
      />
      <section className="hero mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-8 px-6 py-12 md:grid-cols-2 md:px-10 md:py-16 xl:px-14">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> A CONNECTED DIGITAL HOME, STARTING ON THE WEB</div>
          <h1>Your online worlds.<br />One <span className="underline-word">home.</span></h1>
          <p className="hero-intro">Bring your social life, conversations, creative work, and opportunities closer together. <em>iConnect starts on the web.</em></p>
          <div className="hero-actions">
            <Link className="button-primary" to="/app/onboarding">Join the iConnect preview <ArrowRight size={17} /></Link>
            <Link className="text-link" to="/app/login">Log in</Link>
            <Link className="text-link" to="/roadmap"><span className="play-icon">↓</span> See what's ahead</Link>
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
        <Link to="/product" className="scroll-cue"><span>EXPLORE THE PRODUCT</span><ArrowDown size={14} /></Link>
      </section>

      <div className="ticker" aria-label="iConnect product direction">
        <div className="ticker-track" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index}>YOUR ONLINE WORLD, MORE CONNECTED <b>•</b> WEBSITE FIRST, MOBILE LATER <b>•</b> SOCIAL, WORK, AND CONVERSATIONS <b>•</b></span>
          ))}
        </div>
      </div>

      <section className="home-intro-section section-pad">
        <div className="section-kicker"><span>01</span> LESS APP HOPPING, MORE FLOW</div>
        <div className="home-intro-grid">
          <h2>Your online life,<br />a little more <span className="serif-italic">together.</span></h2>
          <div className="intro-copy">
            <p>We use different apps to keep up, talk, share, and find opportunities. iConnect is being designed to bring more of that experience into <strong>one useful home.</strong></p>
            <p>The website is the first step. We’ll shape the mobile app after the web experience is underway.</p>
            <Link className="arrow-link" to="/product">Explore the product <span><ArrowUpRight size={17} /></span></Link>
          </div>
        </div>
      </section>

      <section className="home-social-section section-pad">
        <div className="home-social-heading">
          <div>
            <div className="section-kicker"><span>02</span> MADE FOR SHARING LIFE</div>
            <h2>More than a feed.<br /><span className="serif-italic">A place to belong.</span></h2>
          </div>
          <p>iConnect is being designed around the best parts of social: seeing what your people are up to, sharing your own moments, and finding a community that feels like yours.</p>
        </div>
        <div className="home-social-grid">
          {socialFeatures.map(({ title, description, label, icon: Icon, to }, index) => (
            <Link className={`home-social-card home-social-card-${index + 1}`} to={to} key={title}>
              <span className="home-social-card-top"><span><Icon size={20} /></span><small>0{index + 1}</small></span>
              <span className="home-social-label">{label}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="home-social-card-arrow" aria-hidden="true"><ArrowUpRight size={17} /></span>
            </Link>
          ))}
        </div>
        <p className="home-preview-note">Product direction preview · These features are being explored and are not live services.</p>
      </section>

      <section className="home-communities-section">
        <div className="home-communities-inner">
          <div className="home-communities-heading">
            <div>
              <div className="section-kicker"><span>03</span> FIND YOUR PEOPLE</div>
              <h2>Every interest can<br />have <span className="serif-italic">a little corner.</span></h2>
            </div>
            <div>
              <p>From the songs on repeat to the long way home, imagine small communities built around the things you genuinely enjoy.</p>
              <Link className="arrow-link" to="/communities">Explore community ideas <span><ArrowUpRight size={17} /></span></Link>
            </div>
          </div>
          <div className="home-community-grid">
            {communities.slice(0, 3).map((community, index) => (
              <Link className={`home-community-card home-community-card-${index + 1}`} to="/communities" key={community.name}>
                <img src={`https://images.unsplash.com/${community.image}?auto=format&fit=crop&w=720&h=560&q=80`} alt="" loading="lazy" />
                <span className="home-community-index">COMMUNITY CONCEPT · 0{index + 1}</span>
                <span className="home-community-copy"><strong>{community.name}</strong><small>{community.description}</small></span>
                <ArrowUpRight className="home-community-arrow" size={18} />
              </Link>
            ))}
          </div>
          <p className="home-preview-note">These are illustrative ideas, not active communities.</p>
        </div>
      </section>

      <section className="home-values-section">
        <div className="home-values-inner">
          <div className="home-values-heading">
            <div className="section-kicker"><span>04</span> SOCIAL, WITH PEOPLE IN MIND</div>
            <h2>Connection over<br /><span className="serif-italic">comparison.</span></h2>
            <p>We want online spaces to feel more human, more intentional, and more like the conversations we value offline.</p>
          </div>
          <div className="home-values-list">
            {principles.map(({ title, description, icon: Icon }, index) => (
              <article className="home-value" key={title}>
                <span className="home-value-icon"><Icon size={18} /></span>
                <span className="home-value-number">0{index + 1}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-next-step">
        <div>
          <span className="section-kicker"><span>05</span> A BIG IDEA, BUILT IN PHASES</span>
          <h2>Start with the web.<br /><span className="serif-italic">Grow with your needs.</span></h2>
          <p>First, a clear and useful website. Later, a focused web product. Mobile comes after the foundations are in place.</p>
        </div>
        <Link className="button-dark" to="/app/onboarding">Explore the user preview <ArrowUpRight size={17} /></Link>
      </section>
    </>
  )
}
