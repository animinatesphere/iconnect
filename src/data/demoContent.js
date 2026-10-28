export const demoPosts = [
  {
    id: 'jules-walk',
    name: 'Jules Morgan',
    handle: '@julesmorgan',
    avatar: 'photo-1531123897727-8f129e1688ce',
    location: 'Outside, eventually',
    time: '12 min',
    text: 'Took the long way home today. Ten out of ten, would get distracted by the trees again. 🌿',
    image: 'photo-1441974231531-c6227db76b6e',
    likes: 28,
    comments: 6,
    tag: 'A little moment',
  },
  {
    id: 'marcus-playlist',
    name: 'Marcus Lee',
    handle: '@marcusmakes',
    avatar: 'photo-1500648767791-00dcc994a43e',
    location: 'Currently on repeat',
    time: '38 min',
    text: 'Made a playlist for the walk you take when you need to figure something out. What song belongs on it?',
    image: null,
    likes: 16,
    comments: 9,
    tag: 'Music people',
  },
  {
    id: 'sofia-weekend',
    name: 'Sofia Martins',
    handle: '@sofiam',
    avatar: 'photo-1534528741775-53994a69daeb',
    location: 'Camera roll club',
    time: '1 hr',
    text: 'A few quiet things from the weekend. Keeping this feeling for Monday.',
    image: 'photo-1470252649378-9c29740c9fa8',
    likes: 42,
    comments: 12,
    tag: 'Weekend notes',
  },
]

export const demoConversations = [
  { id: 'sofia', name: 'Sofia Martins', avatar: 'photo-1534528741775-53994a69daeb', message: 'That photo you shared is so lovely', time: '9:41', unread: 2, online: true },
  { id: 'marcus', name: 'Marcus Lee', avatar: 'photo-1500648767791-00dcc994a43e', message: 'I have a playlist recommendation for you', time: 'Yesterday', unread: 0, online: true },
  { id: 'jules', name: 'Jules Morgan', avatar: 'photo-1531123897727-8f129e1688ce', message: 'See you in the reading nook?', time: 'Yesterday', unread: 0, online: false },
  { id: 'kai', name: 'Kai Bennett', avatar: 'photo-1506794778202-cad84cf45f1d', message: 'Thanks for the kind words!', time: 'Tue', unread: 0, online: false },
]

export const demoJobs = [
  { id: 1, title: 'Community Associate', company: 'Goodside Studio', location: 'Lagos, Nigeria · Hybrid', type: 'Full-time', color: 'bg-[#e6dff0]', initials: 'GS', match: 'Good fit for your interests' },
  { id: 2, title: 'Junior Product Designer', company: 'Common Ground', location: 'Remote · Africa', type: 'Full-time', color: 'bg-[#dce99a]', initials: 'CG', match: 'Shared by your community' },
  { id: 3, title: 'Social Media Coordinator', company: 'Open Palm', location: 'Abuja, Nigeria · On-site', type: 'Contract', color: 'bg-[#f3ded1]', initials: 'OP', match: 'Recently posted' },
]

export const demoPeople = [
  { id: 'sofia', name: 'Sofia Martins', handle: '@sofiam', avatar: 'photo-1534528741775-53994a69daeb', interests: 'Film photos · Slow mornings', note: 'Collecting little moments and good book recommendations.' },
  { id: 'marcus', name: 'Marcus Lee', handle: '@marcusmakes', avatar: 'photo-1500648767791-00dcc994a43e', interests: 'Music · Long walks', note: 'Making playlists for every kind of day.' },
  { id: 'jules', name: 'Jules Morgan', handle: '@julesmorgan', avatar: 'photo-1531123897727-8f129e1688ce', interests: 'Reading · The outdoors', note: 'Usually taking the scenic route.' },
]

export const demoInterests = ['Design', 'Music', 'Reading', 'Technology', 'Photography', 'Career growth', 'Wellness', 'Food', 'Outdoors', 'Film']

export const demoMessages = {
  sofia: [
    { from: 'them', text: 'Hey! I saw your photos from the weekend. That place looks so peaceful.' },
    { from: 'me', text: 'It really was. Found it by taking the long way home.' },
    { from: 'them', text: 'That is always the best way to find somewhere new.' },
  ],
  marcus: [
    { from: 'them', text: 'I have a playlist recommendation for you.' },
    { from: 'me', text: 'Always accepting playlist recommendations.' },
  ],
  jules: [
    { from: 'them', text: 'See you in the reading nook?' },
    { from: 'me', text: 'Would not miss it.' },
  ],
  kai: [
    { from: 'them', text: 'Thanks for the kind words!' },
    { from: 'me', text: 'You deserve them.' },
  ],
}
