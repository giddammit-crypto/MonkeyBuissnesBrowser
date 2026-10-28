# Инструкция по установке и запуску Linuxsec

## 1. Системные требования

- **Операционная система**: Linux (Ubuntu 20.04+, Debian 11/12, Linux Mint 21+, Fedora 38+, Arch Linux).
- **Архитектура**: x86_64 (amd64).
- **Сетевой стек**: NetworkManager (1.20+), `wireguard-tools`, `openvpn`.
- **Графический сервер**: Wayland или X11.

---

## 2. Установка из готового пакета (.deb)

Для дистрибутивов Ubuntu, Debian, Linux Mint:

```bash
# 1. Установка системных зависимостей (если не установлены)
sudo apt update
sudo apt install -y wireguard-tools network-manager openvpn iptables

# 2. Установка пакета Linuxsec
sudo dpkg -i release/linuxsec_1.0.0_amd64.deb

# 3. В случае отсутствующих зависимостей
sudo apt install -f -y
```

После установки ярлык «Linuxsec» появится в системном меню приложений.

---

## 3. Запуск без установки (AppImage)

Для любого современного дистрибутива Linux:

```bash
# 1. Дайте права на выполнение
chmod +x release/Linuxsec-1.0.0.AppImage

# 2. Запустите приложение
./release/Linuxsec-1.0.0.AppImage
```

---

## 4. Сборка и запуск из исходного кода

### Необходимые инструменты разработчика:
- Node.js 18+ и npm
- Go 1.20+ (для компиляции root-демона `linuxsecd`)
- NetworkManager и WireGuard

### Команды сборки:
```bash
# Перейдите в каталог проекта
cd linuxsec

# Сборка всех компонентов (демон, main process, Vite renderer)
npm run build

# Запуск в режиме разработки
npm run dev

# Запуск тестов
npm test
```

---

## 5. Настройка привилегированного демона (Kill Switch и межсетевой экран)

Приложение Linuxsec запускается от обычного пользователя и управляет VPN-соединениями через NetworkManager D-Bus.

Для использования аппаратного Kill Switch (блокировка трафика при внезапном обрыве) установите службу `linuxsecd`:

```bash
# Копирование демона
sudo cp dist/daemon/linuxsecd /usr/lib/linuxsec/linuxsecd
sudo chmod 755 /usr/lib/linuxsec/linuxsecd

# Установка systemd-службы
sudo cp packaging/systemd/linuxsecd.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now linuxsecd.service

# Проверка статуса
sudo systemctl status linuxsecd.service
```

---

## 6. Быстрый старт: первое подключение

1. Запустите **Linuxsec** из меню или терминала.
2. Перейдите на вкладку **Серверы**.
3. Нажмите **Импорт .conf** (для WireGuard) или **Импорт .ovpn** (для OpenVPN) и выберите ваш файл конфигурации, либо нажмите **+** для добавления сервера вручную.
4. Нажмите **Подключить**.
5. Проверьте зеленый индикатор статуса, изменившийся внешний IP и график входящего/исходящего трафика в реальном времени.
