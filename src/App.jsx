import React, { useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Heart,
  Menu,
  MessageCircle,
  Plus,
  Send,
  X,
} from 'lucide-react'

const people = [
  { name: 'Sofia', image: 'photo-1534528741775-53994a69daeb', tone: 'avatar-peach', delay: '0s' },
  { name: 'Marcus', image: 'photo-1500648767791-00dcc994a43e', tone: 'avatar-blue', delay: '-2s' },
  { name: 'Jules', image: 'photo-1531123897727-8f129e1688ce', tone: 'avatar-lilac', delay: '-4s' },
  { name: 'Kai', image: 'photo-1506794778202-cad84cf45f1d', tone: 'avatar-yellow', delay: '-1s' },
]

const spaces = [
  {
    name: 'Outside, eventually',
    description: 'For fresh air fans and slow walkers.',
    image: 'photo-1470770841072-f978cf4d019e',
    className: 'space-lake',
  },
  {
    name: 'Camera roll club',
    description: 'Little snapshots, no perfect angles.',
    image: 'photo-1470252649378-9c29740c9fa8',
    className: 'space-photo',
  },
  {
    name: 'The reading nook',
    description: 'One more chapter, one more opinion.',
    image: 'photo-1507842217343-583bb7270b66',
    className: 'space-books',
  },
  {
    name: 'Currently on repeat',
    description: 'Trade songs, playlists, and feelings.',
    image: 'photo-1516280440614-37939bbacd81',
    className: 'space-music',
  },
]

