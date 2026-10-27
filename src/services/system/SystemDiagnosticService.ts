import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CanonDriverStatus,
  CanonModelConfig,
  CanonModelKey,
  CupsPrinterInfo,
  DetectedUsbDevice,
  SystemDiagnosticReport,
  SystemErrorItem,
} from '../../shared/types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const CANON_MODELS: Record<CanonModelKey, CanonModelConfig> = {
  lbp2900: {
    id: 'lbp2900',
    label: 'Canon LBP2900 / LBP2900B / LBP3000',
    ppdName: 'CNCUPSLBP2900CAPTK.ppd',
    captVersion: '2.71',
    usbId: '04a9:2676',
  },
  lbp3000: {
    id: 'lbp3000',
    label: 'Canon LBP3000',
    ppdName: 'CNCUPSLBP3000CAPTK.ppd',
    captVersion: '2.71',
    usbId: '04a9:2676',
  },
  lbp6000: {
    id: 'lbp6000',
    label: 'Canon LBP6000 / LBP6000B / LBP6018',
    ppdName: 'CNCUPSLBP6000CAPTK.ppd',
    captVersion: '3.40',
    usbId: '04a9:271a',
  },
  lbp6020: {
    id: 'lbp6020',
    label: 'Canon LBP6020 / LBP6020B',
    ppdName: 'CNCUPSLBP6020CAPTK.ppd',
    captVersion: '3.40',
    usbId: '04a9:2738',
  },
  lbp6030: {
    id: 'lbp6030',
    label: 'Canon LBP6030 / LBP6030B / LBP6030w',
    ppdName: 'CNCUPSLBP6030CAPTK.ppd',
    captVersion: '3.40',
    usbId: '04a9:277b',
  },
  lbp3010: {
    id: 'lbp3010',
    label: 'Canon LBP3010 / LBP3018 / LBP3050',
    ppdName: 'CNCUPSLBP3010CAPTK.ppd',
    captVersion: '3.40',
    usbId: '04a9:26ed',
  },
  lbp3100: {
    id: 'lbp3100',
    label: 'Canon LBP3100 / LBP3108 / LBP3150',
    ppdName: 'CNCUPSLBP3100CAPTK.ppd',
    captVersion: '3.40',
    usbId: '04a9:26a3',
  },
  lbp3250: {
    id: 'lbp3250',
    label: 'Canon LBP3250',
    ppdName: 'CNCUPSLBP3250CAPTK.ppd',
    captVersion: '3.40',
    usbId: '04a9:26bd',
  },
  lbp1120: {
    id: 'lbp1120',
    label: 'Canon LBP-1120',
    ppdName: 'CNCUPSLBP1120CAPTK.ppd',
    captVersion: '2.71',
    usbId: '04a9:2610',
  },
  lbp1210: {
    id: 'lbp1210',
    label: 'Canon LBP-1210',
    ppdName: 'CNCUPSLBP1210CAPTK.ppd',
    captVersion: '2.71',
    usbId: '04a9:2611',
  },
};

export class SystemDiagnosticService {
  /**
   * Reads OS and distribution release info
   */
  async getOsInfo(): Promise<{
    prettyName: string;
    kernel: string;
    isAstraLinux: boolean;
    astraEdition?: string;
    arch: string;
  }> {
    let prettyName = `${os.type()} ${os.release()}`;
    let isAstraLinux = false;
    let astraEdition: string | undefined;

    try {
      if (fs.existsSync('/etc/os-release')) {
        const content = await fs.promises.readFile('/etc/os-release', 'utf8');
        const lines = content.split('\n');
        const osData: Record<string, string> = {};
        for (const line of lines) {
          const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
          if (match) osData[match[1]] = match[2];
        }

        if (osData.PRETTY_NAME) prettyName = osData.PRETTY_NAME;
        if (
          (osData.ID && osData.ID.toLowerCase().includes('astra')) ||
          (osData.ID_LIKE && osData.ID_LIKE.toLowerCase().includes('astra')) ||
          prettyName.toLowerCase().includes('astra')
        ) {
          isAstraLinux = true;
          astraEdition = osData.VERSION || osData.VARIANT || 'Astra Linux';
        }
      }

      if (!isAstraLinux && fs.existsSync('/etc/astra_version')) {
        isAstraLinux = true;
        const ver = await fs.promises.readFile('/etc/astra_version', 'utf8');
        astraEdition = ver.trim();
        prettyName = `Astra Linux (${astraEdition})`;
      }
    } catch {
      // fallback to os info
    }

    return {
      prettyName,
      kernel: os.release(),
      isAstraLinux,
      astraEdition,
      arch: process.arch,
    };
  }

