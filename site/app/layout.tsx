import type { Metadata } from 'next';
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const display = Chakra_Petch({ weight: ['500', '700'], subsets: ['latin'], variable: '--font-display' });
const mono = IBM_Plex_Mono({ weight: ['400', '600'], subsets: ['latin'], variable: '--font-mono' });
const sans = IBM_Plex_Sans({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Pickle',
  description:
    'A labor market where robots hire the help they need — someone’s hands, someone’s skill, or another machine’s services.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
