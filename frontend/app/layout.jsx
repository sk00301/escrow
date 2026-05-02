import { Analytics } from '@vercel/analytics/next';
import { AppProviders } from '@/components/providers/app-providers';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
export const metadata = {
    title: 'Aegistra - Decentralized Freelance Escrow Platform',
    description: 'Secure, transparent, and AI-verified freelance payments powered by smart contracts',
    generator: 'v0.app',
    icons: {
        icon: [
            {
                url: '/Aegistra%20Logo%20small.png',
                media: '(prefers-color-scheme: light)',
            },
            {
                url: '/Aegistra%20Logo%20small.png',
                media: '(prefers-color-scheme: dark)',
            },
            {
                url: '/Aegistra%20Logo.png',
                type: 'image/png',
            },
        ],
        apple: '/Aegistra%20Logo%20small.png',
    },
};
export default function RootLayout({ children, }) {
    return (<html lang="en" className="dark">
      <body className="font-sans antialiased">
        <AppProviders>
          {children}
          <Toaster />
        </AppProviders>
        <Analytics />
      </body>
    </html>);
}
