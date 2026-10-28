import { api } from '@/lib/api/client';

// Placeholder home page: proves the web app talks to the API Gateway.
// The real shop and admin dashboard are built on top of this.
export const dynamic = 'force-dynamic';

interface Health {
  status: string;
  services: Record<string, { status: string; latencyMs?: number }>;
}

export default async function Home() {
  const [{ data: health }, { data: products }] = await Promise.all([
    api.GET('/api/v1/health').catch(() => ({ data: undefined })),
    api.GET('/api/v1/products', { params: { query: { page: 1, limit: 6 } } }).catch(() => ({ data: undefined })),
  ]);
  const h = health as Health | undefined;
  const list = (products as { data?: { id: string; name: string; price: number; stock: number }[] } | undefined)?.data ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 font-sans">
      <h1 className="text-3xl font-bold">E-Commerce</h1>
      <p className="mt-2 text-gray-500">Next.js web app connected to the API Gateway.</p>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Services</h2>
        {h ? (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(h.services).map(([name, s]) => (
              <li key={name} className="rounded-lg border px-3 py-2">
                <span className={s.status === 'up' ? 'text-green-600' : 'text-red-600'}>●</span> {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-red-600">API Gateway unreachable — is `docker compose up` running?</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Latest products</h2>
        {list.length ? (
          <ul className="mt-3 divide-y rounded-lg border">
            {list.map((p) => (
              <li key={p.id} className="flex justify-between px-4 py-3">
                <span>{p.name}</span>
                <span className="text-gray-500">
                  ${p.price.toFixed(2)} · {p.stock} in stock
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-gray-500">No products yet.</p>
        )}
      </section>
    </main>
  );
}
