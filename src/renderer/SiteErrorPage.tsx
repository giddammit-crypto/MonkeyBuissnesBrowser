import React from 'react';
import { ArrowLeft, FileWarning, Globe, Plus, RotateCcw, ShieldAlert, WifiOff } from 'lucide-react';
import type { TabSnapshot } from '../shared/types';
import { SiteErrorIllustration } from './SiteErrorIllustration';
import './site-unavailable.css';

interface SiteErrorPageProps {
  tab: TabSnapshot;
  onRetry: () => void;
  onBack: () => void;
  onNewTab: () => void;
}

type ErrorVariant = 'network' | 'security' | 'page';

export function getErrorDetails(tab: TabSnapshot): { title: string; hint: string; code?: string; variant: ErrorVariant } {
  const error = tab.lastError;
  const desc = error?.errorDescription || '';
  const code = error?.errorCode;
  const chromiumCode = desc.match(/\bERR_[A-Z0-9_]+\b/)?.[0];
  const tlsCode = desc.match(/\b(?:ERR_)?(?:SSL|CERT)_[A-Z0-9_]+\b/)?.[0];

  if (desc.includes('ERR_NAME_NOT_RESOLVED') || desc.includes('NAME_NOT_RESOLVED')) {
    return {
      variant: 'network',
      title: 'Не удалось найти IP-адрес сервера',
      hint: 'Проверьте правильность написания адреса сайта, подключение к интернету или настройки DNS.',
      code: 'ERR_NAME_NOT_RESOLVED',
    };
  }
  if (desc.includes('ERR_CONNECTION_REFUSED') || desc.includes('CONNECTION_REFUSED')) {
    return {
      variant: 'network',
      title: 'Сервер отклонил подключение',
      hint: 'Сайт временно недоступен или сервер не принимает входящие сетевые соединения.',
      code: 'ERR_CONNECTION_REFUSED',
    };
  }
  if (desc.includes('ERR_CONNECTION_TIMED_OUT') || desc.includes('TIMED_OUT')) {
    return {
      variant: 'network',
      title: 'Превышено время ожидания ответа',
      hint: 'Сервер отвечает слишком долго или сетевой маршрут недоступен.',
      code: chromiumCode ?? 'ERR_CONNECTION_TIMED_OUT',
    };
  }
  if (desc.includes('ERR_INTERNET_DISCONNECTED') || desc.includes('DISCONNECTED')) {
    return {
      variant: 'network',
      title: 'Отсутствует подключение к сети',
      hint: 'Проверьте сетевой кабель, подключение к Wi-Fi или работу роутера.',
      code: 'ERR_INTERNET_DISCONNECTED',
    };
  }
  if (tlsCode) {
    return {
      variant: 'security',
      title: 'Ошибка безопасного подключения',
      hint: 'Проверьте адрес сайта и системные дату и время. Если ошибка повторяется, обратитесь к владельцу сайта.',
      code: tlsCode.startsWith('ERR_') ? tlsCode : `ERR_${tlsCode}`,
    };
  }
  if (desc.includes('ERR_ADDRESS_UNREACHABLE') || desc.includes('ADDRESS_UNREACHABLE')) {
    return {
      variant: 'network',
      title: 'Адрес сервера недоступен',
      hint: 'Невозможно построить маршрут до сервера из текущей сети.',
      code: 'ERR_ADDRESS_UNREACHABLE',
    };
  }
  if (desc) {
    return {
      variant: 'page',
      title: 'Не удалось загрузить страницу',
      hint: 'Попробуйте загрузить страницу ещё раз или вернитесь на предыдущую.',
      code: chromiumCode ?? (code ? String(code) : desc),
    };
  }
  return {
    variant: 'network',
    title: 'Страница временно недоступна',
    hint: 'Проверьте сетевое подключение или повторите попытку через несколько секунд.',
  };
}

const statusStyles = {
  network: { label: 'Подключение', Icon: WifiOff },
  security: { label: 'Безопасность', Icon: ShieldAlert },
  page: { label: 'Загрузка страницы', Icon: FileWarning },
};

export function SiteErrorPage({ tab, onRetry, onBack, onNewTab }: SiteErrorPageProps): React.JSX.Element {
  const { title, hint, code, variant } = getErrorDetails(tab);
  const displayUrl = tab.lastError?.validatedURL || tab.url;
  const { label, Icon } = statusStyles[variant];
  const headingId = React.useId();

  return (
    <section className="site-unavailable" aria-labelledby={headingId} data-site-error={variant}>
      <div className="site-unavailable-card">
        <div className="site-unavailable-content">
          <div className="site-unavailable-summary" role="alert">
            <div className="site-unavailable-status">
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </div>
            <h1 id={headingId}>{title}</h1>
            <p>{hint}</p>
          </div>

          <dl className="site-unavailable-details">
            {displayUrl && (
              <div className="site-unavailable-address">
                <dt><Globe size={15} aria-hidden="true" /> Адрес</dt>
                <dd title={displayUrl}>{displayUrl}</dd>
              </div>
            )}
            {code && (
              <div>
                <dt>Код ошибки</dt>
                <dd><code>{code}</code></dd>
              </div>
            )}
          </dl>

          <div className="site-unavailable-actions">
            <button type="button" className="site-unavailable-button is-primary" onClick={onRetry} autoFocus>
              <RotateCcw size={17} aria-hidden="true" />
              <span>Повторить попытку</span>
            </button>
            {tab.canGoBack && (
              <button type="button" className="site-unavailable-button" onClick={onBack}>
                <ArrowLeft size={17} aria-hidden="true" />
                <span>Назад</span>
              </button>
            )}
            <button type="button" className="site-unavailable-button" onClick={onNewTab}>
              <Plus size={17} aria-hidden="true" />
              <span>Новая вкладка</span>
            </button>
          </div>
        </div>

        <div className="site-unavailable-art">
          <SiteErrorIllustration variant={variant} />
        </div>
      </div>
    </section>
  );
}

export default SiteErrorPage;
