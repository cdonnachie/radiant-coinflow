import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { AppHeader } from '@/components/AppHeader';
import './globals.css';

const sans = Space_Grotesk({
    subsets: ['latin'],
    variable: '--font-sans',
    display: 'swap',
});

const mono = IBM_Plex_Mono({
    subsets: ['latin'],
    variable: '--font-mono',
    weight: ['400', '500', '600'],
    display: 'swap',
});

export const metadata: Metadata = {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://coinflow.rxd.zone'),
    title: 'CoinFlow Explorer — Radiant Blockchain',
    description:
        'Trace and visualize coin flow on the Radiant (RXD) blockchain. Analyze transaction outputs, track fund movements, and explore wallet clusters.',
    keywords: ['Radiant', 'RXD', 'blockchain', 'coin flow', 'transaction analysis', 'UTXO', 'crypto explorer'],
    icons: {
        icon: [
            { url: '/radiant.ico', sizes: 'any' },
            { url: '/radiant.png', type: 'image/png' },
        ],
        apple: '/radiant.png',
    },
    openGraph: {
        title: 'CoinFlow Explorer — Radiant Blockchain',
        description: 'Trace and visualize coin flow on the Radiant (RXD) blockchain.',
        url: '/',
        siteName: 'CoinFlow Explorer',
        locale: 'en_US',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'CoinFlow Explorer — Radiant Blockchain',
        description: 'Trace and visualize coin flow on the Radiant (RXD) blockchain.',
    },
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#25252C' },
    ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${sans.variable} ${mono.variable}`}>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                    <div className="min-h-screen bg-background">
                        <AppHeader />
                        <main className="container max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 lg:py-12">{children}</main>
                        <footer className="border-t mt-16">
                            <div className="container max-w-7xl mx-auto px-4 py-8 text-center text-xs font-mono text-muted-foreground sm:px-6 lg:px-8">
                                <p>
                                    CoinFlow Explorer •{' '}
                                    <a
                                        href="https://radiantblockchain.org"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-foreground underline underline-offset-4"
                                    >
                                        Radiant Blockchain
                                    </a>
                                    {' • '}
                                    <a
                                        href="https://radiantexplorer.com"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-foreground underline underline-offset-4"
                                    >
                                        Block Explorer
                                    </a>
                                </p>
                            </div>
                        </footer>
                    </div>
                    <Toaster position="bottom-right" richColors />
                </ThemeProvider>
            </body>
        </html>
    );
}
