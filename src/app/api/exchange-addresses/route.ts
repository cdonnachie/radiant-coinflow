import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
    try {
        const filePath = join(process.cwd(), 'public', 'data', 'exchange-addresses.json');
        const fileContents = readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContents);

        const { searchParams } = new URL(request.url);
        const address = searchParams.get('address');
        const exchange = searchParams.get('exchange');

        if (address) {
            for (const [exchangeId, exchangeData] of Object.entries(data.exchanges)) {
                const typed = exchangeData as { name: string; confidence: number; addresses: string[] };
                if (typed.addresses.includes(address)) {
                    return NextResponse.json({ found: true, address, exchange: { id: exchangeId, name: typed.name, confidence: typed.confidence } });
                }
            }
            for (const [poolId, poolData] of Object.entries(data.mining_pools || {})) {
                const typed = poolData as { name: string; confidence: number; addresses: string[] };
                if (typed.addresses.includes(address)) {
                    return NextResponse.json({ found: true, address, exchange: { id: poolId, name: typed.name, confidence: typed.confidence, type: 'mining_pool' } });
                }
            }
            for (const [serviceId, serviceData] of Object.entries(data.services || {})) {
                const typed = serviceData as { name: string; confidence: number; addresses: string[] };
                if (typed.addresses.includes(address)) {
                    return NextResponse.json({ found: true, address, exchange: { id: serviceId, name: typed.name, confidence: typed.confidence, type: 'service' } });
                }
            }
            return NextResponse.json({ found: false, address });
        }

        if (exchange) {
            const exchangeData = data.exchanges[exchange];
            if (exchangeData) return NextResponse.json({ exchange, ...exchangeData });
            return NextResponse.json({ error: 'Exchange not found' }, { status: 404 });
        }

        return NextResponse.json({
            version: data.version,
            lastUpdated: data.lastUpdated,
            totalExchanges: Object.keys(data.exchanges).length,
            totalAddresses: Object.values(data.exchanges).reduce((total, e: any) => total + e.addresses.length, 0),
            exchanges: Object.keys(data.exchanges),
            mining_pools: Object.keys(data.mining_pools || {}),
            services: Object.keys(data.services || {}),
        });
    } catch (error) {
        console.error('Error reading exchange addresses:', error);
        return NextResponse.json({ error: 'Failed to load exchange addresses' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { addresses } = body;

        if (!addresses || !Array.isArray(addresses)) {
            return NextResponse.json({ error: 'Invalid request. Expected array of addresses.' }, { status: 400 });
        }

        const filePath = join(process.cwd(), 'public', 'data', 'exchange-addresses.json');
        const fileContents = readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContents);

        const results = addresses.map((address: string) => {
            for (const [exchangeId, exchangeData] of Object.entries(data.exchanges)) {
                const typed = exchangeData as { name: string; confidence: number; addresses: string[] };
                if (typed.addresses.includes(address)) {
                    return { address, found: true, exchange: { id: exchangeId, name: typed.name, confidence: typed.confidence } };
                }
            }
            for (const [poolId, poolData] of Object.entries(data.mining_pools || {})) {
                const typed = poolData as { name: string; confidence: number; addresses: string[] };
                if (typed.addresses.includes(address)) {
                    return { address, found: true, exchange: { id: poolId, name: typed.name, confidence: typed.confidence, type: 'mining_pool' } };
                }
            }
            for (const [serviceId, serviceData] of Object.entries(data.services || {})) {
                const typed = serviceData as { name: string; confidence: number; addresses: string[] };
                if (typed.addresses.includes(address)) {
                    return { address, found: true, exchange: { id: serviceId, name: typed.name, confidence: typed.confidence, type: 'service' } };
                }
            }
            return { address, found: false };
        });

        return NextResponse.json({
            results,
            summary: {
                total: addresses.length,
                found: results.filter((r: any) => r.found).length,
                not_found: results.filter((r: any) => !r.found).length,
            },
        });
    } catch (error) {
        console.error('Error processing batch request:', error);
        return NextResponse.json({ error: 'Failed to process batch request' }, { status: 500 });
    }
}
