import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SoundDrop Studio — Transfert P2P Acoustique, WebRTC & Multi-Protocoles Open-Source',
  description:
    'Station de transfert P2P zéro-connaissance combinant modulation acoustique ultrasonique/audible (ggwave ECC, SonicNet, Quiet-FSK), WebRTC DataChannels, OpenDrop, LocalSend, Syncthing, Magic-Wormhole et WebTorrent.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0A0A0C',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="font-sans antialiased bg-[#0A0A0C] text-[#F4F4F6] selection:bg-[#FF5500] selection:text-white">
        <a
          href="#main-content"
          className="visually-hidden focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#FF5500] focus:text-white focus:font-semibold focus:shadow-lg"
        >
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  );
}
