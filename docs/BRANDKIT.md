# MonkeyBuissnesBrowser BrandKit

Источник визуальной айдентики: `/home/astra/Downloads/MonkeyBuissnesBrowser_BrandKit`.

## Использованные ассеты

- `src/renderer/assets/brand/logo-horizontal-detailed.png` — горизонтальный логотип в titlebar.
- `src/renderer/assets/brand/mascot-badge-512.png` — фирменный знак для будущих splash/settings экранов.
- `src/renderer/assets/brand/app-icon-1024.png` — мастер-иконка приложения.
- `assets/icons/ico/MonkeyBuissnesBrowser.ico` — Windows icon для упаковки.
- `src/renderer/assets/monkey-business-los-angeles.jpg` — адаптивный фон новой вкладки, предоставленный пользователем.

## Палитра

- Charcoal — `#2F343A`
- Warm Beige — `#C9A78C`
- Soft Cream — `#F7F3EA`
- Tie Red — `#B21E2D`
- Espresso — `#4A2E24`
- Sky Blue — `#3EA6FF`

В интерфейсе Sky Blue используется как основной интерактивный акцент, а красный оставлен для редких предупреждений и эмоциональных деталей. Большие поверхности не заливаются бежевым цветом.

## Принципы

- Точное написание бренда: `MonkeyBuissnesBrowser`.
- Короткое имя: `Monkey Browser`.
- Слоган: «Меньше шума. Больше возможностей.»
- Логотип не заменяется текстовой имитацией и не растягивается по пропорциям.
- Для toolbar используются линейные иконки Lucide; маскот не дублируется в каждой карточке.
- Фоновое изображение новой вкладки масштабируется через `background-size: cover`, а на узких окнах меняет фокус, чтобы персонаж оставался видимым.
