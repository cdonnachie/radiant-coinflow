import { readFile } from 'fs/promises';
import { join } from 'path';
import { ImageResponse } from 'next/og';

export const alt = 'CoinFlow Explorer — Radiant Blockchain';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
    const logo = await readFile(join(process.cwd(), 'public', 'radiant.png'));
    const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    padding: '80px',
                    backgroundColor: '#25252C',
                    backgroundImage:
                        'radial-gradient(circle at 85% 15%, rgba(99, 102, 241, 0.25) 0%, transparent 50%), radial-gradient(circle at 10% 90%, rgba(56, 189, 248, 0.15) 0%, transparent 45%)',
                    color: '#ffffff',
                    fontFamily: 'sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoSrc} alt="" width={110} height={110} style={{ borderRadius: '24px' }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: '64px', fontWeight: 700, lineHeight: 1.1 }}>CoinFlow Explorer</div>
                        <div style={{ fontSize: '34px', color: '#a1a1aa', marginTop: '8px' }}>Radiant Blockchain</div>
                    </div>
                </div>
                <div
                    style={{
                        fontSize: '30px',
                        color: '#d4d4d8',
                        marginTop: '48px',
                        maxWidth: '900px',
                        lineHeight: 1.4,
                    }}
                >
                    Trace and visualize coin flow on the Radiant (RXD) blockchain — transaction outputs, fund
                    movements, and wallet clusters.
                </div>
            </div>
        ),
        size
    );
}
