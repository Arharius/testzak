'use client';
import { useState } from 'react';

interface ProductSpec {
    product_name: string;
    specs: Record<string, string>;
    source: string;
}

export default function Home() {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<ProductSpec | null>(null);
    const [products, setProducts] = useState<ProductSpec[]>([]);
    const [error, setError] = useState<string | null>(null);

    const handleAddProduct = () => {
        if (result) {
            setProducts([...products, result]);
            setResult(null);
            setQuery('');
        }
    };

    const handleGenerate = async () => {
        try {
            const response = await fetch('http://localhost:8000/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(products),
            });

            if (!response.ok) throw new Error('Generation failed');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'generated_tz.docx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Generation failed');
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch('http://localhost:8000/api/scrape', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ product_name: query }),
            });

            if (!response.ok) {
                throw new Error('Failed to fetch data');
            }

            const data = await response.json();
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex min-h-screen flex-col items-center p-24 bg-gray-50 text-gray-900">
            <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex">
                <h1 className="text-4xl font-bold mb-8">ТЗ Generator Prototype</h1>
            </div>

            <div className="w-full max-w-md">
                <form onSubmit={handleSearch} className="flex gap-2 mb-8">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Enter product name (e.g. Logitech K120)"
                        className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                    >
                        {loading ? 'Searching...' : 'Search'}
                    </button>
                </form>

                {error && (
                    <div className="p-4 mb-4 text-red-700 bg-red-100 rounded-lg">
                        {error}
                    </div>
                )}

                {result && (
                    <div className="bg-white p-6 rounded-lg shadow-md w-full">
                        <h2 className="text-xl font-bold mb-4">{result.product_name}</h2>
                        <div className="text-xs text-gray-500 mb-4">Source: {result.source}</div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="border-b-2 p-2 font-semibold">Parameter</th>
                                        <th className="border-b-2 p-2 font-semibold">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(result.specs).map(([key, value]) => (
                                        <tr key={key} className="hover:bg-gray-50">
                                            <td className="border-b p-2 font-medium text-gray-700">{key}</td>
                                            <td className="border-b p-2 text-gray-600">{value}</td>
                                        </tr>
                                    ))}
                                    {Object.keys(result.specs).length === 0 && (
                                        <tr>
                                            <td colSpan={2} className="p-4 text-center text-gray-500">
                                                No specifications found (or mock data returned empty).
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <button
                            onClick={handleAddProduct}
                            className="mt-6 w-full py-2 border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 font-bold"
                        >
                            Добавить в ТЗ (Add to Document)
                        </button>
                    </div>
                )}

                {products.length > 0 && (
                    <div className="mt-8 bg-white p-6 rounded-lg shadow-md w-full border-t-4 border-green-500">
                        <h3 className="text-lg font-bold mb-4">Выбранные товары ({products.length})</h3>
                        <ul className="mb-6 space-y-2">
                            {products.map((p, idx) => (
                                <li key={idx} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                                    <span>{p.product_name}</span>
                                    <span className="text-xs bg-gray-200 px-2 py-1 rounded text-gray-600">
                                        {Object.keys(p.specs).length} specs
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <button
                            onClick={handleGenerate}
                            className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-lg"
                        >
                            Скачать ТЗ (.docx)
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
