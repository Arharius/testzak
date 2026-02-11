'use client';
import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface SpecItem {
    name: string;
    value: string;
}

interface SpecGroup {
    group: string;
    specs: SpecItem[];
}

interface ProductSpec {
    product_name: string;
    specs: SpecGroup[] | Record<string, string>;
    source: string;
}

interface DocumentMetadata {
    product_title: string;
    zakazchik: string;
    quantity: number;
    quantity_text: string;
}

export default function Home() {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [result, setResult] = useState<ProductSpec | null>(null);
    const [products, setProducts] = useState<ProductSpec[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [metadata, setMetadata] = useState<DocumentMetadata>({
        product_title: '',
        zakazchik: '',
        quantity: 1,
        quantity_text: '',
    });
    const { user, token, logout } = useAuth();
    const router = useRouter();
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!user) { router.push('/login'); return; }

        const activeProducts = getActiveProducts();
        if (activeProducts.length === 0) { setError('Сначала найдите товар'); return; }
        if (!metadata.product_title) { setError('Укажите наименование объекта закупки'); return; }

        setSaving(true);
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/documents`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: metadata.product_title,
                    metadata,
                    products: activeProducts
                })
            });

            if (!res.ok) throw new Error('Ошибка сохранения');
            alert('Документ успешно сохранен!');
        } catch (e) {
            setError('Не удалось сохранить документ');
        } finally {
            setSaving(false);
        }
    };
    const handleAddProduct = () => {
        if (result) {
            setProducts([...products, result]);
            setResult(null);
            setQuery('');
            if (products.length === 0 && !metadata.product_title) {
                setMetadata(prev => ({ ...prev, product_title: result.product_name }));
            }
        }
    };

    const handleRemoveProduct = (index: number) => {
        setProducts(products.filter((_, i) => i !== index));
    };

    const getActiveProducts = (): ProductSpec[] => {
        // If we have products in the list, use those. Otherwise use current search result.
        if (products.length > 0) return products;
        if (result) return [result];
        return [];
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            const activeProducts = getActiveProducts();
            if (activeProducts.length === 0) { setError('Сначала найдите товар'); setGenerating(false); return; }
            const response = await fetch('http://localhost:8000/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    metadata: metadata,
                    products: activeProducts,
                }),
            });

            if (!response.ok) throw new Error('Ошибка генерации документа');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ТЗ_' + (metadata.product_title || 'документ') + '.docx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ошибка генерации');
        } finally {
            setGenerating(false);
        }
    };

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const buildSpecsTable = (product: ProductSpec) => {
            let rows = '';
            if (Array.isArray(product.specs)) {
                for (const group of product.specs) {
                    rows += `<tr><td colspan="3" style="font-weight:bold;padding:6px 8px;background:#f0f0f0;border:1px solid #000;">${group.group}</td></tr>`;
                    for (const spec of group.specs) {
                        // Simple extraction for print
                        let val = spec.value;
                        let unit = '';
                        const m1 = val.match(/^не менее\s+(\d+[.,]?\d*)\s*(.*)?$/i);
                        const m2 = val.match(/^не более\s+(\d+[.,]?\d*)\s*(.*)?$/i);
                        if (m1) { val = `≥${m1[1].replace('.', ',')}`; unit = m1[2] || ''; }
                        else if (m2) { val = `≤${m2[1].replace('.', ',')}`; unit = m2[2] || ''; }
                        rows += `<tr>
                            <td style="padding:4px 8px;border:1px solid #000;">${spec.name}</td>
                            <td style="padding:4px 8px;border:1px solid #000;">${val}</td>
                            <td style="padding:4px 8px;border:1px solid #000;">${unit}</td>
                        </tr>`;
                    }
                }
            }
            return rows;
        };

        const activeProducts = getActiveProducts();
        if (activeProducts.length === 0) return;

        const productTables = activeProducts.map(p => `
            <p style="text-align:center;font-weight:bold;margin:16px 0 8px;">${p.product_name}</p>
            <table style="width:100%;border-collapse:collapse;font-size:11px;font-family:'Times New Roman',serif;">
                <thead>
                    <tr style="background:#e6e6e6;">
                        <th style="padding:6px 8px;border:1px solid #000;text-align:center;font-size:10px;">Наименование характеристики</th>
                        <th style="padding:6px 8px;border:1px solid #000;text-align:center;font-size:10px;">Значение характеристики</th>
                        <th style="padding:6px 8px;border:1px solid #000;text-align:center;font-size:10px;">Единица измерения характеристики</th>
                    </tr>
                </thead>
                <tbody>${buildSpecsTable(p)}</tbody>
            </table>
        `).join('');

        const qtyDisplay = metadata.quantity_text
            ? `${metadata.quantity} (${metadata.quantity_text})`
            : `${metadata.quantity}`;

        const html = `<!DOCTYPE html>
        <html><head><title>ТЗ — ${metadata.product_title || 'документ'}</title>
        <style>
            @page { size: A4; margin: 1.5cm 1.5cm 1.5cm 2cm; }
            body { font-family: 'Times New Roman', serif; font-size: 12px; color: #000; margin: 0; padding: 20px; }
            h1 { text-align: center; font-size: 16px; margin-bottom: 4px; }
            .subtitle { text-align: center; font-size: 13px; margin-bottom: 20px; }
            .section { margin: 4px 0; }
            .section-title { font-weight: bold; }
            .indent { margin-left: 20px; }
            @media print { body { padding: 0; } }
        </style></head><body>
            <h1>ТЕХНИЧЕСКОЕ ЗАДАНИЕ</h1>
            <p class="subtitle">на поставку оборудования</p>
            <p class="section"><span class="section-title">1.&emsp;Наименование, Заказчик, Исполнитель, сроки и адрес поставки</span></p>
            <p class="indent">1.1.&emsp;Наименование объекта поставки: ${metadata.product_title || 'оборудование'}.</p>
            <p class="indent">1.2.&emsp;Заказчик: ${metadata.zakazchik}</p>
            <p class="indent">1.3.&emsp;Исполнитель: определяется по результатам закупочных процедур.</p>
            <p class="section"><span class="section-title">2.&emsp;Требования к поставке Товара</span></p>
            <p class="indent">2.1.&emsp;Требования к количеству поставляемого Товара: ${qtyDisplay} штук.</p>
            <p class="indent">2.2.&emsp;Требования к качеству поставляемого Товару:</p>
            ${productTables}
        </body></html>`;

        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.onload = () => { printWindow.print(); };
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_name: query }),
            });

            if (!response.ok) throw new Error('Не удалось получить данные');

            const data = await response.json();
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Произошла ошибка');
        } finally {
            setLoading(false);
        }
    };

    const getSpecCount = (specs: SpecGroup[] | Record<string, string>) => {
        if (Array.isArray(specs)) {
            return specs.reduce((sum, g) => sum + g.specs.length, 0);
        }
        return Object.keys(specs).length;
    };

    return (
        <main style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: '#e2e8f0',
        }}>
            {/* Header */}
            <header style={{
                padding: '32px 24px 24px',
                textAlign: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(15, 23, 42, 0.8)',
                backdropFilter: 'blur(20px)',
            }}>
                <h1 style={{
                    fontSize: '28px',
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    marginBottom: '8px',
                    letterSpacing: '-0.5px',
                    textShadow: '0 0 40px rgba(99, 102, 241, 0.5)'
                }}>
                    Генератор ТЗ
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '14px' }}>
                </p>

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '14px' }}>
                    {user ? (
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '6px 16px', borderRadius: '20px' }}>
                            <span style={{ color: '#94a3b8' }}>Привет, <span style={{ color: '#fff', fontWeight: 600 }}>{user.name}</span></span>
                            <Link href="/documents" style={{ color: '#60a5fa', textDecoration: 'none', fontWeight: 500 }}>📁 Мои ТЗ</Link>
                            <button onClick={logout} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 500 }}>Выйти</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                            <Link href="/login" style={{
                                padding: '8px 16px',
                                background: 'rgba(255,255,255,0.1)',
                                color: '#e2e8f0',
                                borderRadius: '8px',
                                textDecoration: 'none',
                                fontWeight: 600,
                                transition: 'all 0.2s',
                                border: '1px solid rgba(255,255,255,0.2)'
                            }}>Войти</Link>
                            <Link href="/register" style={{
                                padding: '8px 16px',
                                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                color: 'white',
                                borderRadius: '8px',
                                textDecoration: 'none',
                                fontWeight: 600,
                                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
                                transition: 'all 0.2s'
                            }}>Регистрация</Link>
                        </div>
                    )}
                </div>
            </header>

            {!user ? (
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px 20px',
                    textAlign: 'center'
                }}>
                    <h2 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '24px', color: '#f1f5f9' }}>
                        Добро пожаловать в Генератор ТЗ
                    </h2>
                    <p style={{ maxWidth: '600px', marginBottom: '40px', color: '#94a3b8', fontSize: '18px', lineHeight: '1.6' }}>
                        Автоматическое формирование технических заданий на закупку.
                        Ищите товары, добавляйте в список и скачивайте готовые документы Word.
                    </p>
                    <div style={{ display: 'flex', gap: '20px' }}>
                        <Link href="/login" style={{
                            padding: '16px 32px',
                            background: 'rgba(255,255,255,0.1)',
                            color: '#e2e8f0',
                            borderRadius: '12px',
                            textDecoration: 'none',
                            fontWeight: 700,
                            fontSize: '18px',
                            transition: 'all 0.2s',
                            border: '1px solid rgba(255,255,255,0.2)'
                        }}>Войти</Link>
                        <Link href="/register" style={{
                            padding: '16px 32px',
                            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                            color: 'white',
                            borderRadius: '12px',
                            textDecoration: 'none',
                            fontWeight: 700,
                            fontSize: '18px',
                            boxShadow: '0 4px 20px rgba(34, 197, 94, 0.4)',
                            transition: 'all 0.2s'
                        }}>Начать работу</Link>
                    </div>
                </div>
            ) : (
                <div style={{
                    maxWidth: '960px',
                    margin: '0 auto',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                }}>
                    {/* Search Section */}
                    <section style={{
                        background: 'rgba(30, 41, 59, 0.6)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '16px',
                        padding: '24px',
                        backdropFilter: 'blur(10px)',
                    }}>
                        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: '#f1f5f9' }}>
                            🔍 Поиск товара
                        </h2>
                        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px' }}>
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Введите название товара (напр. Ноутбук ASUS VivoBook)"
                                style={{
                                    flex: 1,
                                    padding: '12px 16px',
                                    background: 'rgba(15, 23, 42, 0.8)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '10px',
                                    color: '#e2e8f0',
                                    fontSize: '14px',
                                    outline: 'none',
                                    transition: 'border-color 0.2s',
                                }}
                            />
                            <button
                                type="submit"
                                disabled={loading}
                                style={{
                                    padding: '12px 28px',
                                    background: loading ? '#475569' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    cursor: loading ? 'wait' : 'pointer',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {loading ? '⏳ Поиск...' : 'Найти'}
                            </button>
                        </form>
                    </section>

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: '14px 20px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '10px',
                            color: '#fca5a5',
                            fontSize: '14px',
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    {/* Search Result */}
                    {result && (
                        <section style={{
                            background: 'rgba(30, 41, 59, 0.6)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '16px',
                            padding: '24px',
                            backdropFilter: 'blur(10px)',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9' }}>
                                    {result.product_name}
                                </h2>
                                <span style={{
                                    fontSize: '11px',
                                    padding: '4px 10px',
                                    background: 'rgba(99, 102, 241, 0.2)',
                                    borderRadius: '20px',
                                    color: '#a5b4fc',
                                }}>
                                    {result.source}
                                </span>
                            </div>

                            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                                <table style={{
                                    width: '100%',
                                    borderCollapse: 'collapse',
                                    fontSize: '13px',
                                }}>
                                    <thead>
                                        <tr>
                                            <th style={{
                                                padding: '10px 12px',
                                                textAlign: 'left',
                                                borderBottom: '2px solid rgba(255,255,255,0.1)',
                                                color: '#94a3b8',
                                                fontWeight: 600,
                                                fontSize: '12px',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.5px',
                                            }}>Характеристика</th>
                                            <th style={{
                                                padding: '10px 12px',
                                                textAlign: 'left',
                                                borderBottom: '2px solid rgba(255,255,255,0.1)',
                                                color: '#94a3b8',
                                                fontWeight: 600,
                                                fontSize: '12px',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.5px',
                                            }}>Значение</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Array.isArray(result.specs) ? (
                                            result.specs.map((group, gIdx) => (
                                                <React.Fragment key={`group-${gIdx}`}>
                                                    <tr>
                                                        <td colSpan={2} style={{
                                                            padding: '10px 12px',
                                                            fontWeight: 700,
                                                            color: '#a5b4fc',
                                                            background: 'rgba(99, 102, 241, 0.08)',
                                                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                            fontSize: '13px',
                                                        }}>
                                                            {group.group}
                                                        </td>
                                                    </tr>
                                                    {group.specs.map((spec, sIdx) => (
                                                        <tr key={`s-${gIdx}-${sIdx}`} style={{
                                                            transition: 'background 0.15s',
                                                        }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                                            <td style={{
                                                                padding: '8px 12px',
                                                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                                                                color: '#cbd5e1',
                                                                fontWeight: 500,
                                                            }}>{spec.name}</td>
                                                            <td style={{
                                                                padding: '8px 12px',
                                                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                                                                color: '#94a3b8',
                                                                whiteSpace: 'pre-line',
                                                            }}>{spec.value}</td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            ))
                                        ) : (
                                            <React.Fragment>
                                                {Object.entries(result.specs).map(([key, value]) => (
                                                    <tr key={key}>
                                                        <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', color: '#cbd5e1' }}>{key}</td>
                                                        <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', color: '#94a3b8' }}>{String(value)}</td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <button
                                    onClick={handleAddProduct}
                                    style={{
                                        flex: '1 1 100%',
                                        padding: '12px',
                                        background: 'transparent',
                                        border: '2px solid #3b82f6',
                                        borderRadius: '10px',
                                        color: '#60a5fa',
                                        fontWeight: 700,
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                >
                                    ➕ Добавить в список ТЗ
                                </button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        background: generating ? '#475569' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '10px',
                                        fontWeight: 700,
                                        fontSize: '14px',
                                        cursor: generating ? 'wait' : 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: '0 4px 16px rgba(34, 197, 94, 0.3)',
                                    }}
                                >
                                    {generating ? '⏳...' : '📥 Скачать Word'}
                                </button>
                                <button
                                    onClick={handlePrint}
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '10px',
                                        fontWeight: 700,
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3)',
                                    }}
                                >
                                    🖨️ Распечатать
                                </button>
                            </div>
                        </section>
                    )}

                    {/* Products List & Metadata & Generate */}
                    {products.length > 0 && (
                        <section style={{
                            background: 'rgba(30, 41, 59, 0.6)',
                            border: '1px solid rgba(34, 197, 94, 0.2)',
                            borderRadius: '16px',
                            padding: '24px',
                            backdropFilter: 'blur(10px)',
                        }}>
                            <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: '#f1f5f9' }}>
                                📋 Товары в ТЗ ({products.length})
                            </h2>

                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {products.map((p, idx) => (
                                    <li key={idx} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '10px 14px',
                                        background: 'rgba(15, 23, 42, 0.5)',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255,255,255,0.05)',
                                    }}>
                                        <div>
                                            <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '14px' }}>{p.product_name}</span>
                                            <span style={{
                                                marginLeft: '10px',
                                                fontSize: '11px',
                                                padding: '2px 8px',
                                                background: 'rgba(99, 102, 241, 0.15)',
                                                borderRadius: '12px',
                                                color: '#a5b4fc',
                                            }}>
                                                {getSpecCount(p.specs)} хар-к
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveProduct(idx)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#ef4444',
                                                cursor: 'pointer',
                                                fontSize: '18px',
                                                padding: '4px 8px',
                                                borderRadius: '6px',
                                                transition: 'background 0.15s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                                            title="Удалить"
                                        >✕</button>
                                    </li>
                                ))}
                            </ul>

                            {/* Metadata Form */}
                            <div style={{
                                borderTop: '1px solid rgba(255,255,255,0.08)',
                                paddingTop: '20px',
                                marginBottom: '20px',
                            }}>
                                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px', color: '#cbd5e1' }}>
                                    📝 Данные для документа
                                </h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={labelStyle}>Наименование объекта поставки</label>
                                        <input
                                            type="text"
                                            value={metadata.product_title}
                                            onChange={e => setMetadata({ ...metadata, product_title: e.target.value })}
                                            placeholder="напр. системные блоки"
                                            style={inputStyle}
                                        />
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={labelStyle}>Заказчик</label>
                                        <input
                                            type="text"
                                            value={metadata.zakazchik}
                                            onChange={e => setMetadata({ ...metadata, zakazchik: e.target.value })}
                                            placeholder="напр. ООО «Компания»"
                                            style={inputStyle}
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Количество (число)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={metadata.quantity}
                                            onChange={e => setMetadata({ ...metadata, quantity: parseInt(e.target.value) || 1 })}
                                            style={inputStyle}
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Количество (прописью)</label>
                                        <input
                                            type="text"
                                            value={metadata.quantity_text}
                                            onChange={e => setMetadata({ ...metadata, quantity_text: e.target.value })}
                                            placeholder="напр. тридцать"
                                            style={inputStyle}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    style={{
                                        flex: 1,
                                        padding: '14px',
                                        background: generating ? '#475569' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '12px',
                                        fontWeight: 800,
                                        fontSize: '15px',
                                        cursor: generating ? 'wait' : 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: generating ? 'none' : '0 4px 20px rgba(34, 197, 94, 0.3)',
                                        letterSpacing: '0.3px',
                                    }}
                                >
                                    {generating ? '⏳ Генерация...' : '📥 Скачать Word'}
                                </button>
                                <button
                                    onClick={handlePrint}
                                    style={{
                                        flex: 1,
                                        padding: '14px',
                                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '12px',
                                        fontWeight: 800,
                                        fontSize: '15px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: '0 4px 20px rgba(99, 102, 241, 0.3)',
                                        letterSpacing: '0.3px',
                                    }}
                                >
                                    🖨️ Распечатать
                                </button>

                                {user && (
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        style={{
                                            flex: 1,
                                            padding: '14px',
                                            background: 'rgba(255,255,255,0.1)',
                                            color: '#cbd5e1',
                                            border: '1px solid rgba(255,255,255,0.2)',
                                            borderRadius: '12px',
                                            fontWeight: 600,
                                            fontSize: '14px',
                                            cursor: saving ? 'wait' : 'pointer',
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        {saving ? '💾 ...' : '💾 Сохранить'}
                                    </button>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </main>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#94a3b8',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    background: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
};