  /**
   * Scans USB devices using lsusb
   */
  async getUsbDevices(): Promise<DetectedUsbDevice[]> {
    try {
      const { stdout } = await execAsync('lsusb 2>/dev/null', { timeout: 3000 });
      const devices: DetectedUsbDevice[] = [];
      const lines = stdout.split('\n').filter(Boolean);

      for (const line of lines) {
        // Bus 003 Device 002: ID 04a9:2676 Canon, Inc. LBP2900
        const match = line.match(/^Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+([0-9a-fA-F]{4}:[0-9a-fA-F]{4})\s+(.*)$/);
        if (match) {
          const [, bus, device, id, name] = match;
          const lowerName = name.toLowerCase();
          const lowerId = id.toLowerCase();
          const isCanon = lowerId.startsWith('04a9') || lowerName.includes('canon');
          const isPrinter =
            isCanon ||
            lowerName.includes('printer') ||
            lowerName.includes('print') ||
            lowerName.includes('lbp') ||
            lowerName.includes('laserjet');

          devices.push({
            bus,
            device,
            id: lowerId,
            name: name.trim(),
            isCanon,
            isPrinter,
          });
        }
      }
      return devices;
    } catch {
      return [];
    }
  }

  /**
   * Checks CUPS installed printers and default printer
   */
  async getCupsPrinters(): Promise<{ running: boolean; printers: CupsPrinterInfo[] }> {
    let running = false;
    const printers: CupsPrinterInfo[] = [];

    try {
      const { stdout: pOut } = await execAsync('lpstat -p -d 2>/dev/null', { timeout: 4000 });
      running = true;

      let defaultPrinter = '';
      const defMatch = pOut.match(/(?:system default destination|назначение системы по умолчанию):\s*(\S+)/i);
      if (defMatch) defaultPrinter = defMatch[1];

      // устройство для...
      let uris: Record<string, string> = {};
      try {
        const { stdout: vOut } = await execAsync('lpstat -v 2>/dev/null', { timeout: 3000 });
        const vLines = vOut.split('\n');
        for (const vl of vLines) {
          const m = vl.match(/(?:device for|устройство для)\s+([^:]+):\s*(.+)$/i);
          if (m) uris[m[1].trim()] = m[2].trim();
        }
      } catch {}

      const lines = pOut.split('\n');
      for (const line of lines) {
        const pMatch = line.match(/(?:printer|принтер)\s+(\S+)\s+(.+)$/i);
        if (pMatch) {
          const name = pMatch[1];
          const status = pMatch[2].trim();
          printers.push({
            name,
            status,
            deviceUri: uris[name],
            isDefault: name === defaultPrinter,
            isAcceptingJobs: !status.toLowerCase().includes('disabled') && !status.toLowerCase().includes('отключен'),
          });
        }
      }
    } catch {
      // cups might be stopped
      running = false;
    }

    return { running, printers };
  }

