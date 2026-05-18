import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { AppHeader } from '@/components/AppHeader';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: 'CoinFlow Explorer — Avian Network',
    description:
        'Trace and visualize coin flow on the Avian (AVN) blockchain. Analyze transaction outputs, track fund movements, and explore wallet clusters.',
    keywords: ['Avian', 'AVN', 'blockchain', 'coin flow', 'transaction analysis', 'UTXO', 'crypto explorer'],
    icons: {
        icon: [
            { url: '/avian.ico', sizes: 'any' },
            { url: '/avian.png', type: 'image/png' },
        ],
        apple: '/avian.png',
    },
    openGraph: {
        title: 'CoinFlow Explorer — Avian Network',
        description: 'Trace and visualize coin flow on the Avian (AVN) blockchain.',
        type: 'website',
    },
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
    ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={inter.className}>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                    <div className="min-h-screen bg-background">
                        <AppHeader />
                        <main className="container max-w-7xl mx-auto px-4 py-6">{children}</main>
                        <footer className="border-t mt-12">
                            <div className="container max-w-7xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
                                <p>
                                    CoinFlow Explorer •{' '}
                                    <a
                                        href="https://avn.network"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-foreground underline underline-offset-4"
                                    >
                                        Avian Network
                                    </a>
                                    {' • '}
                                    <a
                                        href="https://flightpath.avn.network"
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
