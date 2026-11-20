import {
  Bot,
  Briefcase,
  CreditCard,
  Heart,
  Home,
  Megaphone,
  MessageCircle,
  PiggyBank,
  Plane,
  Radio,
  ShoppingBag,
  Smartphone,
  TrendingUp,
  Users,
  WalletCards,
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

// What members can use today vs. what is still being built. Keep this honest.
export const productAreas = [
  { name: 'Home feed & stories', description: 'Share posts and photos, react, comment, save posts, and post 24-hour status updates.', icon: Home, status: 'Live' },
  { name: 'Private chat', description: 'One-to-one messages with photos and voice notes.', icon: MessageCircle, status: 'Live' },
  { name: 'People & communities', description: 'Follow people, start or join communities around what you love.', icon: Users, status: 'Live' },
  { name: 'Live video & video hub', description: 'Go live with your camera, chat with viewers, and upload videos.', icon: Radio, status: 'Live' },
  { name: 'iConnect Market', description: 'Buy and sell products, local listings, homes and services, with secure checkout.', icon: ShoppingBag, status: 'Live' },
  { name: 'Jobs', description: 'Post and discover job opportunities.', icon: Briefcase, status: 'Live' },
  { name: 'iBook stays & rides', description: 'List or request rooms, apartments and local rides from other members.', icon: Plane, status: 'Live' },
  { name: 'iConnect Date', description: 'Meet new people with a dedicated dating profile and inbox.', icon: Heart, status: 'Live' },
  { name: 'iConnect AI', description: 'An AI assistant to help you write, plan and find answers.', icon: Bot, status: 'Live' },
  { name: 'Premium & Ads', description: 'Publisher plans with higher posting limits, and paid ads to promote your business in the feed.', icon: Megaphone, status: 'Live' },
  { name: 'Ajo savings plans', description: 'Set a savings goal, contribution and schedule, and track your progress.', icon: PiggyBank, status: 'Live' },
  { name: 'iConnect Trade (practice)', description: 'A paper-trading desk with strict risk rules, for practising FX trades without real money.', icon: TrendingUp, status: 'Live · practice mode' },
  { name: 'Wallet & payments', description: 'Account numbers, balances and transfers, being set up with a licensed payments partner.', icon: WalletCards, status: 'Coming soon' },
  { name: 'Invest', description: 'Investment tools, once the right regulated partners are in place.', icon: CreditCard, status: 'Coming soon' },
  { name: 'Mobile apps', description: 'Android and iPhone apps, built on what members use most on the web.', icon: Smartphone, status: 'Coming soon' },
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

// Shown on the home page and mirrored in the FAQPage structured data in index.html.
// Keep both in sync, and keep every answer true.
export const faqs = [
  {
    question: 'What is iConnect?',
    answer: 'iConnect is a social platform that brings your social feed, private chat, communities, live video, an online marketplace, jobs, stays and rides, dating and an AI assistant into one free account on the web.',
  },
  {
    question: 'Is iConnect free to use?',
    answer: 'Yes. Creating an account and using the feed, chat, communities and most features is free. Optional paid extras include Premium publisher plans with higher posting limits, ads to promote your business, and dating extras.',
  },
  {
    question: 'Is there an iConnect mobile app?',
    answer: 'iConnect works today in the browser on any phone, tablet or computer. Android and iPhone apps are coming next, using the same account.',
  },
  {
    question: 'How do payments work on iConnect?',
    answer: 'Payments go through trusted providers: Paystack for naira payments and Stripe for other currencies. You pay on their secure checkout page, so iConnect never sees or stores your card details. Prices are shown in your local currency where available.',
  },
  {
    question: 'Can I sell, advertise or hire on iConnect?',
    answer: 'Yes. You can sell products on iConnect Market, list local items, homes and services, post job openings, and buy ad packages that show your business in the home feed after a quick review.',
  },
  {
    question: 'Does iConnect have a wallet?',
    answer: 'Not yet. A wallet with account numbers and transfers is being set up with a licensed payments partner. Today, iConnect Ajo lets you plan and track personal savings while your money stays in your own bank.',
  },
  {
    question: 'Who can see my profile?',
    answer: 'You decide. In your privacy settings you can hide your profile from Connect and remove yourself from people search, and these settings are enforced by iConnect for search and new conversations.',
  },
  {
    question: 'Is iConnect Trade real trading?',
    answer: 'iConnect Trade is a practice (paper) trading desk for FX with strict risk rules, such as a fixed stop-loss range and a minimum 2:1 reward-to-risk. It does not use real money and is not financial advice.',
  },
]