  /**
   * Checks Canon CAPT specific state in Astra Linux / Debian
   */
  async getCanonDriverStatus(): Promise<CanonDriverStatus> {
    const osInfo = await this.getOsInfo();
    const usb = await this.getUsbDevices();
    const cups = await this.getCupsPrinters();

    let ccpdInstalled = false;
    let ccpdRunning = false;
    let fifoExists = false;
    let udevRuleExists = false;
    let rastertocaptInstalled = false;

    try {
      ccpdInstalled = fs.existsSync('/usr/sbin/ccpdadmin') || fs.existsSync('/usr/sbin/ccpd');
    } catch {}

    try {
      fifoExists = fs.existsSync('/var/ccpd/fifo0');
    } catch {}

    try {
      udevRuleExists = fs.existsSync('/etc/udev/rules.d/85-canon-capt.rules');
    } catch {}

    try {
      rastertocaptInstalled =
        fs.existsSync('/usr/lib/cups/filter/rastertocapt') ||
        fs.existsSync('/usr/libexec/cups/filter/rastertocapt');
    } catch {}

    try {
      const { stdout } = await execAsync('systemctl is-active ccpd 2>/dev/null || pidof ccpd 2>/dev/null', { timeout: 2000 });
      if (stdout.trim().includes('active') || /^\d+/.test(stdout.trim())) {
        ccpdRunning = true;
      }
    } catch {}

    return {
      cupsRunning: cups.running,
      ccpdInstalled,
      ccpdRunning,
      fifoExists,
      udevRuleExists,
      rastertocaptInstalled,
      detectedPrinters: usb.filter((d) => d.isPrinter || d.isCanon),
      configuredPrinters: cups.printers,
      osName: osInfo.prettyName,
      osVersion: osInfo.astraEdition || osInfo.kernel,
      isAstraLinux: osInfo.isAstraLinux,
    };
  }

