import { Analytics } from '@vercel/analytics/next';
import { AppProviders } from '@/components/providers/app-providers';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
export const metadata = {
    title: 'EscrowChain - Decentralized Freelance Escrow Platform',
    description: 'Secure, transparent, and AI-verified freelance payments powered by smart contracts',
    generator: 'v0.app',
    icons: {
        icon: [
            {
                url: '/icon-light-32x32.png',
                media: '(prefers-color-scheme: light)',
            },
            {
                url: '/icon-dark-32x32.png',
                media: '(prefers-color-scheme: dark)',
            },
            {
                url: '/icon.svg',
                type: 'image/svg+xml',
            },
        ],
        apple: '/apple-icon.png',
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
