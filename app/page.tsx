export const dynamic = "force-dynamic";
export const revalidate = 0; // must be 0 or false

import { loadDaily } from "@/lib/loadDaily";

export default async function HomePage() {
  let data;
  try {
    data = await loadDaily();
  } catch (err) {
    return <p>Daily data unavailable</p>;
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Kenya Top 500</h1>
      <ul className="space-y-2">
        {data.items.map((item: any) => (
          <li key={item.channel_id}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {item.rank}. {item.channel_name}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
