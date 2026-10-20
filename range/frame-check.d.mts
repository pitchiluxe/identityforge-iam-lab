export function frameable(headers: Headers): boolean;
export function checkFrame(raw: string): Promise<{ status: number; body: { embeddable?: boolean; finalUrl?: string; status?: number; error?: string; unreachable?: boolean } }>;