  /**
   * Generates a bulletproof bash installer and repair script for Astra Linux & Debian
   */
  generateCanonDriverScript(
    modelKey: CanonModelKey = 'lbp2900',
    mode: 'capt-systemd' | 'rastertocapt' = 'capt-systemd',
    port: string = '/dev/usb/lp0'
  ): { script: string; filename: string } {
    const model = CANON_MODELS[modelKey] || CANON_MODELS.lbp2900;
    const printerName = model.id.toUpperCase();

    if (mode === 'rastertocapt') {
      const script = `#!/usr/bin/env bash
# ==============================================================================
# soulm8te AI System Assistant — Canon ${model.label} (Открытый драйвер rastertocapt)
# Рекомендуется для Astra Linux SE/CE, Debian и Ubuntu
# Преимущество: Прямая печать через CUPS без капризного демона ccpd!
# ==============================================================================
set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "[-] Ошибка: Скрипт необходимо запускать от имени root (sudo bash $0)"
  exit 1
fi

echo "[*] Обновление пакетов и установка инструментов сборки..."
apt-get update -qq
apt-get install -y -qq build-essential git libcups2-dev libcupsimage2-dev cups cups-client

echo "[*] Сборка и установка драйвера rastertocapt..."
WORK_DIR="/tmp/captdriver_build_$$\"
rm -rf "$WORK_DIR"
git clone https://github.com/agalakhov/captdriver.git "$WORK_DIR"
cd "$WORK_DIR"
make

echo "[*] Копирование фильтра в каталог CUPS..."
CUPS_FILTER_DIR="$(cups-config --serverbin)/filter"
mkdir -p "$CUPS_FILTER_DIR"
cp rastertocapt "$CUPS_FILTER_DIR/"
chmod 755 "$CUPS_FILTER_DIR/rastertocapt"
chown root:root "$CUPS_FILTER_DIR/rastertocapt"

echo "[*] Установка PPD файлов..."
CUPS_MODEL_DIR="/usr/share/cups/model"
mkdir -p "$CUPS_MODEL_DIR"
cp ppd/*.ppd "$CUPS_MODEL_DIR/" 2>/dev/null || true

echo "[*] Перезапуск службы CUPS..."
systemctl restart cups

echo "[*] Регистрация принтера ${printerName} в CUPS..."
lpadmin -x "${printerName}" 2>/dev/null || true
lpadmin -p "${printerName}" -m "canon-${model.id}.ppd" -v "usb://Canon/${printerName}" -E || \\
lpadmin -p "${printerName}" -m "${model.ppdName}" -v "usb://Canon/${printerName}" -E

echo "[*] Настройка прав доступа Astra Linux..."
usermod -aG lpadmin,lp "$SUDO_USER" 2>/dev/null || true

echo "[+] Установка завершена успешно!"
echo "[+] Принтер ${printerName} настроен через открытый драйвер rastertocapt."
`;
      return {
        script,
        filename: `install-canon-${model.id}-rastertocapt.sh`,
      };
    }

    // Default: capt-systemd (official Canon CAPT with bulletproof Astra Linux systemd + udev hotplug fix)
    const script = `#!/usr/bin/env bash
# ==============================================================================
# soulm8te AI System Assistant — Canon ${model.label} для Astra Linux & Debian
# Полное исправление проблем CAPT:
# 1. Автоматическая настройка systemd unit (вместо сломанного /etc/init.d/ccpd)
# 2. Правило udev для автоперезапуска ccpd при переподключении USB или включении принтера
# 3. Регистрация FIFO пайпа и сокета /var/ccpd/fifo0
# 4. Исправление прав доступа Astra Linux Parsec / lp group
# ==============================================================================
set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "[-] Ошибка: Скрипт необходимо запускать от имени root (sudo bash $0)"
  exit 1
fi

PRINTER_NAME="${printerName}"
PPD_NAME="${model.ppdName}"
USB_PORT="${port}"

echo "=========================================================="
echo "  Установка и настройка Canon $PRINTER_NAME для Astra Linux"
echo "=========================================================="

echo "[1/7] Установка необходимых пакетов CUPS и совместимости..."
apt-get update -qq
apt-get install -y -qq cups cups-client cups-bsd libcups2 libstdc++6 psmisc

# Включение архитектуры i386 при необходимости
if [ "$(dpkg --print-architecture)" = "amd64" ]; then
  dpkg --add-architecture i386 2>/dev/null || true
  apt-get update -qq 2>/dev/null || true
  apt-get install -y -qq libc6:i386 libstdc++6:i386 libxml2:i386 2>/dev/null || true
fi

echo "[2/7] Проверка наличия официальных пакетов Canon CAPT..."
if ! command -v ccpdadmin >/dev/null 2>&1; then
  echo "[*] Загрузка и установка оптимизированных deb-пакетов Canon CAPT..."
  TMP_DEB_DIR="/tmp/canon_capt_debs_$$\"
  mkdir -p "$TMP_DEB_DIR"
  cd "$TMP_DEB_DIR"
  
  # Пакеты драйвера CAPT
  COMMON_URL="https://github.com/mouna/cndrvcups-capt/releases/download/v2.71/cndrvcups-common_3.40-1_amd64.deb"
  CAPT_URL="https://github.com/mouna/cndrvcups-capt/releases/download/v2.71/cndrvcups-capt_2.71-1_amd64.deb"
  
  wget -q -c "$COMMON_URL" -O common.deb 2>/dev/null || wget -q -c "https://mirror.yandex.ru/debian/pool/main/c/cndrvcups-common/cndrvcups-common_3.40-1_amd64.deb" -O common.deb || true
  wget -q -c "$CAPT_URL" -O capt.deb 2>/dev/null || wget -q -c "https://mirror.yandex.ru/debian/pool/main/c/cndrvcups-capt/cndrvcups-capt_2.71-1_amd64.deb" -O capt.deb || true
  
  if [ -f common.deb ] && [ -f capt.deb ]; then
    dpkg -i --force-depends common.deb capt.deb 2>/dev/null || apt-get install -f -y -qq
  fi
  rm -rf "$TMP_DEB_DIR"
fi

echo "[3/7] Настройка именованного канала FIFO..."
mkdir -p /var/ccpd
if [ ! -p /var/ccpd/fifo0 ]; then
  rm -f /var/ccpd/fifo0
  mkfifo /var/ccpd/fifo0
fi
chmod 777 /var/ccpd/fifo0
chown root:lp /var/ccpd/fifo0

echo "[4/7] Регистрация принтера в CUPS и демоне ccpd..."
systemctl restart cups
sleep 1

# Удаление старых записей если были
lpadmin -x "$PRINTER_NAME" 2>/dev/null || true
ccpdadmin -x "$PRINTER_NAME" 2>/dev/null || true

# Регистрация в CUPS
lpadmin -p "$PRINTER_NAME" -m "$PPD_NAME" -v ccp:/var/ccpd/fifo0 -E
# Регистрация в ccpd
ccpdadmin -p "$PRINTER_NAME" -o "$USB_PORT"

echo "[5/7] Создание надежной службы systemd для ccpd (критично для Astra Linux)..."
cat <<'EOF' > /etc/systemd/system/ccpd.service
[Unit]
Description=Canon CAPT Daemon Service for Astra Linux / Debian
After=cups.service udev.service
Requires=cups.service

[Service]
Type=forking
ExecStart=/usr/sbin/ccpd
ExecStop=/usr/bin/killall -9 ccpd
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ccpd.service

echo "[6/7] Создание правила udev для автовосстановления при переподключении USB..."
cat <<'EOF' > /etc/udev/rules.d/85-canon-capt.rules
# Автоматический перезапуск ccpd при включении принтера или подключении USB-кабеля
SUBSYSTEM=="usbmisc", KERNEL=="lp*", ATTRS{idVendor}=="04a9", GROUP="lp", MODE="0666", RUN+="/bin/systemctl restart ccpd"
SUBSYSTEM=="usb", ATTRS{idVendor}=="04a9", GROUP="lp", MODE="0666", RUN+="/bin/systemctl restart ccpd"
EOF

udevadm control --reload-rules 2>/dev/null || true
udevadm trigger 2>/dev/null || true

echo "[7/7] Запуск служб и финальная проверка..."
systemctl restart cups
systemctl restart ccpd

# Добавление пользователя в группу lp
if [ -n "$SUDO_USER" ]; then
  usermod -aG lp,lpadmin "$SUDO_USER" 2>/dev/null || true
fi

echo "=========================================================="
echo "[+] Принтер $PRINTER_NAME успешно установлен и настроен!"
echo "[+] Статус ccpd:"
ccpdadmin
echo "=========================================================="
echo "Чтобы отправить тестовую страницу, выполните:"
echo "  lp -d $PRINTER_NAME /usr/share/cups/data/testprint"
echo "=========================================================="
`;

    return {
      script,
      filename: `install-canon-${model.id}-astralinux.sh`,
    };
  }

