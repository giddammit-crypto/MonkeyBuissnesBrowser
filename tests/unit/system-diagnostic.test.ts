import { describe, expect, it } from 'vitest';
import {
  CANON_MODELS,
  SystemDiagnosticService,
} from '../../src/services/system/SystemDiagnosticService';

describe('SystemDiagnosticService', () => {
  const service = new SystemDiagnosticService();

  describe('Canon Models Configuration', () => {
    it('defines accurate CAPT models and PPD mapping', () => {
      expect(CANON_MODELS.lbp2900).toBeDefined();
      expect(CANON_MODELS.lbp2900.ppdName).toBe('CNCUPSLBP2900CAPTK.ppd');
      expect(CANON_MODELS.lbp2900.usbId).toBe('04a9:2676');

      expect(CANON_MODELS.lbp6000).toBeDefined();
      expect(CANON_MODELS.lbp6000.ppdName).toBe('CNCUPSLBP6000CAPTK.ppd');
      expect(CANON_MODELS.lbp6000.usbId).toBe('04a9:271a');

      expect(CANON_MODELS.lbp6020.ppdName).toBe('CNCUPSLBP6020CAPTK.ppd');
      expect(CANON_MODELS.lbp6030.ppdName).toBe('CNCUPSLBP6030CAPTK.ppd');
      expect(CANON_MODELS.lbp3000.ppdName).toBe('CNCUPSLBP3000CAPTK.ppd');
    });
  });

  describe('Canon Driver Generator (Astra Linux & Debian)', () => {
    it('generates systemd + udev hotplug script for LBP2900', () => {
      const { script, filename } = service.generateCanonDriverScript('lbp2900', 'capt-systemd', '/dev/usb/lp0');

      expect(filename).toBe('install-canon-lbp2900-astralinux.sh');
      expect(script).toContain('PRINTER_NAME="LBP2900"');
      expect(script).toContain('CNCUPSLBP2900CAPTK.ppd');
      expect(script).toContain('/var/ccpd/fifo0');
      expect(script).toContain('ccpdadmin -p "$PRINTER_NAME" -o "$USB_PORT"');
      expect(script).toContain('/etc/systemd/system/ccpd.service');
      expect(script).toContain('/etc/udev/rules.d/85-canon-capt.rules');
      expect(script).toContain('RUN+="/bin/systemctl restart ccpd"');
      expect(script).toContain('dpkg --add-architecture i386');
    });

    it('generates systemd + udev hotplug script for LBP6000', () => {
      const { script, filename } = service.generateCanonDriverScript('lbp6000', 'capt-systemd', '/dev/usb/lp1');

      expect(filename).toBe('install-canon-lbp6000-astralinux.sh');
      expect(script).toContain('PRINTER_NAME="LBP6000"');
      expect(script).toContain('CNCUPSLBP6000CAPTK.ppd');
      expect(script).toContain('USB_PORT="/dev/usb/lp1"');
      expect(script).toContain('/etc/systemd/system/ccpd.service');
      expect(script).toContain('systemctl restart ccpd');
    });

    it('generates open-source rastertocapt script without ccpd requirement', () => {
      const { script, filename } = service.generateCanonDriverScript('lbp2900', 'rastertocapt');

      expect(filename).toBe('install-canon-lbp2900-rastertocapt.sh');
      expect(script).toContain('captdriver');
      expect(script).toContain('rastertocapt');
      expect(script).toContain('usb://Canon/LBP2900');
      expect(script).not.toContain('ccpdadmin');
    });
  });

  describe('AI Custom Error Diagnostics', () => {
    it('diagnoses APT lock error with fix command', () => {
      const error = 'E: Could not get lock /var/lib/dpkg/lock-frontend - open (11: Resource temporarily unavailable)';
      const analysis = service.analyzeCustomError(error);

      expect(analysis.source).toBe('apt');
      expect(analysis.title).toContain('Блокировка');
      expect(analysis.fixCommand).toContain('/var/lib/dpkg/lock');
      expect(analysis.aiExplanation).toBeDefined();
      expect(analysis.aiRootCause).toBeDefined();
    });

    it('diagnoses broken dpkg dependencies', () => {
      const error = 'dpkg was interrupted, you must manually run dpkg --configure -a';
      const analysis = service.analyzeCustomError(error);

      expect(analysis.source).toBe('apt');
      expect(analysis.severity).toBe('critical');
      expect(analysis.fixCommand).toContain('dpkg --configure -a');
    });

    it('diagnoses Canon CAPT communication errors', () => {
      const error = 'captfilter: error while loading shared libraries: ccpd daemon not running';
      const analysis = service.analyzeCustomError(error);

      expect(analysis.source).toBe('cups');
      expect(analysis.title).toContain('CAPT');
      expect(analysis.fixCommand).toContain('systemctl restart ccpd');
    });

    it('diagnoses permission denied and Astra Parsec issues', () => {
      const error = 'lp: Permission denied accessing /dev/usb/lp0';
      const analysis = service.analyzeCustomError(error);

      expect(analysis.source).toBe('kernel');
      expect(analysis.title).toContain('прав доступа');
      expect(analysis.fixCommand).toContain('usermod -aG lp');
    });
  });

  describe('OS & Hardware Querying', () => {
    it('retrieves valid OS information without crashing', async () => {
      const osInfo = await service.getOsInfo();

      expect(osInfo).toBeDefined();
      expect(typeof osInfo.prettyName).toBe('string');
      expect(typeof osInfo.kernel).toBe('string');
      expect(typeof osInfo.isAstraLinux).toBe('boolean');
      expect(typeof osInfo.arch).toBe('string');
    });
  });
});
