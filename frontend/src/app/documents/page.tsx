'use client';
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';

interface Document {
    id: number;
    title: string;
    metadata: {
        product_title: string;
        zakazchik: string;
        quantity: number;
    };
    created_at: string;
}

export default function DocumentsPage() {
    const { user, token } = useAuth();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (token) {
            fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/documents`, {
                headers: { Authorization: `Bearer ${token}` }
            })
                .then(res => res.json())
                .then(data => {
                    if (Array.isArray(data)) setDocuments(data);
                })
                .finally(() => setLoading(false));
        }
    }, [token]);

    const handleDelete = async (id: number) => {
        if (!confirm('Вы уверены, что хотите удалить этот документ?')) return;
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/documents/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setDocuments(prev => prev.filter(d => d.id !== id));
            }
        } catch (e) {
            console.error(e);
        }
    };

    // Function to download existing doc by re-generating it on backend
    // Since we don't store the binary, we might need a re-generate endpoint or store the doc.
    // Ideally we store the structured data and generate on fly. 
    // For now, let's assume we can re-open it in the main editor (future feature)
    // or just list them.

    return (
        <main className="min-h-screen bg-slate-950 text-slate-200 p-8">
            <div className="max-w-4xl mx-auto">
                <header className="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
                    <h1 className="text-2xl font-bold text-white">🗄️ Мои документы</h1>
                    <Link href="/" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
                        ← Создать новый
                    </Link>
                </header>

                {loading ? (
                    <p className="text-slate-400">Загрузка документов...</p>
                ) : documents.length === 0 ? (
                    <div className="text-center py-12 bg-slate-900/50 rounded-xl border border-slate-800">
                        <p className="text-slate-400 mb-4">У вас пока нет сохраненных документов</p>
                        <Link href="/" className="text-blue-400 hover:underline font-medium">
                            Создать первое ТЗ
                        </Link>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {documents.map(doc => (
                            <div key={doc.id} className="p-4 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center hover:border-blue-500/30 transition">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-100">{doc.title}</h3>
                                    <div className="text-sm text-slate-400 mt-1 flex gap-4">
                                        <span>📦 {doc.metadata.product_title}</span>
                                        <span>👤 {doc.metadata.zakazchik}</span>
                                        <span>🔢 {doc.metadata.quantity} шт.</span>
                                    </div>
                                    <div className="text-xs text-slate-600 mt-1">
                                        Создано: {new Date(doc.created_at).toLocaleDateString()}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {/* Edit feature could go here */}
                                    <button
                                        onClick={() => handleDelete(doc.id)}
                                        className="p-2 text-red-400 hover:bg-red-900/20 rounded-lg transition"
                                        title="Удалить"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
