import React, { useState } from 'react';
import { ClipboardCopy, ExternalLink, Globe2, Search, X } from 'lucide-react';
import type { TabSnapshot } from '../shared/types';
import { osintSources, publicOsintTarget, type DnsResult, type PageOsint } from '../shared/osint';
import { userFacingError } from './userFacingError';
import './osint.css';

export default function OsintPanel({ tab, onClose, onOpen }: {
  tab?: TabSnapshot;
  onClose: () => void;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const [input, setInput] = useState(() => publicOsintTarget(tab?.url || '')?.hostname || '');
  const [page, setPage] = useState<{ evidence: PageOsint; checkedAt: string }>();
  const [dns, setDns] = useState<{ hostname: string; records: DnsResult[]; checkedAt: string }>();
  const [busy, setBusy] = useState<'page' | 'dns'>();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const target = publicOsintTarget(input);
  const sources = target ? osintSources(target) : [];
  const currentDns = dns?.hostname === target?.hostname ? dns : undefined;
  const pageAllowed = Boolean(tab && !tab.isInternal && !tab.isPrivate && !tab.isLoading && tab.lifecycle !== 'crashed');
  const perform = async (task: 'page' | 'dns', work: () => Promise<void>) => {
    setBusy(task);
    setError('');
    setCopied(false);
    try { await work(); }
    catch (failure) { setError(userFacingError(failure)); }
    finally { setBusy(undefined); }
  };
  const copy = async () => {
    setCopied(false);
    setError('');
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        format: 'soulm8te-osint/1',
        page: page && { source: 'Текущий документ, Performance API и наблюдаемый HTTP-ответ', ...page },
        dns: currentDns && { source: 'https://dns.google/resolve', ...currentDns },
        publicSources: sources,
      }, null, 2));
      setCopied(true);
    } catch (failure) { setError(userFacingError(failure)); }
  };

  return (
    <section className="osint-panel" aria-labelledby="osint-title">
      <header className="osint-header">
        <div className="osint-title">
          <Search size={22} aria-hidden="true" />
          <div><h1 id="osint-title">OSINT</h1><p>Исследование сайтов и публичной инфраструктуры</p></div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть OSINT"><X size={18} /></button>
      </header>
      <div className="osint-grid">
        <section className="osint-card">
          <h2>Открытая вкладка</h2>
          <p>Метаданные, заголовки HTTP, внешние ссылки, ресурсы, iframe и направления отправки форм. Анализ выполняется в браузере.</p>
          <button type="button" className="primary-button" disabled={!pageAllowed || Boolean(busy)} onClick={() => {
            if (!tab) return;
            setPage(undefined);
            void perform('page', async () => setPage({ evidence: await window.browserApi.getOsintPage(tab.id), checkedAt: new Date().toISOString() }));
          }}>{busy === 'page' ? 'Проверяем…' : 'Анализировать вкладку'}</button>
          {!pageAllowed && <p>Для анализа откройте обычную веб-страницу.</p>}
          {page && <PageEvidence report={page.evidence} />}
        </section>
        <section className="osint-card">
          <h2>Домен и открытые источники</h2>
          <form onSubmit={event => {
            event.preventDefault();
            if (!target || busy) return;
            const hostname = target.hostname;
            setDns(undefined);
            void perform('dns', async () => setDns({ hostname, records: await window.browserApi.getOsintDns(hostname), checkedAt: new Date().toISOString() }));
          }}>
            <label htmlFor="osint-host">Публичный домен или адрес сайта</label>
            <input id="osint-host" value={input} onChange={event => { setInput(event.target.value); setCopied(false); }} placeholder="example.org" maxLength={2048} />
            <button type="submit" className="primary-button" disabled={!target || Boolean(busy)}>{busy === 'dns' ? 'Запрашиваем…' : 'Проверить DNS'}</button>
          </form>
          <p>При проверке DNS доменное имя отправляется в Google Public DNS. Источники открываются в фоновых вкладках по вашему клику.</p>
          {currentDns && <details open>
            <summary>Записи DNS · {currentDns.hostname}</summary>
            <dl className="osint-records">
              {currentDns.records.map(row => <div key={row.type}><dt>{row.type}</dt><dd>{
                row.status === 'error' ? 'Ошибка запроса' : row.status === 'nxdomain' ? 'Домен не найден' :
                row.records.length ? <ul>{row.records.map((record, index) =>
                  <li key={index}><code>{record.value}</code> <small>{record.name} · TTL {record.ttl} с</small></li>)}</ul> : 'Записей нет'
              }</dd></div>)}
            </dl>
          </details>}
          {sources.length > 0 && <ul className="osint-sources">
            {sources.map(source => <li key={source.label}><button type="button" onClick={() => onOpen(source.url)}>
              <Globe2 size={16} aria-hidden="true" /><span>{source.label}<small>{source.detail}</small></span><ExternalLink size={14} aria-hidden="true" />
            </button></li>)}
          </ul>}
        </section>
      </div>
      {error && <p className="osint-error" role="alert">{error}</p>}
      <footer className="osint-footer">
        <button type="button" className="plain-button" disabled={!page && !currentDns} onClick={() => void copy()}>
          <ClipboardCopy size={16} aria-hidden="true" /> Скопировать отчёт JSON
        </button>
        <span role="status">{copied ? 'Отчёт скопирован' : 'В отчёте указаны источники и время проверки.'}</span>
      </footer>
    </section>
  );
}

function PageEvidence({ report }: { report: PageOsint }): React.JSX.Element {
  const fields = [
    ['Источник', report.origin], ['Заголовок', report.title], ['Описание', report.description],
    ['Генератор (по метаданным)', report.generator], ['Язык', report.language], ['Robots', report.robots],
    ['Канонический источник', report.canonicalOrigin], ['Сетевой протокол', report.protocol],
  ];
  const origins = [
    ['Внешние ссылки', report.linkOrigins], ['Загруженные ресурсы', report.resourceOrigins], ['Встроенные фреймы', report.frameOrigins],
  ] as const;
  return <>
    <dl className="osint-records">
      {fields.filter(([, value]) => value).map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      <div><dt>Формы</dt><dd>{report.forms.count} · внешних {report.forms.external} · отправка по HTTP {report.forms.http}</dd></div>
    </dl>
    {report.http ? <details>
      <summary>Ответ HTTP · {report.http.status}</summary>
      <dl className="osint-records">
        {report.http.headers.map(({ name, value }) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
        {report.http.protections.map(({ name, present }) =>
          <div key={name}><dt>{name}</dt><dd>{present ? 'Присутствует' : 'Не наблюдался'}</dd></div>)}
      </dl>
    </details> : <p>Заголовки ответа недоступны для этой загрузки.</p>}
    {origins.map(([label, values]) => <details key={label}>
      <summary>{label} · {values.length}</summary>
      {values.length > 0 && <ul>{values.map(value => <li key={value}><code>{value}</code></li>)}</ul>}
    </details>)}
  </>;
}