function Avatar({ person, className = '' }) {
  return (
    <img
      className={`avatar ${person.tone} ${className}`}
      src={`https://images.unsplash.com/${person.image}?auto=format&fit=crop&w=120&h=120&q=80`}
      alt={`${person.name}'s profile`}
    />
  )
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [joined, setJoined] = useState(false)

  function joinWaitlist(event) {
    event.preventDefault()
    if (email.trim()) setJoined(true)
  }

  return (
    <main>
      <nav className="nav-wrap" aria-label="Main navigation">
        <a className="brand" href="#home" aria-label="iConnect home">
          <span className="brand-mark"><span /></span>
          iconnect<span className="brand-period">.</span>
        </a>
        <div className={`nav-links ${menuOpen ? 'nav-links-open' : ''}`}>
          <a href="#why" onClick={() => setMenuOpen(false)}>Why iConnect</a>
          <a href="#moments" onClick={() => setMenuOpen(false)}>The good stuff</a>
          <a href="#community" onClick={() => setMenuOpen(false)}>Community</a>
          <a className="nav-mobile-cta" href="#join" onClick={() => setMenuOpen(false)}>Get early access <ArrowRight size={15} /></a>
        </div>
        <a className="nav-cta" href="#join">Get early access <ArrowUpRight size={15} /></a>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </nav>

      <section className="hero" id="home">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> YOUR CORNER OF THE INTERNET</div>
          <h1>Less scrolling.<br />More <span className="underline-word">soul.</span></h1>
          <p className="hero-intro">The internet feels better when it feels like <em>your people.</em> Meet your new favorite little place to be.</p>
          <div className="hero-actions">
            <a className="button-primary" href="#join">Find your people <ArrowRight size={17} /></a>
            <a className="text-link" href="#why"><span className="play-icon">▶</span> Take a little look</a>
          </div>
          <div className="social-proof">
            <div className="proof-avatars">
              {people.slice(0, 3).map((person) => <Avatar key={person.name} person={person} />)}
              <span className="proof-plus">+</span>
            </div>
            <p><strong>2,400+</strong> lovely humans are already here</p>
          </div>
        </div>

        <div className="hero-art" aria-label="A preview of friends sharing a moment on iConnect">
          <div className="art-glow" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-dot orbit-dot-one" />
          <div className="orbit-dot orbit-dot-two" />
          <div className="orbit-dot orbit-dot-three" />

          <div className="floating-label label-now"><span className="live-dot" /> your people are here</div>

          <div className="post-card">
            <div className="post-top">
              <Avatar person={people[0]} />
              <div><strong>sofia m.</strong><span>in her happy place · 2m</span></div>
              <span className="post-more">···</span>
            </div>
            <div className="post-photo">
              <img src="https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=760&q=85" alt="Golden morning light over a misty mountain landscape" />
              <span className="photo-tag"><Heart size={12} /> sunday kind of feeling</span>
            </div>
            <div className="post-caption"><strong>sofia m.</strong> found a little quiet spot above the clouds ☁️</div>
            <div className="post-actions">
              <span><Heart size={16} fill="#ff735e" strokeWidth={0} /> 28</span>
              <span><MessageCircle size={16} /> 6 little notes</span>
              <Send className="share-icon" size={16} />
            </div>
            <div className="reaction-pop"><Heart size={18} fill="white" strokeWidth={0} /></div>
          </div>

          <div className="floating-label label-reply">
            <Avatar person={people[1]} />
            <div><strong>marcus</strong><span>this is everything 🥹</span></div>
            <Heart size={16} fill="#ff735e" strokeWidth={0} />
          </div>
          <div className="floating-label label-mood"><span className="mood-dot" /><span>good energy only</span></div>
          <div className="floating-person person-one"><Avatar person={people[2]} /><span className="person-ping" /></div>
          <div className="floating-person person-two"><Avatar person={people[3]} /><span className="person-ping" /></div>
          <div className="hand-drawn-arrow">↗</div>
        </div>
        <a href="#why" className="scroll-cue"><span>SCROLL A LITTLE</span><ArrowDown size={14} /></a>
        <div className="hero-side-note">A SOCIAL SPACE, WITH A LITTLE MORE HEART</div>
      </section>

      <div className="ticker" aria-label="Make room for good things">
        <div className="ticker-track" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index}>MAKE ROOM FOR GOOD THINGS <b>•</b> YOUR PEOPLE, YOUR PACE <b>•</b> THE INTERNET, BUT NICER <b>•</b></span>
          ))}
        </div>
      </div>

      <section className="intro-section section-pad" id="why">
        <div className="section-kicker"><span>01</span> A DIFFERENT KIND OF FEED</div>
        <div className="intro-grid">
          <h2>Not more internet.<br />More <span className="serif-italic">in it.</span></h2>
          <div className="intro-copy">
            <p>Somewhere between the hot takes and the humblebrags, the internet forgot it could just be <strong>fun.</strong></p>
            <p>So we made a place for the little moments, the inside jokes, and the people who just <em>get you.</em></p>
            <a className="arrow-link" href="#moments">A little more about us <span><ArrowUpRight size={17} /></span></a>
          </div>
        </div>
        <div className="feature-cards" id="moments">
          <article className="feature-card card-lime">
            <div className="card-icon icon-doodle">☺</div>
            <span className="card-number">01 / YOUR FEED</span>
            <h3>Good stuff,<br />not just more stuff.</h3>
            <p>A feed that feels like your group chat, not a second job.</p>
          </article>
          <article className="feature-card card-lilac">
            <div className="card-icon"><MessageCircle size={22} /></div>
            <span className="card-number">02 / YOUR PEOPLE</span>
            <h3>Find your<br />kind of weird.</h3>
            <p>Little communities for the things you could talk about forever.</p>
            <div className="mini-avatars">{people.map((person) => <Avatar key={person.name} person={person} />)}</div>
          </article>
          <article className="feature-card card-peach">
            <div className="card-icon"><Heart size={22} /></div>
            <span className="card-number">03 / YOUR PACE</span>
            <h3>Come as you<br />are. Log off too.</h3>
            <p>No streaks. No pressure. Just a little more human connection.</p>
            <div className="card-scribble">take your<br />sweet time <span>↘</span></div>
          </article>
        </div>
      </section>

      <section className="social-preview-section" aria-labelledby="social-preview-title">
        <div className="social-preview-copy">
          <div className="section-kicker"><span>02</span> THE LITTLE THINGS ADD UP</div>
          <h2 id="social-preview-title">A feed is nice.<br /><span className="serif-italic">A feeling is better.</span></h2>
          <p>Catch up on a friend’s day, jump into a conversation, or just leave a little heart. The best parts happen between the posts.</p>
          <a className="arrow-link" href="#join">Come be part of it <span><ArrowUpRight size={17} /></span></a>
        </div>
        <div className="social-window" aria-label="Preview of stories, a post, and a conversation">
          <div className="social-window-top">
            <div className="window-brand"><span className="brand-mark"><span /></span> your little corner</div>
            <div className="online-count"><span className="live-dot" /> 4 friends around</div>
          </div>
          <div className="stories-row">
            <div className="story-item story-add"><span className="story-avatar story-plus"><Avatar person={people[3]} /><i><Plus size={12} /></i></span><span>your day</span></div>
            {people.slice(0, 3).map((person, index) => (
              <div className="story-item" key={person.name}>
                <span className={`story-avatar story-ring ring-${index + 1}`}><Avatar person={person} /></span>
                <span>{person.name.toLowerCase()}</span>
              </div>
            ))}
          </div>
          <div className="feed-post">
            <div className="feed-post-head"><Avatar person={people[2]} /><div><strong>jules' little corner</strong><span>10 minutes ago · out for a walk</span></div><span className="post-more">···</span></div>
            <div className="feed-post-photo"><img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=85" alt="Sunlight shining through a green forest" loading="lazy" /></div>
            <p className="feed-post-caption">took the long way home. always take the long way home. 🌿</p>
            <div className="feed-post-actions"><span><Heart size={14} /> 18</span><span><MessageCircle size={14} /> 4 replies</span><span className="post-seen">seen by your people</span></div>
            <div className="like-float"><Heart size={16} fill="white" strokeWidth={0} /></div>
          </div>
          <div className="chat-pop chat-pop-one"><Avatar person={people[0]} /><span>needed this reminder today</span><Heart size={14} fill="#ff735e" strokeWidth={0} /></div>
          <div className="chat-pop chat-pop-two"><span className="typing-dots"><i /><i /><i /></span><span>marcus is writing back</span></div>
          <div className="social-window-footer"><span className="footer-online-dot" /> your people make this place</div>
        </div>
      </section>

      <section className="community-section" id="community">
        <div className="community-copy">
          <div className="section-kicker"><span>02</span> THE GOOD KIND OF SOCIAL</div>
          <h2>Small moments.<br /><span className="serif-italic">Big feeling.</span></h2>
          <p>Share the half-baked thought. The too-many-photos weekend. The song you can't stop playing. It all belongs here.</p>
          <a href="#join" className="button-dark">Sounds like my place <ArrowRight size={17} /></a>
        </div>
        <div className="moment-stack">
          <div className="moment-note note-one"><span className="note-emoji">🎧</span><div><strong>currently listening to</strong><span>the song that fixes everything</span></div><span className="note-heart">♡</span></div>
          <div className="moment-note note-two"><span className="note-emoji">📸</span><div><strong>little photo dump</strong><span>things that made this week softer</span></div><span className="note-heart">♡</span></div>
          <div className="moment-note note-three"><Avatar person={people[2]} /><div><strong>jules' tiny corner</strong><span>for people who love a long walk</span></div><ArrowUpRight size={17} /></div>
          <div className="moment-circle"><span>made for<br />the moments<br />in between</span><i>♡</i></div>
        </div>
      </section>

      <section className="spaces-section section-pad" id="spaces">
        <div className="section-kicker"><span>03</span> THERE'S A CORNER FOR THAT</div>
        <div className="spaces-heading">
          <div>
            <h2>Find your kind<br />of <span className="serif-italic">corner.</span></h2>
            <p>Big passion, tiny niche, or just a passing phase. Start with what you love and see who else shows up.</p>
          </div>
          <a className="arrow-link spaces-link" href="#join">Come find your people <span><ArrowUpRight size={17} /></span></a>
        </div>
        <div className="spaces-grid">
          {spaces.map((space, index) => (
            <a className={`space-card ${space.className}`} href="#join" aria-label={`Get early access to ${space.name}`} key={space.name}>
              <img src={`https://images.unsplash.com/${space.image}?auto=format&fit=crop&w=720&h=560&q=85`} alt="" loading="lazy" />
              <span className="space-index">0{index + 1} / A LITTLE COMMUNITY</span>
              <div className="space-card-copy">
                <h3>{space.name}</h3>
                <p>{space.description}</p>
              </div>
              <ArrowUpRight className="space-arrow" size={18} />
            </a>
          ))}
        </div>
        <div className="good-social">
          <div className="good-social-heading">
            <span className="section-kicker"><span>04</span> A SMALL PROMISE</span>
            <h3>Social should feel<br />like <span className="serif-italic">being social.</span></h3>
          </div>
          <div className="good-social-points">
            <div><span className="principle-number">01</span><p><strong>People over performance.</strong> Show up as yourself, not a carefully edited version of yourself.</p></div>
            <div><span className="principle-number">02</span><p><strong>Connection over competition.</strong> Make room for conversations, not follower counts.</p></div>
            <div><span className="principle-number">03</span><p><strong>Your time is yours.</strong> Drop in when you want. Put your phone down when you don't.</p></div>
          </div>
        </div>
      </section>

      <section className="join-section" id="join">
        <div className="join-orbit join-orbit-a" />
        <div className="join-orbit join-orbit-b" />
        <div className="join-content">
          <div className="join-kicker"><span className="live-dot" /> GOOD THINGS ARE GATHERING</div>
          <h2>Your people<br />are <span className="serif-italic">out there.</span></h2>
          <p>Get on the list. We'll save you a spot and send a little hello when we're ready.</p>
          <form className="join-form" onSubmit={joinWaitlist}>
            <label className="sr-only" htmlFor="email">Your email address</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" required />
            <button type="submit">{joined ? 'You’re on the list!' : 'Save me a spot'} <ArrowRight size={17} /></button>
          </form>
          <span className="join-note">{joined ? 'Thanks for your interest in iConnect.' : 'No spam, no weird stuff. Pinky promise.'}</span>
        </div>
        <div className="join-avatars">{people.map((person) => <Avatar key={person.name} person={person} />)}</div>
      </section>

      <footer className="footer">
        <a className="brand" href="#home" aria-label="iConnect home"><span className="brand-mark"><span /></span>iconnect<span className="brand-period">.</span></a>
        <span className="footer-note">Made for humans, by humans <span>♡</span></span>
        <div className="footer-links"><a href="#why">Our little idea</a><a href="#community">Say hello</a><span>© 2025 iConnect social</span></div>
      </footer>
    </main>
  )
}

export default App
