# Аудит браузера и Linuxsec — 2026-11-03

## Исправлено

- Linuxsec daemon больше не открывает privileged UNIX-сокет всем локальным пользователям: используется группа `linuxsec`, режимы `0770/0660` и fallback `0600`.
- Аргументы kill switch валидируются как имя интерфейса и IP-адрес с допустимым портом; nftables и iptables больше не получают произвольные строки.
- Ошибка любой команды iptables теперь возвращается вызывающему коду, поэтому daemon не сообщает ложный успешный статус.
- VPN не переходит в `connected`, если daemon отклонил kill switch или IPv6 leak protection; добавлены regression-тесты.
- NetworkManager считается доступным при успешном ответе `nmcli`, даже если сеть сейчас отключена.
- Имена временных VPN-профилей получили стабильный hash-суффикс, исключающий коллизии.
- Применение NetworkManager-настроек больше не скрывает ошибку.
- Открытие файлов защищено проверкой компонентов пути и symlink-resolve.
- Обновления принимаются только по HTTPS с доверенных GitHub Release-хостов, без traversal в имени файла; redirects проверяются повторно.
- Для digest из GitHub Releases добавлена SHA-256-проверка скачанного файла.

## Проверки

- Основной проект: `npm run check` — 66 файлов, 575 тестов.
- Основной проект: `npm run build`.
- Linuxsec: `npm run typecheck`, `npm run test:unit` — 16 тестов.
- Linuxsec: `go test ./...`, `go build ./daemon/cmd`.

## Следующий приоритет

1. Добавить environment-gated Electron smoke в CI с GTK/Chromium-зависимостями.
2. Разделить Linuxsec unit и NetworkManager/WireGuard integration-тесты.
3. Подписывать релизные артефакты и проверять подпись дополнительно к SHA-256.
4. Добавить DOM-тесты для VPN-индикатора, privacy settings и AI quick actions.