  /**
   * Scans system for errors: systemd failed units, broken APT, CUPS logs, dmesg
   */
  async runSystemDiagnostics(): Promise<SystemDiagnosticReport> {
    const osInfo = await this.getOsInfo();
    const canonStatus = await this.getCanonDriverStatus();
    const errors: SystemErrorItem[] = [];
    const systemdFailedUnits: string[] = [];
    const aptIssues: string[] = [];

    // 1. Check systemd failed units
    try {
      const { stdout } = await execAsync('systemctl --failed --no-legend --no-pager 2>/dev/null', { timeout: 3000 });
      const lines = stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0]) {
          systemdFailedUnits.push(parts[0]);
          errors.push({
            id: `sysd-${parts[0]}`,
            source: 'systemd',
            severity: 'warning',
            title: `Сбой службы: ${parts[0]}`,
            rawDetails: line.trim(),
            aiExplanation: `Системная служба ${parts[0]} завершилась с ошибкой и перешла в статус failed.`,
            aiRootCause: 'Служба не смогла стартовать из-за сбоя конфигурации, прав доступа или отсутствия зависимостей.',
            suggestedFix: `Перезапустите службу или проверьте журнал командой:\nsudo systemctl restart ${parts[0]}\njournalctl -u ${parts[0]} -n 50 --no-pager`,
            fixCommand: `sudo systemctl restart ${parts[0]}`,
          });
        }
      }
    } catch {}

    // 2. Check broken APT / DPKG state
    try {
      const { stdout: dpkgOut } = await execAsync('dpkg --audit 2>/dev/null', { timeout: 3000 });
      if (dpkgOut.trim()) {
        aptIssues.push(dpkgOut.trim());
        errors.push({
          id: 'apt-broken-packages',
          source: 'apt',
          severity: 'critical',
          title: 'Обнаружены недоустановленные или поврежденные пакеты DPKG',
          rawDetails: dpkgOut.trim(),
          aiExplanation: 'В системе прервалась установка пакетов. Менеджер APT заблокирован до исправления зависимостей.',
          aiRootCause: 'Прерывание процесса apt-get / dpkg, сбой питания или конфликт архитектур (например, multiarch в Astra Linux).',
          suggestedFix: 'Запустите автоматическое конфигурирование и исправление сломанных зависимостей.',
          fixCommand: 'sudo dpkg --configure -a && sudo apt-get --fix-broken install -y',
        });
      }

      // Check lock files
      if (fs.existsSync('/var/lib/dpkg/lock-frontend') || fs.existsSync('/var/lib/apt/lists/lock')) {
        try {
          const { stdout: fuserOut } = await execAsync('fuser /var/lib/dpkg/lock-frontend 2>/dev/null || true');
          if (!fuserOut.trim()) {
            errors.push({
              id: 'apt-stale-lock',
              source: 'apt',
              severity: 'warning',
              title: 'Остаточный файл блокировки APT (/var/lib/dpkg/lock-frontend)',
              rawDetails: 'Файл блокировки присутствует, но процессы apt/dpkg не запущены.',
              aiExplanation: 'Осталась мертвая блокировка после зависшего процесса обновления.',
              aiRootCause: 'Нештатное завершение графического менеджера пакетов или терминала.',
              suggestedFix: 'Удалите остаточные файлы блокировки.',
              fixCommand: 'sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock /var/lib/dpkg/lock',
            });
          }
        } catch {}
      }
    } catch {}

    // 3. Check CUPS error log
    try {
      const cupsLogPath = '/var/log/cups/error_log';
      if (fs.existsSync(cupsLogPath)) {
        const stats = await fs.promises.stat(cupsLogPath);
        if (stats.size > 0) {
          const { stdout } = await execAsync(`tail -n 20 ${cupsLogPath} 2>/dev/null`, { timeout: 2000 });
          if (stdout.includes('[Job ') || stdout.toLowerCase().includes('filter failed') || stdout.toLowerCase().includes('stopped')) {
            const lastErrorLine = stdout.split('\n').filter((l) => l.includes(' E [') || l.toLowerCase().includes('fail')).pop() || stdout.split('\n').pop() || '';
            if (lastErrorLine) {
              errors.push({
                id: 'cups-print-error',
                source: 'cups',
                severity: 'warning',
                title: 'Ошибка очереди печати CUPS',
                rawDetails: lastErrorLine.trim(),
                aiExplanation: 'Подсистема CUPS зафиксировала сбой фильтра или тайм-аут связи с принтером.',
                aiRootCause: 'Принтер отключен от USB, демон ccpd не запущен или отсутствует raster-фильтр драйвера.',
                suggestedFix: 'Перезапустите планировщик CUPS и демон ccpd, очистите зависшие задания.',
                fixCommand: 'sudo cancel -a && sudo systemctl restart cups && sudo systemctl restart ccpd 2>/dev/null || true',
              });
            }
          }
        }
      }
    } catch {}

    // 4. Check Canon specific diagnostics
    if (!canonStatus.cupsRunning) {
      errors.push({
        id: 'cups-service-down',
        source: 'cups',
        severity: 'critical',
        title: 'Служба печати CUPS остановлена',
        rawDetails: 'systemctl is-active cups: inactive',
        aiExplanation: 'Планировщик печати не работает. Печать на любые принтеры невозможна.',
        aiRootCause: 'Служба cups отключена или завершилась с ошибкой.',
        suggestedFix: 'Запустите и включите службу CUPS в автозагрузку.',
        fixCommand: 'sudo systemctl enable --now cups',
      });
    }

    const hasCanonUsb = canonStatus.detectedPrinters.some((p) => p.isCanon);
    if (hasCanonUsb && !canonStatus.ccpdRunning && !canonStatus.rastertocaptInstalled) {
      errors.push({
        id: 'canon-ccpd-not-running',
        source: 'cups',
        severity: 'critical',
        title: 'Обнаружен принтер Canon, но драйвер CAPT / ccpd не настроен',
        rawDetails: 'Canon USB устройство подключено, но ccpd и rastertocapt не активны.',
        aiExplanation: 'Принтеры Canon LBP (CAPT) требуют запущенного демона ccpd или фильтра rastertocapt для печати.',
        aiRootCause: 'В Astra Linux стандартный драйвер CUPS не может передать данные без протокола CAPT.',
        suggestedFix: 'Сгенерируйте и запустите установочный скрипт soulm8te для вашей модели Canon.',
        fixCommand: 'bash /tmp/install-canon-lbp.sh',
      });
    }

    return {
      timestamp: Date.now(),
      osInfo,
      canonStatus,
      errors,
      systemdFailedUnits,
      aptIssues,
    };
  }

  /**
   * Analyzes an arbitrary error string from user using AI heuristics
   */
  analyzeCustomError(errorText: string): SystemErrorItem {
    const raw = errorText.trim();
    const lower = raw.toLowerCase();

    // 1. DPKG / APT lock
    if (lower.includes('could not get lock') || lower.includes('resource temporarily unavailable') || lower.includes('lock-frontend')) {
      return {
        id: `err-${Date.now()}`,
        source: 'apt',
        severity: 'warning',
        title: 'Блокировка менеджера пакетов APT / DPKG',
        rawDetails: raw,
        aiExplanation: 'Другой процесс (например, фоновое обновление или Discover/Synaptic) использует базу пакетов, либо остался файл блокировки после зависания.',
        aiRootCause: 'Параллельный запуск двух процессов обновления или некорректно завершенный apt-get.',
        suggestedFix: 'Завершите зависшие процессы apt и удалите остаточные lock-файлы.',
        fixCommand: 'sudo killall apt apt-get dpkg 2>/dev/null; sudo rm -f /var/lib/dpkg/lock* /var/lib/apt/lists/lock; sudo dpkg --configure -a',
      };
    }

    // 2. DPKG interrupted / broken packages
    if (lower.includes('dpkg was interrupted') || lower.includes('sub-process /usr/bin/dpkg returned an error code') || lower.includes('unmet dependencies')) {
      return {
        id: `err-${Date.now()}`,
        source: 'apt',
        severity: 'critical',
        title: 'Нарушены зависимости или прервана установка пакетов',
        rawDetails: raw,
        aiExplanation: 'Менеджер пакетов находится в несогласованном состоянии. Установка программ заблокирована.',
        aiRootCause: 'Прерванная установка, сбой сети во время загрузки или неразрешенные конфликты библиотек.',
        suggestedFix: 'Выполните автоматическое доконфигурирование пакетов и восстановление зависимостей.',
        fixCommand: 'sudo dpkg --configure -a && sudo apt-get update && sudo apt-get --fix-broken install -y',
      };
    }

    // 3. Canon CAPT / ccpd / cups error
    if (lower.includes('ccpd') || lower.includes('captmon') || lower.includes('captfilter') || lower.includes('cncups')) {
      return {
        id: `err-${Date.now()}`,
        source: 'cups',
        severity: 'critical',
        title: 'Сбой подсистемы Canon CAPT (ccpd)',
        rawDetails: raw,
        aiExplanation: 'Демон ccpd потерял связь с USB-портом принтера или не запущен сокет /var/ccpd/fifo0.',
        aiRootCause: 'В Astra Linux при выключении или перезагрузке принтера ccpd не восстанавливает связь без правила udev и systemd-сервиса.',
        suggestedFix: 'Перезапустите CUPS и ccpd, проверьте статус порта /dev/usb/lp0.',
        fixCommand: 'sudo systemctl restart cups && sudo systemctl restart ccpd && sudo ccpdadmin',
      };
    }

    // 4. Permission denied / Astra Linux MAC / Parsec
    if (lower.includes('permission denied') || lower.includes('отказано в доступе') || lower.includes('operation not permitted')) {
      return {
        id: `err-${Date.now()}`,
        source: 'kernel',
        severity: 'warning',
        title: 'Ошибка прав доступа (Permission Denied / Astra Parsec)',
        rawDetails: raw,
        aiExplanation: 'Текущий процесс не имеет прав на чтение/запись устройства или файла. В Astra Linux это часто связано с уровнями конфиденциальности Parsec или группами пользователя.',
        aiRootCause: 'Пользователь не состоит в группе lp / dialout / sudo, либо требуются привилегии root/pkexec.',
        suggestedFix: 'Добавьте пользователя в необходимые группы и предоставьте доступ к устройству.',
        fixCommand: 'sudo usermod -aG lp,lpadmin,dialout "$USER" && sudo chmod 666 /dev/usb/lp0 2>/dev/null || true',
      };
    }

    // 5. Systemd failed unit
    if (lower.includes('failed to start') || lower.includes('unit') && lower.includes('failed')) {
      return {
        id: `err-${Date.now()}`,
        source: 'systemd',
        severity: 'warning',
        title: 'Сбой запуска службы systemd',
        rawDetails: raw,
        aiExplanation: 'Системный юнит systemd не смог запуститься.',
        aiRootCause: 'Ошибка в исполняемом файле, неверные пути в Unit-файле или нехватка системных прав.',
        suggestedFix: 'Посмотрите подробный журнал службы для выявления конкретной строки ошибки.',
        fixCommand: 'journalctl -xe --no-pager -n 50',
      };
    }

    // Default intelligent fallback
    return {
      id: `err-${Date.now()}`,
      source: 'custom',
      severity: 'info',
      title: 'Анализ пользовательской системной ошибки',
      rawDetails: raw,
      aiExplanation: 'ИИ проанализировал переданное сообщение об ошибке. Команда ниже поможет локализовать источник проблемы в Astra Linux / Debian.',
      aiRootCause: 'Системный инцидент зафиксирован в журналах операционной системы.',
      suggestedFix: 'Проверьте последние критические сообщения ядра и системных служб.',
      fixCommand: 'journalctl -p 3 -xb -n 30 --no-pager',
    };
  }

  /**
   * Sends a test page to printer
   */
  async testPrintPage(printerName: string): Promise<{ success: boolean; message: string }> {
    try {
      const cleanName = printerName.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!cleanName) return { success: false, message: 'Не указано имя принтера.' };

      // Try printing standard cups test print or plain text banner
      const testFile = fs.existsSync('/usr/share/cups/data/testprint')
        ? '/usr/share/cups/data/testprint'
        : '/tmp/soulm8te-testprint.txt';

      if (testFile === '/tmp/soulm8te-testprint.txt') {
        await fs.promises.writeFile(
          testFile,
          `soulm8te Browser — Тестовая страница печати\nПринтер: ${cleanName}\nДата: ${new Date().toLocaleString()}\nОС: Astra Linux / Linux\nСтатус: Успешно!\n\n`
        );
      }

      await execAsync(`lp -d "${cleanName}" "${testFile}"`, { timeout: 5000 });
      return { success: true, message: `Задание печати успешно отправлено на ${cleanName}!` };
    } catch (err: any) {
      return { success: false, message: `Ошибка отправки печати: ${err?.message || 'Неизвестная ошибка'}` };
    }
  }
}
