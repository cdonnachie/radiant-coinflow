'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Moon, Sun, Github } from 'lucide-react';
import { useTheme } from 'next-themes';

export function AppHeader() {
    const { theme, setTheme } = useTheme();

    return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-14 items-center gap-4 max-w-7xl mx-auto px-4">
                <Link href="/" className="flex items-center gap-2 font-semibold">
                    <Image src="/radiant.png" alt="Radiant" width={28} height={28} className="rounded-full" />
                    <span className="text-lg font-bold">
                        CoinFlow<span className="text-primary"> Explorer</span>
                    </span>
                </Link>

                <div className="flex-1" />

                <nav className="hidden md:flex items-center gap-1">
                    <Button variant="ghost" size="sm" asChild>
                        <Link href="/">Analyze</Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                        <Link href="/pools">Pools</Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                        <a
                            href="https://radiantblockchain.org"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Radiant Blockchain
                        </a>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                        <a
                            href="https://radiantexplorer.com"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Block Explorer
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
        </header>
    );
}
