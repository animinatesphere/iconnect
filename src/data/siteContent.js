import {
  Brain,
  Briefcase,
  Heart,
  Home,
  MessageCircle,
  Send,
  Users,
} from 'lucide-react'

export const people = [
  { name: 'Sofia', image: 'photo-1534528741775-53994a69daeb' },
  { name: 'Marcus', image: 'photo-1500648767791-00dcc994a43e' },
  { name: 'Jules', image: 'photo-1531123897727-8f129e1688ce' },
  { name: 'Kai', image: 'photo-1506794778202-cad84cf45f1d' },
]

export const communities = [
  {
    name: 'Outside, eventually',
    description: 'For fresh-air fans, slow walkers, and scenic detours.',
    image: 'photo-1470770841072-f978cf4d019e',
    className: 'space-lake',
    members: 'For the long way home',
  },
  {
    name: 'Camera roll club',
    description: 'Little snapshots, no perfect angles required.',
    image: 'photo-1470252649378-9c29740c9fa8',
    className: 'space-photo',
    members: 'A place for everyday moments',
  },
  {
    name: 'The reading nook',
    description: 'One more chapter, one more very important opinion.',
    image: 'photo-1507842217343-583bb7270b66',
    className: 'space-books',
    members: 'Readers welcome',
  },
  {
    name: 'Currently on repeat',
    description: 'Trade songs, playlists, and the feelings in between.',
    image: 'photo-1516280440614-37939bbacd81',
    className: 'space-music',
    members: 'For what you are listening to',
  },
]

export const productAreas = [
  {
    name: 'A home for your feed',
    description: 'Bring updates and communities you care about into one considered place.',
    icon: Home,
    status: 'Web product direction',
  },
  {
    name: 'One inbox',
    description: 'A simpler way to keep up with conversations across supported services.',
    icon: MessageCircle,
    status: 'Planned capability',
  },
  {
    name: 'Create and share',
    description: 'Draft a post, shape a caption, and choose where you want to share it.',
    icon: Send,
    status: 'Planned capability',
  },
  {
    name: 'Work opportunities',
    description: 'Explore roles, save opportunities, and get ready to apply.',
    icon: Briefcase,
    status: 'Long-term vision',
  },
  {
    name: 'People and communities',
    description: 'Find new connections, shared interests, and spaces that feel like yours.',
    icon: Users,
    status: 'Web-first exploration',
  },
  {
    name: 'AI and money tools',
    description: 'AI assistance, wallets, and savings tools are ideas for future phases.',
    icon: Brain,
    status: 'Exploratory; not available',
  },
]

export const principles = [
  {
    title: 'People over performance.',
    description: 'Show up as yourself, not a carefully edited version of yourself.',
    icon: Heart,
  },
  {
    title: 'Connection over competition.',
    description: 'Make room for conversations, not follower counts.',
    icon: MessageCircle,
  },
  {
    title: 'Your time is yours.',
    description: "Drop in when you want. Put your phone down when you don't.",
    icon: Home,
  },
]
