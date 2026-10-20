export function frameable(headers: Headers | Record<string, string | string[] | undefined>): boolean;
export function isBlockedAddress(ip: string): boolean;
export function checkFrame(raw: string): Promise<{ status: number; body: { embeddable?: boolean; unreachable?: boolean; error?: string } }>;
