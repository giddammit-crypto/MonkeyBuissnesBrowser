# soulm8te Native — этап 1 перехода на Chromium

**Это исходная инфраструктура прототипа, не готовая замена Electron.**
Собирается полная цель Chromium `chrome`, с нативными вкладками/окнами, sandbox,
профилями и штатными механизмами браузера. Здесь нет CEF, Electron, content_shell,
WebContentsView, iframe-оболочки или маскировки User-Agent.

Основа зафиксирована в `upstream.json`: 156.0.8078.79, commit
`a21ce95c24ce3964416f09ae1862f53f319eb4d0`. Это проверенная стартовая точка,
**не обещание самой новой безопасной версии**. Перед публичным выпуском pin нужно
обновить на актуальный поддерживаемый релиз и повторить все проверки.

## Что готово

- Проверка ресурсов до многогигабайтной загрузки.
- Получение исходников/зависимостей и проверка точного коммита.
- Минимальный патч `soulm8te Preview` в нативных ресурсах продукта; copyright Chromium сохранён.
- GN-конфигурация, команда сборки `chrome`, SHA256 собранного бинарника.
- Запуск baseline Chromium и будущей сборки в двух отдельных профилях.
- Проверки инструментов и применимости патча к настоящим закреплённым файлам.

## Что ещё НЕ готово

- Полная компиляция форка и проверенный установщик.
- Перенос React-панелей, тем, Вуду, заметок, VPN и старых данных.
- Пользовательский тест Google/Gmail/YouTube/стороннего SSO.
- Проверка аппаратного микрофона, Wayland/X11, расширений и обновлений форка.
- Полный брендинг: многие строки и значки пока остаются Chromium.

## Сборочная машина

Linux x86_64; минимум 100 GiB свободного места и 8 GiB RAM; разумно выделить
200 GiB и 32 GiB RAM для повторных сборок. На 8 GiB желательно 32 GiB swap.
Нужны Git, Python 3.9+, depot_tools и зависимости из Chromium.
Автоматической установки системных пакетов/изменения браузера по умолчанию нет.

```bash
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git /opt/work/depot_tools
export PATH="/opt/work/depot_tools:$PATH"
python3 chromium-native/native.py doctor --workspace /opt/work/soulm8te-native
python3 chromium-native/native.py prepare --workspace /opt/work/soulm8te-native
# Проверить скрипт upstream и установить системные зависимости:
/opt/work/soulm8te-native/src/build/install-build-deps.sh
python3 chromium-native/native.py build --workspace /opt/work/soulm8te-native --jobs 4
```

После прерванной компиляции повторить `build`: допускается только исходный
checkout или точное состояние проверенного патча. Посторонние изменения
сборка отвергает; автоматически сбрасывать их скрипт не будет.

Подтверждение компиляции записывается только после успешного build в
`src/out/Soulm8te/soulm8te-build.json`. `depot_tools`/инструменты могут обновляться;
это воспроизводимая процедура получения исходной версии, не бит-в-бит reproducible build.

## Проверка входа Google — вручную, без автоматизации

Сначала проверить установленный полноценный Chromium, затем тот же сценарий в форке:

```bash
python3 chromium-native/native.py launch --mode baseline --binary /usr/bin/chromium --url https://accounts.google.com/
python3 chromium-native/native.py launch --mode fork --binary /opt/work/soulm8te-native/src/out/Soulm8te/chrome --url https://accounts.google.com/
```

Команды запускают обычные окна, не WebView и не автоматизированную авторизацию.
Пароль вводит только пользователь. Скрипт не читает cookies, пароли или страницу.
Baseline — установленный Chromium, **не наша собранная версия**.
Профили `$XDG_CONFIG_HOME/soulm8te-chromium-baseline` и
`$XDG_CONFIG_HOME/soulm8te-chromium-preview` изолированы от Electron и обычного Chromium.
Установленный браузер должен быть обновлён. `--dry-run` показывает команду, не открывая окно.

Проверить: Gmail, YouTube, вход через Google на используемом стороннем сайте,
всплывающее окно и перезапуск. Результаты фиксировать по шаблону `ACCEPTANCE.md`.
Не прикладывать cookies, HAR с секретами, OAuth-коды или URL с query-параметрами.
Вход в Google на сайте не равен Chrome Sync. API-ключи сами по себе не открывают
доступ к ограниченным Google API. Launcher убирает из дочернего окружения
`GOOGLE_DEFAULT_CLIENT_ID/SECRET`, как рекомендует upstream для обычного web login.

## Проверки без полной компиляции

```bash
python3 -m unittest discover -s chromium-native/tests -v
python3 chromium-native/verify_upstream.py
```

Вторая команда загружает только два закреплённых файла, проверяет SHA256 и
`git apply --check`. Успех этих проверок **не означает**, что Chromium собран
или что Google принимает вход.

## Перенос функций

| Функция | Направление | Статус |
|---|---|---|
| Вкладки, навигация, загрузки | Нативные механизмы Chromium | Требуется собрать/проверить |
| Панели React/темы | WebUI ресурсов Chromium, пересмотр API интерфейса | Не перенесены |
| Вуду | Отдельная панель/расширение + минимальный native messaging host | Требует проекта и проверки разрешений |
| Расширения | Штатный движок Chromium | Проверка совместимости не выполнена |
| Закладки | Явный импорт экспортированного HTML | Не реализован в инструментах перехода |
| Пароли/cookies | Не копировать файлы профиля Electron | Автоматического переноса нет |
| VPN и adblock | Отдельный перенос политики/расширений после baseline | Не перенесены |
| Ubuntu .deb/AppImage, обновления | Отдельная упаковка/канал native | Не готовы |

Electron остаётся рабочим каналом 1.2.6. Это отдельная ветка миграции, а не релиз 1.2.7.

Источники:
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/build_instructions.md
- https://chromium.googlesource.com/chromium/src/+/main/docs/api_keys.md
- https://support.google.com/accounts/answer/7675428
