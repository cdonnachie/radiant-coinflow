'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { ExternalLink, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const primaryLinks = [
    { href: '/', label: 'Analyze' },
    { href: '/pools', label: 'Pool activity' },
    { href: '/token', label: 'Token journey' },
    { href: '/about', label: 'About' },
];

export function AppHeader() {
    const { theme, setTheme } = useTheme();

    return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-md">
            <div className="container flex h-16 items-center gap-4 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <Link href="/" className="flex min-w-0 items-center gap-3 font-semibold" aria-label="CoinFlow Explorer home">
                    <Image src="/radiant.png" alt="" width={30} height={30} className="rounded" />
                    <span className="min-w-0 leading-tight">
                        <span className="block truncate text-sm font-bold">CoinFlow Explorer</span>
                        <span className="block truncate font-mono text-[10px] font-normal uppercase text-muted-foreground">
                            Radiant network utility
                        </span>
                    </span>
                </Link>

                <div className="flex-1" />

                <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
                    {primaryLinks.map((link) => (
                        <Button key={link.href} variant="ghost" size="sm" asChild>
                            <Link href={link.href}>{link.label}</Link>
                        </Button>
                    ))}
                    <Button variant="ghost" size="sm" asChild className="hidden lg:inline-flex">
                        <a
                            href="https://radiantcore.org"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Network <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </Button>
                    <Button variant="ghost" size="sm" asChild className="hidden xl:inline-flex">
                        <a
                            href="https://radiantexplorer.com"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Blocks <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </Button>
                </nav>

                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    aria-label="Toggle theme"
                >
                    <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                </Button>
            </div>
            <nav className="no-scrollbar flex overflow-x-auto border-t px-3 md:hidden" aria-label="Mobile navigation">
                {primaryLinks.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        className="whitespace-nowrap border-r px-3 py-2.5 font-mono text-[11px] font-medium uppercase text-muted-foreground first:border-l hover:bg-accent hover:text-foreground"
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>
        </header>
    );
}
