import React from 'react';
import { ArrowLeft, Plus, RotateCcw } from 'lucide-react';
import type { TabSnapshot } from '../shared/types';
import siteUnavailableImg from './assets/soul/site-unavailable.png';

interface SiteErrorPageProps {
  tab: TabSnapshot;
  onRetry: () => void;
  onBack: () => void;
  onNewTab: () => void;
}

export function getErrorDetails(tab: TabSnapshot): { title: string; hint: string; code?: string } {
  const error = tab.lastError;
  const desc = error?.errorDescription || '';
  const code = error?.errorCode;

  if (desc.includes('ERR_NAME_NOT_RESOLVED') || desc.includes('NAME_NOT_RESOLVED')) {
    return {
      title: 'Не удалось найти IP-адрес сервера',
      hint: 'Проверьте правильность написания адреса сайта, подключение к интернету или настройки DNS.',
      code: 'ERR_NAME_NOT_RESOLVED',
    };
  }
  if (desc.includes('ERR_CONNECTION_REFUSED') || desc.includes('CONNECTION_REFUSED')) {
    return {
      title: 'Сервер отклонил подключение',
      hint: 'Сайт временно недоступен или сервер не принимает входящие сетевые соединения.',
      code: 'ERR_CONNECTION_REFUSED',
    };
  }
  if (desc.includes('ERR_CONNECTION_TIMED_OUT') || desc.includes('TIMED_OUT')) {
    return {
      title: 'Превышено время ожидания ответа',
      hint: 'Сервер отвечает слишком долго или сетевой маршрут недоступен.',
      code: 'ERR_CONNECTION_TIMED_OUT',
    };
  }
  if (desc.includes('ERR_INTERNET_DISCONNECTED') || desc.includes('DISCONNECTED')) {
    return {
      title: 'Отсутствует подключение к сети',
      hint: 'Проверьте сетевой кабель, подключение к Wi-Fi или работу роутера.',
      code: 'ERR_INTERNET_DISCONNECTED',
    };
  }
  if (desc.includes('ERR_SSL') || desc.includes('CERT') || desc.includes('ERR_CERT')) {
    return {
      title: 'Ошибка безопасного подключения',
      hint: 'Не удалось установить защищённое SSL/TLS соединение с сервером.',
      code: 'ERR_SSL_PROTOCOL_ERROR',
    };
  }
  if (desc.includes('ERR_ADDRESS_UNREACHABLE') || desc.includes('ADDRESS_UNREACHABLE')) {
    return {
      title: 'Адрес сервера недоступен',
      hint: 'Невозможно построить маршрут до сервера из текущей сети.',
      code: 'ERR_ADDRESS_UNREACHABLE',
    };
  }
  if (desc) {
    return {
      title: 'Не удалось загрузить страницу',
      hint: desc,
      code: code ? String(code) : undefined,
    };
  }
  return {
    title: 'Страница временно недоступна',
    hint: 'Проверьте сетевое подключение или повторите попытку через несколько секунд.',
  };
}

export function SiteErrorPage({ tab, onRetry, onBack, onNewTab }: SiteErrorPageProps): React.JSX.Element {
  const { title, hint, code } = getErrorDetails(tab);
  const displayUrl = tab.lastError?.validatedURL || tab.url;

  return (
    <div className="site-error-page" role="alert" aria-label="Сайт недоступен">
      <div className="site-error-card">
        <div className="site-error-image-wrapper">
          <img
            src={siteUnavailableImg}
            alt="Сайт недоступен"
            className="site-error-image"
          />
        </div>
        <div className="site-error-info">
          <h2 className="site-error-title">{title}</h2>
          <div className="site-error-url-pill" title={displayUrl}>
            {displayUrl}
          </div>
          <p className="site-error-hint">{hint}</p>
          {code && <span className="site-error-code">Код ошибки: {code}</span>}
        </div>
        <div className="site-error-actions">
          <button
            type="button"
            className="site-error-btn primary"
            onClick={onRetry}
            autoFocus
          >
            <RotateCcw size={16} />
            <span>Повторить попытку</span>
          </button>
          {tab.canGoBack && (
            <button
              type="button"
              className="site-error-btn secondary"
              onClick={onBack}
            >
              <ArrowLeft size={16} />
              <span>Назад</span>
            </button>
          )}
          <button
            type="button"
            className="site-error-btn secondary"
            onClick={onNewTab}
          >
            <Plus size={16} />
            <span>Новая вкладка</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default SiteErrorPage;
