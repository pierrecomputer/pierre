import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <h1 className="text-3xl font-bold underline">Pierre JS!</h1>

      <ul>
        <li>
          Go to the{' '}
          <Link className="text-blue-500 underline" href="/docs">
            docs
          </Link>
        </li>
      </ul>
    </div>
  );
}
